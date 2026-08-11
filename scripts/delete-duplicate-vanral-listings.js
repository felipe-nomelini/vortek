/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const OUTPUT_DIR = path.resolve(
  process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ||
    'reports/vanral-instrument-pricing/duplicate-deletion-2026-08-10',
);
const PRODUCT_ID = '807c0e49-1543-45e9-8dea-1065587783c2';
const SKU = 'VTK009736';
const TARGETS = [
  { itemId: 'MLB5009156527', survivorItemId: 'MLB7009016324' },
  { itemId: 'MLB5009148991', survivorItemId: 'MLB7044005990' },
];

const supabaseUrl =
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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

function sellerSku(item) {
  const attribute = (item?.attributes || []).find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(
    item?.seller_sku ||
      attribute?.value_name ||
      attribute?.value_id ||
      item?.seller_custom_field ||
      '',
  )
    .trim()
    .toUpperCase();
}

function subStatuses(item) {
  return Array.isArray(item?.sub_status)
    ? item.sub_status.map((value) => String(value).trim().toLowerCase())
    : [];
}

async function getToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  await assertAllowedMercadoLivreToken(
    data.access_token,
    'delete-duplicate-vanral-listings',
  );
  return data.access_token;
}

async function mlRequest(token, pathname, method = 'GET', body = null) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    lastResult = {
      ok: response.ok,
      status: response.status,
      data,
      error: data?.message || data?.error || text || null,
    };
    if (response.status === 409 && attempt < 3) {
      await sleep(attempt * 1000);
      continue;
    }
    return lastResult;
  }
  return lastResult;
}

async function validateDatabase() {
  const [{ data: product, error: productError }, { data: ads, error: adsError }] =
    await Promise.all([
      supabase
        .from('produtos')
        .select('id,sku,fornecedor,ml_item_id,ml_status')
        .eq('id', PRODUCT_ID)
        .maybeSingle(),
      supabase
        .from('anuncios_ml')
        .select('id,produto_id,sku,ml_item_id,status,vendidos')
        .eq('produto_id', PRODUCT_ID),
    ]);
  if (productError || adsError) {
    throw new Error(productError?.message || adsError?.message);
  }
  if (
    !product ||
    product.sku !== SKU ||
    String(product.fornecedor || '').toUpperCase() !== 'VANRAL' ||
    product.ml_item_id !== 'MLB7009016324'
  ) {
    throw new Error('Produto VANRAL ou anúncio principal divergente');
  }
  for (const target of TARGETS) {
    const targetAd = ads.find((row) => row.ml_item_id === target.itemId);
    const survivorAd = ads.find(
      (row) => row.ml_item_id === target.survivorItemId,
    );
    if (
      !targetAd ||
      targetAd.sku !== SKU ||
      Number(targetAd.vendidos || 0) !== 0 ||
      !survivorAd ||
      survivorAd.sku !== SKU
    ) {
      throw new Error(`Vínculo ERP divergente para ${target.itemId}`);
    }
  }
  return { product, ads };
}

async function validateLiveTarget(token, target) {
  const [item, survivor, moderation] = await Promise.all([
    mlRequest(
      token,
      `/items/${encodeURIComponent(target.itemId)}?include_internal_attributes=true`,
    ),
    mlRequest(
      token,
      `/items/${encodeURIComponent(target.survivorItemId)}?include_internal_attributes=true`,
    ),
    mlRequest(
      token,
      `/moderations/last_moderation/${encodeURIComponent(target.itemId)}-ITM`,
    ),
  ]);
  if (!item.ok || !survivor.ok || !moderation.ok) {
    throw new Error(`Consulta ML falhou para ${target.itemId}`);
  }
  const moderationRows = Array.isArray(moderation.data) ? moderation.data : [];
  const exactDuplicate = moderationRows.some(
    (row) =>
      row?.name === 'EXACT_DUPLICATE_INTRA_UP' &&
      (row?.evidence || []).some(
        (evidence) =>
          String(evidence?.text_matched || '') ===
          target.survivorItemId.replace(/^MLB/, ''),
      ),
  );
  const alreadyDeleted = subStatuses(item.data).includes('deleted');
  const validTarget =
    sellerSku(item.data) === SKU &&
    Number(item.data?.sold_quantity || 0) === 0 &&
    (alreadyDeleted ||
      (String(item.data?.status || '').toLowerCase() === 'under_review' &&
        subStatuses(item.data).includes('forbidden') &&
        exactDuplicate));
  const validSurvivor =
    sellerSku(survivor.data) === SKU &&
    String(survivor.data?.status || '').toLowerCase() === 'active';
  if (!validTarget || !validSurvivor) {
    throw new Error(`Validação ao vivo bloqueou ${target.itemId}`);
  }
  return {
    alreadyDeleted,
    status: item.data.status,
    subStatus: subStatuses(item.data),
    survivorStatus: survivor.data.status,
    moderation: exactDuplicate ? 'EXACT_DUPLICATE_INTRA_UP' : null,
  };
}

async function detachFromErp(target) {
  const now = new Date().toISOString();
  const outbox = await supabase
    .from('anuncios_ml_outbox')
    .update({
      status: 'cancelled',
      last_error: 'Cancelado: anúncio duplicado excluído no Mercado Livre',
      processed_at: now,
      updated_at: now,
    })
    .eq('ml_item_id', target.itemId)
    .in('status', ['pending', 'retry', 'processing']);
  if (outbox.error) throw new Error(outbox.error.message);

  const snapshot = await supabase
    .from('catalogo_ml_snapshot')
    .delete()
    .eq('ml_item_id', target.itemId);
  if (snapshot.error) throw new Error(snapshot.error.message);

  const deletedAd = await supabase
    .from('anuncios_ml')
    .delete()
    .eq('produto_id', PRODUCT_ID)
    .eq('ml_item_id', target.itemId)
    .select('id,ml_item_id');
  if (deletedAd.error || deletedAd.data?.length !== 1) {
    throw new Error(
      deletedAd.error?.message ||
        `ERP removeu ${deletedAd.data?.length || 0} vínculos para ${target.itemId}`,
    );
  }
  return deletedAd.data[0];
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const eventsPath = path.join(
    OUTPUT_DIR,
    APPLY ? 'events-apply.ndjson' : 'events-dry-run.ndjson',
  );
  const append = (row) => {
    const event = { timestamp_utc: new Date().toISOString(), ...row };
    fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
    console.log(JSON.stringify(event));
  };

  await validateDatabase();
  const token = await getToken();
  const validated = [];
  for (const target of TARGETS) {
    const live = await validateLiveTarget(token, target);
    validated.push({ target, live });
    append({
      event: 'delete_duplicate_vanral_listing',
      mode: APPLY ? 'apply' : 'dry_run',
      sku: SKU,
      ml_item_id: target.itemId,
      survivor_ml_item_id: target.survivorItemId,
      result: APPLY ? 'validated' : 'planned',
      ...live,
    });
  }

  if (APPLY) {
    for (const { target, live } of validated) {
      let deletionHttpStatus = null;
      if (!live.alreadyDeleted) {
        const deletion = await mlRequest(
          token,
          `/items/${encodeURIComponent(target.itemId)}`,
          'PUT',
          { deleted: true },
        );
        deletionHttpStatus = deletion.status;
        if (!deletion.ok) {
          throw new Error(
            `${target.itemId}: exclusão falhou (${deletion.status}: ${deletion.error})`,
          );
        }
      }
      const verified = await mlRequest(
        token,
        `/items/${encodeURIComponent(target.itemId)}?include_internal_attributes=true`,
      );
      if (!verified.ok || !subStatuses(verified.data).includes('deleted')) {
        throw new Error(`${target.itemId}: exclusão não confirmada no ML`);
      }
      const removed = await detachFromErp(target);
      append({
        event: 'delete_duplicate_vanral_listing',
        mode: 'apply',
        sku: SKU,
        ml_item_id: target.itemId,
        survivor_ml_item_id: target.survivorItemId,
        result: 'deleted',
        ml_http_status: deletionHttpStatus,
        ml_status_after: verified.data.status,
        ml_sub_status_after: subStatuses(verified.data),
        erp_record_removed: removed.id,
      });
    }
  }

  const { data: product, error: productError } = await supabase
    .from('produtos')
    .select('sku,ml_item_id,ml_status')
    .eq('id', PRODUCT_ID)
    .maybeSingle();
  const { data: remainingAds, error: remainingError } = await supabase
    .from('anuncios_ml')
    .select('ml_item_id,status')
    .eq('produto_id', PRODUCT_ID)
    .order('ml_item_id');
  if (productError || remainingError) {
    throw new Error(productError?.message || remainingError?.message);
  }
  const targetIds = new Set(TARGETS.map((target) => target.itemId));
  const targetRowsRemaining = (remainingAds || []).filter((row) =>
    targetIds.has(row.ml_item_id),
  );
  append({
    event: 'delete_duplicate_vanral_listings_summary',
    mode: APPLY ? 'apply' : 'dry_run',
    result: APPLY && targetRowsRemaining.length === 0 ? 'success' : 'planned',
    targets: TARGETS.length,
    target_rows_remaining_in_erp: targetRowsRemaining.length,
    product,
    remaining_ads: remainingAds,
    events_file: eventsPath,
  });
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'delete_duplicate_vanral_listings_fatal',
      timestamp_utc: new Date().toISOString(),
      error: error?.message || String(error),
    }),
  );
  process.exitCode = 1;
});
