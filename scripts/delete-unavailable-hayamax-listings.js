/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const INPUT = path.resolve(
  process.argv.find((arg) => arg.startsWith('--input='))?.slice(8) ||
    'reports/hayamax-cash-tourniquet/all-apply-2026-08-10/events.ndjson',
);
const OUTPUT_DIR = path.resolve(
  process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ||
    'reports/hayamax-cash-tourniquet/delete-unavailable-2026-08-10',
);

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

function liveSellerSku(item) {
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

function loadTargets() {
  const rows = fs
    .readFileSync(INPUT, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.reason === 'ml_status_not_editable')
    .map((row) => ({
      sku: String(row.sku || '').trim().toUpperCase(),
      productId: String(row.produto_id || '').trim(),
      itemId: String(row.ml_item_id || '').trim().toUpperCase(),
      observedStatus: String(row.ml_status || '').trim().toLowerCase(),
    }));
  const uniqueItems = new Set(rows.map((row) => row.itemId));
  if (rows.length !== 61 || uniqueItems.size !== 61) {
    throw new Error(
      `Execução bloqueada: esperados 61 anúncios únicos, recebidos ${rows.length}/${uniqueItems.size}`,
    );
  }
  return rows;
}

async function getToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  await assertAllowedMercadoLivreToken(
    data.access_token,
    'delete-unavailable-hayamax-listings',
  );
  return data.access_token;
}

async function mlRequest(token, itemId, method = 'GET', body = null) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(
        `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch (error) {
      lastResult = {
        ok: false,
        status: 0,
        data: null,
        error: error?.message || 'Falha de rede',
      };
      if (attempt < 3) {
        await sleep(attempt * 750);
        continue;
      }
      return lastResult;
    }
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
    if (
      [408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < 3
    ) {
      await sleep(attempt * 900);
      continue;
    }
    return lastResult;
  }
  return lastResult;
}

async function validateDatabase(targets) {
  const productIds = targets.map((target) => target.productId);
  const [{ data: products, error: productError }, { data: ads, error: adError }, { data: offers, error: offerError }] =
    await Promise.all([
      supabase
        .from('produtos')
        .select('id,sku,fornecedor,ml_item_id,ml_status')
        .in('id', productIds),
      supabase
        .from('anuncios_ml')
        .select('id,produto_id,sku,ml_item_id,status')
        .in('produto_id', productIds),
      supabase
        .from('produto_fornecedor_ofertas')
        .select('produto_id,dslite_fornecedor_id,sku_fornecedor')
        .in('produto_id', productIds),
    ]);
  if (productError || adError || offerError) {
    throw new Error(
      productError?.message || adError?.message || offerError?.message,
    );
  }

  return targets.map((target) => {
    const product = products.find((row) => row.id === target.productId);
    const targetAds = ads.filter(
      (row) =>
        row.produto_id === target.productId && row.ml_item_id === target.itemId,
    );
    if (
      !product ||
      product.sku !== target.sku ||
      product.ml_item_id !== target.itemId ||
      !String(product.fornecedor || '').toUpperCase().startsWith('HAYAMAX') ||
      !targetAds.some((row) => row.sku === target.sku)
    ) {
      throw new Error(
        `Execução bloqueada: vínculo divergente para ${target.sku}/${target.itemId}`,
      );
    }
    const supplierSkus = offers
      .filter(
        (row) =>
          row.produto_id === target.productId &&
          String(row.dslite_fornecedor_id) === '2',
      )
      .map((row) =>
        String(row.sku_fornecedor || '')
          .replace(/^HYX/i, '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    const otherAds = ads.filter(
      (row) =>
        row.produto_id === target.productId && row.ml_item_id !== target.itemId,
    );
    if (otherAds.length > 1) {
      throw new Error(
        `Execução bloqueada: ${target.sku} possui mais de um anúncio remanescente`,
      );
    }
    return { ...target, supplierSkus, otherAds };
  });
}

async function detachFromErp(target) {
  const now = new Date().toISOString();
  const { error: outboxError } = await supabase
    .from('anuncios_ml_outbox')
    .update({
      status: 'cancelled',
      last_error: 'Cancelado: anúncio excluído definitivamente no Mercado Livre',
      processed_at: now,
      updated_at: now,
    })
    .eq('ml_item_id', target.itemId)
    .in('status', ['pending', 'retry', 'processing']);
  if (outboxError) throw new Error(outboxError.message);

  const [{ error: adError }, { error: snapshotError }] = await Promise.all([
    supabase.from('anuncios_ml').delete().eq('ml_item_id', target.itemId),
    supabase.from('catalogo_ml_snapshot').delete().eq('ml_item_id', target.itemId),
  ]);
  if (adError || snapshotError) {
    throw new Error(adError?.message || snapshotError?.message);
  }

  const survivor = target.otherAds[0] || null;
  const productPatch = survivor
    ? { ml_item_id: survivor.ml_item_id, ml_status: survivor.status }
    : { ml_item_id: null, ml_status: 'sem_anuncio' };
  let { data: updatedProduct, error: productError } = await supabase
    .from('produtos')
    .update(productPatch)
    .eq('id', target.productId)
    .eq('ml_item_id', target.itemId)
    .select('id,sku,ml_item_id,ml_status')
    .maybeSingle();
  if (productError) throw new Error(productError.message);

  if (!updatedProduct) {
    const { data: currentProduct, error: currentProductError } = await supabase
      .from('produtos')
      .select('id,sku,ml_item_id,ml_status')
      .eq('id', target.productId)
      .single();
    if (currentProductError) throw new Error(currentProductError.message);
    const alreadyDesired =
      currentProduct.ml_item_id === productPatch.ml_item_id &&
      currentProduct.ml_status === productPatch.ml_status;
    if (alreadyDesired) {
      updatedProduct = currentProduct;
    } else if (currentProduct.ml_item_id === null) {
      const retry = await supabase
        .from('produtos')
        .update(productPatch)
        .eq('id', target.productId)
        .is('ml_item_id', null)
        .select('id,sku,ml_item_id,ml_status')
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      updatedProduct = retry.data;
    }
  }
  if (!updatedProduct) {
    throw new Error(
      `Produto ${target.sku} mudou de vínculo durante a exclusão`,
    );
  }
  return { product: updatedProduct, survivor };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const eventsPath = path.join(OUTPUT_DIR, APPLY ? 'events-apply.ndjson' : 'events-dry-run.ndjson');
  const append = (row) => {
    const event = { timestamp_utc: new Date().toISOString(), ...row };
    fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
    console.log(JSON.stringify(event));
    return event;
  };

  const targets = await validateDatabase(loadTargets());
  const token = await getToken();
  const results = [];

  for (const target of targets) {
    const before = await mlRequest(token, target.itemId);
    if (!before.ok || !before.data) {
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: APPLY ? 'apply' : 'dry_run',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'failed',
          reason: 'item_read_failed',
          http_status: before.status,
          error: before.error,
        }),
      );
      continue;
    }

    const statusBefore = String(before.data.status || '').toLowerCase();
    const subStatusBefore = subStatuses(before.data);
    const sellerSku = liveSellerSku(before.data);
    const normalizedSellerSku = sellerSku.replace(/^HYX/i, '');
    const identityOk =
      sellerSku === target.sku || target.supplierSkus.includes(normalizedSellerSku);
    if (!identityOk || !['closed', 'inactive', 'under_review'].includes(statusBefore)) {
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: APPLY ? 'apply' : 'dry_run',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'blocked',
          reason: !identityOk ? 'live_identity_mismatch' : 'live_status_changed',
          live_status: statusBefore,
        }),
      );
      continue;
    }

    const alreadyDeleted = subStatusBefore.includes('deleted');
    if (!APPLY) {
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: 'dry_run',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'planned',
          action: alreadyDeleted ? 'detach_already_deleted' : 'delete_and_detach',
          live_status: statusBefore,
          live_sub_status: subStatusBefore,
          survivor_ml_item_id: target.otherAds[0]?.ml_item_id || null,
        }),
      );
      continue;
    }

    let deletionHttpStatus = null;
    if (!alreadyDeleted) {
      const directDelete =
        statusBefore === 'closed' ||
        (statusBefore === 'under_review' && subStatusBefore.includes('forbidden'));
      if (!directDelete) {
        const close = await mlRequest(token, target.itemId, 'PUT', {
          status: 'closed',
        });
        if (!close.ok && statusBefore !== 'inactive') {
          results.push(
            append({
              event: 'delete_unavailable_hayamax_listing',
              mode: 'apply',
              sku: target.sku,
              ml_item_id: target.itemId,
              result: 'failed',
              reason: 'item_close_failed',
              http_status: close.status,
              error: close.error,
            }),
          );
          continue;
        }
        if (close.ok) await sleep(900);
      }
      const deletion = await mlRequest(token, target.itemId, 'PUT', {
        deleted: true,
      });
      deletionHttpStatus = deletion.status;
      if (!deletion.ok) {
        results.push(
          append({
            event: 'delete_unavailable_hayamax_listing',
            mode: 'apply',
            sku: target.sku,
            ml_item_id: target.itemId,
            result: 'failed',
            reason: 'item_delete_failed',
            http_status: deletion.status,
            error: deletion.error,
          }),
        );
        continue;
      }
    }

    const verified = await mlRequest(token, target.itemId);
    const verifiedSubStatus = subStatuses(verified.data);
    if (!verified.ok || !verifiedSubStatus.includes('deleted')) {
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: 'apply',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'failed',
          reason: 'item_delete_verification_failed',
          http_status: verified.status,
          error: verified.error,
        }),
      );
      continue;
    }

    try {
      const erp = await detachFromErp(target);
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: 'apply',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'deleted_and_detached',
          ml_action: alreadyDeleted ? 'already_deleted' : 'deleted',
          ml_http_status: deletionHttpStatus,
          verified_status: verified.data.status,
          verified_sub_status: verifiedSubStatus,
          erp_ml_item_id: erp.product.ml_item_id,
          erp_ml_status: erp.product.ml_status,
          survivor_ml_item_id: erp.survivor?.ml_item_id || null,
        }),
      );
    } catch (error) {
      results.push(
        append({
          event: 'delete_unavailable_hayamax_listing',
          mode: 'apply',
          sku: target.sku,
          ml_item_id: target.itemId,
          result: 'deleted_ml_erp_failed',
          error: error?.message || String(error),
        }),
      );
    }
  }

  const counts = results.reduce((acc, row) => {
    acc[row.result] = (acc[row.result] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    event: 'delete_unavailable_hayamax_listings_summary',
    timestamp_utc: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry_run',
    targets: targets.length,
    counts,
    events_file: eventsPath,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, APPLY ? 'summary-apply.json' : 'summary-dry-run.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
  if (
    (counts.failed || 0) > 0 ||
    (counts.blocked || 0) > 0 ||
    (counts.deleted_ml_erp_failed || 0) > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'delete_unavailable_hayamax_listings_fatal',
      timestamp_utc: new Date().toISOString(),
      error: error?.message || String(error),
    }),
  );
  process.exit(1);
});
