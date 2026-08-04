/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const TARGETS = [
  { sku: 'VTK012415', oldItemId: 'MLB7322678858', gtin: '7898640360546', catalogProductId: 'MLB41026358' },
  { sku: 'VTK012425', oldItemId: 'MLB7322691208', gtin: '7898640360539', catalogProductId: 'MLB27510983' },
];

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function mlRequest(token, pathname, method = 'GET', body) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function sellerSku(item) {
  return String((item?.attributes || []).find((row) => row.id === 'SELLER_SKU')?.value_name || item?.seller_custom_field || '').trim();
}

function localStatus(status) {
  return status === 'active' ? 'ativo' : status === 'paused' ? 'pausado' : 'fechado';
}

async function persist(target, product, oldItem, catalogItem) {
  const { data: listingRow, error: listingError } = await supabase
    .from('anuncios_ml')
    .select('id')
    .eq('ml_item_id', target.oldItemId)
    .maybeSingle();
  if (listingError) throw new Error(`${target.sku}: vínculo ERP indisponível: ${listingError.message}`);
  const payload = {
    ml_item_id: catalogItem.id,
    produto_id: product.id,
    sku: target.sku,
    titulo: catalogItem.title,
    thumbnail: catalogItem.thumbnail || null,
    permalink: catalogItem.permalink || null,
    preco_ml: Number(catalogItem.price || 0),
    status: localStatus(catalogItem.status),
    tipo: catalogItem.listing_type_id === 'gold_pro' ? 'premium' : 'classico',
    catalogo: true,
    updated_at: new Date().toISOString(),
  };
  const write = listingRow?.id
    ? await supabase.from('anuncios_ml').update(payload).eq('id', listingRow.id)
    : await supabase.from('anuncios_ml').upsert(payload, { onConflict: 'ml_item_id' });
  if (write.error) throw new Error(`${target.sku}: catálogo criado, mas anúncio ERP falhou: ${write.error.message}`);

  const { error: productError } = await supabase.from('produtos').update({
    ml_item_id: catalogItem.id,
    ml_status: localStatus(catalogItem.status),
    updated_at: new Date().toISOString(),
  }).eq('id', product.id);
  if (productError) throw new Error(`${target.sku}: catálogo criado, mas produto ERP falhou: ${productError.message}`);

  const { error: snapshotError } = await supabase.from('catalogo_ml_snapshot').upsert({
    ml_item_id: catalogItem.id,
    seller_id: Number(catalogItem.seller_id || 0),
    catalog_listing: true,
    title: catalogItem.title || null,
    status: catalogItem.status || null,
    price: Number(catalogItem.price || 0),
    permalink: catalogItem.permalink || null,
    thumbnail: catalogItem.thumbnail || null,
    seller_sku: target.sku,
    catalog_product_id: target.catalogProductId,
    category_id: catalogItem.category_id || null,
    domain_id: catalogItem.domain_id || null,
    produto_id: product.id,
    sku_local: target.sku,
    last_updated_ml: catalogItem.last_updated || null,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'ml_item_id' });
  if (snapshotError) throw new Error(`${target.sku}: catálogo criado, mas snapshot falhou: ${snapshotError.message}`);

  const deleted = await mlRequest(product.token, `/items/${target.oldItemId}`, 'PUT', { deleted: true });
  if (!deleted.ok) throw new Error(`${target.sku}: catálogo criado, mas anúncio moderado não foi excluído (HTTP ${deleted.status})`);
}

async function main() {
  const [{ data: integration, error: integrationError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
    supabase.from('produtos').select('*').in('sku', TARGETS.map((target) => target.sku)),
  ]);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');
  if (productError) throw new Error(productError.message);
  await assertAllowedMercadoLivreToken(integration.access_token, 'publish-correct-amplifier-catalog-2026-08-03');

  const prepared = [];
  for (const target of TARGETS) {
    const product = (products || []).find((row) => row.sku === target.sku);
    if (!product || product.ml_item_id !== target.oldItemId || String(product.gtin) !== target.gtin || Number(product.estoque) <= 0) {
      throw new Error(`${target.sku}: produto, GTIN, vínculo ou estoque divergente`);
    }
    const [oldItem, search, catalogProduct, catalogItems] = await Promise.all([
      mlRequest(integration.access_token, `/items/${target.oldItemId}?include_internal_attributes=true`),
      mlRequest(integration.access_token, `/products/search?site_id=MLB&status=active&product_identifier=${target.gtin}`),
      mlRequest(integration.access_token, `/products/${target.catalogProductId}`),
      mlRequest(integration.access_token, `/products/${target.catalogProductId}/items?limit=20`),
    ]);
    if (!oldItem.ok || sellerSku(oldItem.data) !== target.sku) throw new Error(`${target.sku}: anúncio original diverge`);
    const searchResults = Array.isArray(search.data?.results) ? search.data.results : [];
    if (!search.ok || search.data?.query_type !== 'GTIN' || searchResults.length !== 1 || searchResults[0]?.id !== target.catalogProductId) {
      throw new Error(`${target.sku}: GTIN não identifica exclusivamente o catálogo esperado`);
    }
    if (!catalogProduct.ok || catalogProduct.data?.status !== 'active' || catalogProduct.data?.domain_id !== 'MLB-AUDIO_AMPLIFIERS' || catalogProduct.data?.settings?.listing_strategy !== 'catalog_required') {
      throw new Error(`${target.sku}: produto de catálogo indisponível ou não obrigatório`);
    }
    if (!catalogItems.ok || !(catalogItems.data?.results || []).some((row) => row.category_id === 'MLB7892')) {
      throw new Error(`${target.sku}: categoria do catálogo não confirmada`);
    }
    prepared.push({ target, product: { ...product, token: integration.access_token }, oldItem: oldItem.data, catalogProduct: catalogProduct.data });
  }

  if (!APPLY) {
    console.log(JSON.stringify({ apply: false, targets: prepared.map(({ target, product, oldItem, catalogProduct }) => ({ sku: target.sku, oldItemId: target.oldItemId, catalogProductId: target.catalogProductId, catalogName: catalogProduct.name, price: oldItem.price, stock: product.estoque })) }, null, 2));
    return;
  }

  const results = [];
  for (const row of prepared) {
    const created = await mlRequest(integration.access_token, '/items', 'POST', {
      site_id: 'MLB',
      category_id: 'MLB7892',
      price: Number(row.oldItem.price),
      currency_id: 'BRL',
      available_quantity: Math.max(1, Math.floor(Number(row.product.estoque))),
      buying_mode: 'buy_it_now',
      listing_type_id: row.oldItem.listing_type_id || 'gold_pro',
      condition: 'new',
      pictures: [],
      catalog_product_id: row.target.catalogProductId,
      catalog_listing: true,
      attributes: [
        { id: 'SELLER_SKU', value_name: row.target.sku },
        { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' },
      ],
      sale_terms: (row.oldItem.sale_terms || []).map((term) => ({
        id: term.id,
        ...(term.value_id ? { value_id: term.value_id } : {}),
        ...(term.value_name ? { value_name: term.value_name } : {}),
      })),
    });
    if (!created.ok || !created.data?.id) {
      throw new Error(`${row.target.sku}: publicação direta recusada (HTTP ${created.status}: ${JSON.stringify(created.data)})`);
    }
    const live = await mlRequest(integration.access_token, `/items/${created.data.id}?include_internal_attributes=true`);
    if (!live.ok || live.data?.catalog_listing !== true || live.data?.catalog_product_id !== row.target.catalogProductId || live.data?.category_id !== 'MLB7892') {
      throw new Error(`${row.target.sku}: catálogo criado, mas validação ao vivo falhou`);
    }
    await persist(row.target, row.product, row.oldItem, live.data);
    results.push({ sku: row.target.sku, oldItemId: row.target.oldItemId, catalogItemId: live.data.id, catalogProductId: row.target.catalogProductId, status: live.data.status, price: live.data.price, stock: live.data.available_quantity });
    console.log(`${row.target.sku} ${live.data.id} ${live.data.status}`);
  }

  const report = { apply: true, generatedAt: new Date().toISOString(), results };
  fs.writeFileSync(path.resolve('reports/ml-repair-2026-08-03/amplifier-direct-catalog.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
