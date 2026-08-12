/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  calculateCatalogCleanupProfit,
  evaluateCatalogCleanupCandidate,
} = require('../src/lib/ml/catalog-cleanup.ts');
const {
  deleteMlListingPermanentlyWith,
} = require('../src/lib/ml/listing-deletion-core.ts');
const {
  detachDeletedMlListing,
} = require('../src/lib/ml/listing-deletion-database.ts');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 1000;
const SOURCE = 'cleanup-ml-listings-2026-08-12';
const REPORT_PATH = path.resolve(
  process.argv.find((argument) => argument.startsWith('--report='))?.slice(9)
    || 'reports/catalog-cleanup-2026-08-12.json',
);
const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) {
  throw new Error('Configuração do Supabase indisponível');
}

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase();
}

function subStatuses(item) {
  return Array.isArray(item?.sub_status)
    ? item.sub_status.map((value) => normalizeText(value).toLowerCase()).filter(Boolean)
    : [];
}

function liveSellerSku(item) {
  const attribute = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (row) => normalizeText(row?.id).toUpperCase() === 'SELLER_SKU',
  );
  return normalizeSku(
    item?.seller_sku
      || attribute?.value_name
      || attribute?.value_id
      || item?.seller_custom_field,
  );
}

function productOf(listing) {
  return Array.isArray(listing?.produtos) ? listing.produtos[0] : listing?.produtos;
}

function listingProfit(listing, livePrice = listing?.preco_ml) {
  const product = productOf(listing);
  if (!product) return null;
  return calculateCatalogCleanupProfit({
    price: Number(livePrice),
    cost: Number(product.custo),
    shipping: Number(product.ml_shipping || 0),
    mlFee: Number(product.ml_fee ?? 0.15),
  });
}

async function fetchAll(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryFactory().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function getIntegration() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', 'mercadolivre')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Integração ML indisponível: ${error?.message || 'sem registro'}`);
  }
  return data;
}

async function refreshToken(integration) {
  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id || '',
      client_secret: integration.client_secret || '',
      refresh_token: integration.refresh_token || '',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Falha no refresh ML: HTTP ${response.status} ${payload.error || payload.message || ''}`,
    );
  }
  await assertAllowedMercadoLivreToken(payload.access_token, `${SOURCE}:refresh`);
  const { error } = await supabase
    .from('integracoes')
    .update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || integration.refresh_token,
      token_expires_at: new Date(
        Date.now() + Number(payload.expires_in || 10800) * 1000,
      ).toISOString(),
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: null,
      last_refresh_error_code: null,
    })
    .eq('tipo', 'mercadolivre');
  if (error) throw new Error(`Falha ao persistir token ML: ${error.message}`);
  return payload.access_token;
}

let cachedToken = null;
async function getToken(forceRefresh = false) {
  if (cachedToken && !forceRefresh) return cachedToken;
  const integration = await getIntegration();
  const expiresAt = new Date(integration.token_expires_at || 0).getTime();
  if (!forceRefresh && integration.access_token && expiresAt > Date.now() + 60000) {
    await assertAllowedMercadoLivreToken(integration.access_token, `${SOURCE}:cached`);
    cachedToken = integration.access_token;
    return cachedToken;
  }
  cachedToken = await refreshToken(integration);
  return cachedToken;
}

async function mlRequest(pathname, options = {}, attempt = 1) {
  const token = await getToken(attempt > 1 && options.refreshToken === true);
  let response;
  try {
    response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      body: options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (attempt < 3) {
      await sleep(attempt * 750);
      return mlRequest(pathname, options, attempt + 1);
    }
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: 'network_error', message: error?.message || 'Falha de rede' },
    };
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (response.status === 401 && attempt === 1) {
    return mlRequest(pathname, { ...options, refreshToken: true }, attempt + 1);
  }
  if ([408, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(attempt * 900);
    return mlRequest(pathname, options, attempt + 1);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? null : {
      code: normalizeText(data?.error || data?.code) || `http_${response.status}`,
      message: normalizeText(data?.message || data?.error || text) || `HTTP ${response.status}`,
    },
  };
}

async function loadPausedListings() {
  return fetchAll(() => supabase
    .from('anuncios_ml')
    .select(`
      ml_item_id,produto_id,sku,titulo,status,preco_ml,catalogo,
      produtos(id,sku,custo,ml_fee,ml_shipping,estoque,ativo)
    `)
    .eq('status', 'pausado')
    .order('ml_item_id', { ascending: true }));
}

async function loadCurrentListing(itemId) {
  const { data, error } = await supabase
    .from('anuncios_ml')
    .select(`
      ml_item_id,produto_id,sku,titulo,status,preco_ml,catalogo,
      produtos(id,sku,custo,ml_fee,ml_shipping,estoque,ativo)
    `)
    .eq('ml_item_id', normalizeText(itemId).toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`Falha ao revalidar anúncio no ERP: ${error.message}`);
  return data || null;
}

async function ensureItemBlocklisted(listing) {
  const itemId = normalizeText(listing.ml_item_id).toUpperCase();
  const { data: existing, error: readError } = await supabase
    .from('ml_manual_blocklist')
    .select('id,sku')
    .eq('ml_item_id', itemId)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Falha ao consultar blocklist: ${readError.message}`);
  if (existing) {
    if (existing.sku === null) return false;
    const { error: updateError } = await supabase
      .from('ml_manual_blocklist')
      .update({
        sku: null,
        motivo: 'Faxina V3: bloquear somente MLB excluído; permitir recriação do SKU',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (updateError) throw new Error(`Falha ao ajustar blocklist por MLB: ${updateError.message}`);
    return true;
  }

  const { error } = await supabase.from('ml_manual_blocklist').insert({
    sku: null,
    ml_item_id: itemId,
    ativo: true,
    motivo: 'Faxina V3: anúncio deficitário excluído; recriação do SKU permitida',
    created_by: SOURCE,
  });
  if (error) throw new Error(`Falha ao bloquear anúncio: ${error.message}`);
  return true;
}

async function verifyLocalDetach(itemId) {
  const [{ count: listingCount, error: listingError }, { count: snapshotCount, error: snapshotError }] =
    await Promise.all([
      supabase.from('anuncios_ml').select('*', { head: true, count: 'exact' }).eq('ml_item_id', itemId),
      supabase.from('catalogo_ml_snapshot').select('*', { head: true, count: 'exact' }).eq('ml_item_id', itemId),
    ]);
  if (listingError || snapshotError) throw new Error(listingError?.message || snapshotError?.message);
  return Number(listingCount || 0) === 0 && Number(snapshotCount || 0) === 0;
}

async function main() {
  const startedAt = new Date();
  const report = {
    schema_version: 1,
    generated_at: startedAt.toISOString(),
    mode: APPLY ? 'apply' : 'dry_run',
    criteria: {
      local_status: 'pausado',
      profit: 'less_than_zero',
      tax_rate: 0.04,
      applies_to: ['catalog', 'standard'],
      healthy_mirror_required: false,
      accepted_live_statuses: ['paused', 'closed', 'under_review/forbidden'],
      permanent_delete: true,
      blocklist_scope: 'ml_item_id_only',
    },
    summary: {},
    planned: [],
    obituary: [],
    skipped: [],
    errors: [],
  };

  const pausedListings = await loadPausedListings();
  const preliminaryCandidates = pausedListings.filter((listing) => {
    const profit = listingProfit(listing);
    return profit !== null && profit < 0;
  });
  const accountResult = preliminaryCandidates.length > 0 ? await mlRequest('/users/me') : null;
  if (accountResult && (!accountResult.ok || !accountResult.data?.id)) {
    throw new Error(`Falha ao validar conta ML: ${accountResult.error?.message || 'resposta inválida'}`);
  }
  const sellerId = accountResult ? String(accountResult.data.id) : null;
  const liveCache = new Map();

  async function getLiveItem(itemId, fresh = false) {
    const normalized = normalizeText(itemId).toUpperCase();
    if (!fresh && liveCache.has(normalized)) return liveCache.get(normalized);
    const result = await mlRequest(
      `/items/${encodeURIComponent(normalized)}?include_attributes=all&include_internal_attributes=true`,
    );
    if (result.ok && result.data) liveCache.set(normalized, result.data);
    return result.ok && result.data ? result.data : null;
  }

  async function evaluate(target, fresh = false) {
    const itemId = normalizeText(target.ml_item_id).toUpperCase();
    const live = await getLiveItem(itemId, fresh);
    if (!live) {
      return { eligible: false, reason: 'live_item_read_failed', itemId, live: null };
    }
    if (String(live.seller_id) !== sellerId) {
      return { eligible: false, reason: 'live_seller_mismatch', itemId, live };
    }
    const observedSku = liveSellerSku(live);
    if (observedSku && observedSku !== normalizeSku(target.sku)) {
      return { eligible: false, reason: 'live_sku_mismatch', itemId, live, observedSku };
    }

    const profit = listingProfit(target, live.price);
    const decision = evaluateCatalogCleanupCandidate({
      localStatus: normalizeText(target.status).toLowerCase(),
      liveStatus: normalizeText(live.status).toLowerCase(),
      liveSubStatus: subStatuses(live),
      profit,
    });

    return {
      ...decision,
      itemId,
      sku: normalizeSku(target.sku),
      title: normalizeText(target.titulo),
      live,
      profit,
      catalogListing: Boolean(live.catalog_listing),
    };
  }

  for (const target of preliminaryCandidates) {
    let evaluated;
    try {
      evaluated = await evaluate(target);
    } catch (error) {
      report.errors.push({
        ml_item_id: normalizeText(target.ml_item_id).toUpperCase(),
        sku: normalizeSku(target.sku),
        stage: 'evaluation',
        error: error?.message || String(error),
      });
      continue;
    }

    const auditRow = {
      ml_item_id: evaluated.itemId,
      sku: evaluated.sku,
      title: evaluated.title,
      negative_profit_brl: evaluated.profit === null ? null : Math.abs(evaluated.profit),
      profit_brl: evaluated.profit,
      live_status: normalizeText(evaluated.live?.status).toLowerCase() || null,
      live_sub_status: subStatuses(evaluated.live),
      catalog_listing: evaluated.catalogListing,
    };

    if (!evaluated.eligible) {
      report.skipped.push({ ...auditRow, reason: evaluated.reason });
      console.log(`${evaluated.itemId} skipped ${evaluated.reason}`);
      continue;
    }

    if (!APPLY) {
      report.planned.push({ ...auditRow, action: 'close_delete_and_detach' });
      console.log(`${evaluated.itemId} planned`);
      continue;
    }

    try {
      const currentTarget = await loadCurrentListing(evaluated.itemId);
      if (!currentTarget) {
        report.skipped.push({ ...auditRow, reason: 'revalidation:local_listing_missing' });
        console.log(`${evaluated.itemId} skipped revalidation:local_listing_missing`);
        continue;
      }
      const revalidated = await evaluate(currentTarget, true);
      if (!revalidated.eligible) {
        report.skipped.push({ ...auditRow, reason: `revalidation:${revalidated.reason}` });
        console.log(`${evaluated.itemId} skipped revalidation:${revalidated.reason}`);
        continue;
      }

      const blocklistInserted = await ensureItemBlocklisted(target);
      const deletion = await deleteMlListingPermanentlyWith(mlRequest, evaluated.itemId);
      if (!deletion.ok) {
        report.errors.push({
          ...auditRow,
          stage: 'delete',
          blocklist_inserted: blocklistInserted,
          code: deletion.code,
          http_status: deletion.status,
          error: deletion.error,
        });
        continue;
      }

      await detachDeletedMlListing(supabase, evaluated.itemId);
      const [verifiedTarget, localDetached] = await Promise.all([
        getLiveItem(evaluated.itemId, true),
        verifyLocalDetach(evaluated.itemId),
      ]);
      const targetDeleted = subStatuses(verifiedTarget).includes('deleted');
      if (!targetDeleted || !localDetached) {
        throw new Error(
          `Verificação final falhou: deleted=${targetDeleted} detached=${localDetached}`,
        );
      }

      report.obituary.push({
        ...auditRow,
        loss_stopped_brl: evaluated.profit === null ? null : Math.abs(evaluated.profit),
        deleted_at: new Date().toISOString(),
        already_deleted: deletion.alreadyDeleted,
        blocklist_inserted: blocklistInserted,
        verified_sub_status: subStatuses(verifiedTarget),
        local_detached: localDetached,
      });
      console.log(`${evaluated.itemId} deleted_and_detached`);
    } catch (error) {
      report.errors.push({
        ...auditRow,
        stage: 'apply',
        error: error?.message || String(error),
      });
    }
  }

  report.summary = {
    local_paused_scanned: pausedListings.length,
    preliminary_negative_candidates: preliminaryCandidates.length,
    planned: report.planned.length,
    deleted: report.obituary.length,
    skipped: report.skipped.length,
    errors: report.errors.length,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: report.mode, report: REPORT_PATH, ...report.summary }));
  if (report.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
