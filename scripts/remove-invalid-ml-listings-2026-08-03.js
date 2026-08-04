/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const REPAIR_DB_ONLY = process.argv.includes('--repair-db-only');
const FINAL_CATEGORY_REPAIR = process.argv.includes('--final-category-repair');
const INITIAL_TARGETS = [
  ['VTK000021', 'MLB4801376777'],
  ['VTK000088', 'MLB4801301663'],
  ['VTK000244', 'MLB4801120355'],
  ['VTK000402', 'MLB4881016565'],
  ['VTK000427', 'MLB6655262218'],
  ['VTK000706', 'MLB6648864104'],
  ['VTK000841', 'MLB7192106094'],
  ['VTK001221', 'MLB7095325298'],
  ['VTK001235', 'MLB7149335244'],
  ['VTK001251', 'MLB4871712319'],
  ['VTK001256', 'MLB7149406774'],
  ['VTK001300', 'MLB4880588697'],
  ['VTK001318', 'MLB4622930445'],
  ['VTK001318', 'MLB4948924039'],
  ['VTK001459', 'MLB7111548044'],
  ['VTK002659', 'MLB4857662735'],
  ['VTK003157', 'MLB7111649614'],
  ['VTK006330', 'MLB7149335914'],
  ['VTK009748', 'MLB4800946163'],
  ['VTK012415', 'MLB7111655946'],
  ['VTK012425', 'MLB4877489297'],
].map(([sku, itemId]) => ({ sku, itemId }));

const FINAL_CATEGORY_TARGETS = [
  ['VTK012415', 'MLB4988489067'],
  ['VTK012425', 'MLB7322675096'],
].map(([sku, itemId]) => ({ sku, itemId }));

const ONLY_SKU = process.argv.find((argument) => argument.startsWith('--only-sku='))?.split('=')[1] || '';
const TARGETS = (FINAL_CATEGORY_REPAIR ? FINAL_CATEGORY_TARGETS : INITIAL_TARGETS)
  .filter((target) => !ONLY_SKU || target.sku === ONLY_SKU);

const SURVIVING_LISTINGS = new Map([
  ['VTK001235', 'MLB7111548226'],
  ['VTK001251', 'MLB7087157484'],
  ['VTK001256', 'MLB4857482463'],
]);

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

function sellerSku(item) {
  const attribute = (item?.attributes || []).find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(attribute?.value_name || item?.seller_custom_field || '').trim();
}

async function getToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  await assertAllowedMercadoLivreToken(
    data.access_token,
    'remove-invalid-ml-listings-2026-08-03',
  );
  return data.access_token;
}

async function mlRequest(token, itemId, method = 'GET', body) {
  const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function closeAndDelete(token, target) {
  const before = await mlRequest(token, target.itemId);
  if (!before.ok) {
    throw new Error(`${target.itemId}: leitura falhou (HTTP ${before.status})`);
  }
  const actualSku = sellerSku(before.data);
  if (actualSku !== target.sku && !(target.sku === 'VTK000427' && actualSku === 'HYX76380')) {
    throw new Error(`${target.itemId}: SKU inesperado ${actualSku || '(vazio)'}`);
  }

  const existingSubStatus = Array.isArray(before.data?.sub_status) ? before.data.sub_status : [];
  if (existingSubStatus.includes('deleted')) {
    return {
      ...target,
      statusBefore: before.data.status,
      soldQuantity: Number(before.data.sold_quantity || 0),
      statusAfter: before.data.status,
      subStatus: existingSubStatus,
      action: 'already_deleted',
    };
  }

  if (!APPLY) {
    return {
      ...target,
      statusBefore: before.data.status,
      soldQuantity: Number(before.data.sold_quantity || 0),
      action: 'would_delete',
    };
  }

  const subStatusBefore = Array.isArray(before.data?.sub_status) ? before.data.sub_status : [];
  const directDelete = before.data.status === 'under_review' && subStatusBefore.includes('forbidden');
  if (before.data.status !== 'closed' && !directDelete) {
    const close = await mlRequest(token, target.itemId, 'PUT', { status: 'closed' });
    if (!close.ok) {
      throw new Error(`${target.itemId}: fechamento falhou (HTTP ${close.status}: ${close.data?.message || 'erro'})`);
    }
  }

  let deleted = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (attempt > 1) await sleep(1500 * attempt);
    deleted = await mlRequest(token, target.itemId, 'PUT', { deleted: true });
    if (deleted.ok) break;
    if (deleted.status !== 409) break;
  }
  if (!deleted?.ok) {
    throw new Error(`${target.itemId}: exclusão falhou (HTTP ${deleted?.status}: ${deleted?.data?.message || 'erro'})`);
  }

  const after = await mlRequest(token, target.itemId);
  const subStatus = Array.isArray(after.data?.sub_status) ? after.data.sub_status : [];
  if (after.ok && after.data?.status !== 'closed' && !subStatus.includes('deleted')) {
    throw new Error(`${target.itemId}: status final inesperado ${after.data?.status}`);
  }

  return {
    ...target,
    statusBefore: before.data.status,
    soldQuantity: Number(before.data.sold_quantity || 0),
    statusAfter: after.ok ? after.data.status : `HTTP_${after.status}`,
    subStatus,
    action: 'deleted',
  };
}

async function validateDatabaseTargets() {
  const ids = TARGETS.map((target) => target.itemId);
  const { data: listings, error: listingsError } = await supabase
    .from('anuncios_ml')
    .select('id,sku,produto_id,ml_item_id,status')
    .in('ml_item_id', ids);
  if (listingsError) throw new Error(`Falha ao validar anúncios: ${listingsError.message}`);

  const found = new Map((listings || []).map((row) => [row.ml_item_id, row]));
  for (const target of TARGETS) {
    const row = found.get(target.itemId);
    if (!row) throw new Error(`${target.itemId}: vínculo não encontrado no ERP`);
    if (row.sku !== target.sku) {
      throw new Error(`${target.itemId}: ERP vincula ao SKU ${row.sku}, esperado ${target.sku}`);
    }
  }
  return listings;
}

async function cleanDatabaseReferences() {
  const ids = TARGETS.map((target) => target.itemId);
  const targetSkus = [...new Set(TARGETS.map((target) => target.sku))];
  const { error: deleteError } = await supabase.from('anuncios_ml').delete().in('ml_item_id', ids);
  if (deleteError) throw new Error(`Falha ao excluir vínculos ERP: ${deleteError.message}`);

  for (const sku of targetSkus) {
    const survivor = SURVIVING_LISTINGS.get(sku) || null;
    const { error } = await supabase
      .from('produtos')
      .update({ ml_item_id: survivor, ml_status: survivor ? 'pausado' : 'sem_anuncio' })
      .eq('sku', sku);
    if (error) throw new Error(`Falha ao limpar produto ${sku}: ${error.message}`);
  }

  const { data: remaining, error: remainingError } = await supabase
    .from('anuncios_ml')
    .select('ml_item_id')
    .in('ml_item_id', ids);
  if (remainingError) throw new Error(`Falha na conferência ERP: ${remainingError.message}`);
  if ((remaining || []).length > 0) throw new Error('Ainda existem referências aos anúncios excluídos');
}

async function main() {
  if (REPAIR_DB_ONLY) {
    await cleanDatabaseReferences();
    console.log(JSON.stringify({ repairDbOnly: true, total: TARGETS.length }, null, 2));
    return;
  }
  await validateDatabaseTargets();
  const token = await getToken();
  const results = [];
  for (const target of TARGETS) {
    const result = await closeAndDelete(token, target);
    results.push(result);
    console.log(`${result.itemId} ${result.action}`);
  }
  if (APPLY) await cleanDatabaseReferences();

  const reportDir = path.resolve('reports/ml-repair-2026-08-03');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, APPLY ? 'deleted-invalid-listings.json' : 'delete-invalid-listings-dry-run.json');
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, total: results.length, results }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ apply: APPLY, total: results.length, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
