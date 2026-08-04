/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const SKU = 'VTK001318';
const ORIGINAL_ITEM_ID = 'MLB6573116714';
const CATALOG_PRODUCT_ID = 'MLB23789800';

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

function attribute(source, id) {
  return (source?.attributes || []).find((row) => String(row?.id || '').toUpperCase() === id)?.value_name || '';
}

function numberFrom(value) {
  const parsed = Number(String(value || '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function localStatus(status) {
  if (status === 'active') return 'ativo';
  if (status === 'paused') return 'pausado';
  if (status === 'closed' || status === 'inactive') return 'fechado';
  return 'pausado';
}

async function main() {
  const [{ data: product, error: productError }, { data: integration, error: integrationError }] = await Promise.all([
    supabase.from('produtos').select('*').eq('sku', SKU).single(),
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
  ]);
  if (productError || !product) throw new Error(productError?.message || 'Produto não encontrado');
  if (product.ml_item_id !== ORIGINAL_ITEM_ID) throw new Error(`Vínculo inesperado: ${product.ml_item_id || '(vazio)'}`);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');
  await assertAllowedMercadoLivreToken(integration.access_token, 'optin-correct-inverter-catalog-2026-08-03');

  const [original, catalog, eligibility] = await Promise.all([
    mlRequest(integration.access_token, `/items/${ORIGINAL_ITEM_ID}?include_internal_attributes=true`),
    mlRequest(integration.access_token, `/products/${CATALOG_PRODUCT_ID}`),
    mlRequest(integration.access_token, `/items/${ORIGINAL_ITEM_ID}/catalog_listing_eligibility`),
  ]);
  if (!original.ok || !catalog.ok || !eligibility.ok) throw new Error('Pré-validação ML indisponível');
  if (String(attribute(original.data, 'SELLER_SKU')) !== SKU) throw new Error('SKU do anúncio original diverge');
  if (String(catalog.data?.domain_id) !== 'MLB-POWER_INVERTERS') throw new Error('Domínio do catálogo diverge');
  if (!/24\s*v/i.test(String(catalog.data?.name || ''))) throw new Error('Catálogo não identifica versão 24 V');
  if (!/hayonik/i.test(String(attribute(catalog.data, 'BRAND')))) throw new Error('Marca do catálogo diverge');
  const minInput = numberFrom(attribute(catalog.data, 'MIN_INPUT_VOLTAGE'));
  const maxInput = numberFrom(attribute(catalog.data, 'MAX_INPUT_VOLTAGE'));
  const minOutput = numberFrom(attribute(catalog.data, 'MIN_OUTPUT_VOLTAGE'));
  const maxOutput = numberFrom(attribute(catalog.data, 'MAX_OUTPUT_VOLTAGE'));
  const power = numberFrom(attribute(catalog.data, 'MAX_OPERATING_POWER'));
  if (!(minInput <= 24 && maxInput >= 24 && minOutput <= 127 && maxOutput >= 127 && power === 1500)) {
    throw new Error('Faixa elétrica ou potência do catálogo diverge do produto 24 V / 127 V / 1500 W');
  }
  if (String(eligibility.data?.status || '').toUpperCase() !== 'READY_FOR_OPTIN') {
    throw new Error(`Anúncio não está pronto para catálogo: ${eligibility.data?.status || '(vazio)'}`);
  }

  if (!APPLY) {
    console.log(JSON.stringify({ apply: false, sku: SKU, originalItemId: ORIGINAL_ITEM_ID, catalogProductId: CATALOG_PRODUCT_ID, catalogName: catalog.data.name, eligibility: eligibility.data.status }, null, 2));
    return;
  }

  const optin = await mlRequest(integration.access_token, '/items/catalog_listings', 'POST', {
    item_id: ORIGINAL_ITEM_ID,
    catalog_product_id: CATALOG_PRODUCT_ID,
  });
  if (!optin.ok || !optin.data?.id) {
    throw new Error(`Opt-in recusado: HTTP ${optin.status} ${optin.data?.message || ''}`.trim());
  }

  const catalogItemId = String(optin.data.id);
  const catalogItem = await mlRequest(integration.access_token, `/items/${catalogItemId}?include_internal_attributes=true`);
  if (!catalogItem.ok || catalogItem.data?.catalog_listing !== true || catalogItem.data?.catalog_product_id !== CATALOG_PRODUCT_ID) {
    throw new Error('Mercado Livre criou anúncio, mas a validação do catálogo falhou');
  }

  const { data: listingRow, error: listingError } = await supabase
    .from('anuncios_ml')
    .select('id')
    .eq('ml_item_id', ORIGINAL_ITEM_ID)
    .maybeSingle();
  if (listingError) throw new Error(`Falha ao localizar vínculo ERP: ${listingError.message}`);
  const listingPayload = {
    ml_item_id: catalogItemId,
    produto_id: product.id,
    sku: SKU,
    titulo: catalogItem.data.title || catalog.data.name,
    thumbnail: catalogItem.data.thumbnail || null,
    permalink: catalogItem.data.permalink || null,
    preco_ml: Number(catalogItem.data.price || 0),
    status: localStatus(catalogItem.data.status),
    tipo: catalogItem.data.listing_type_id === 'gold_pro' ? 'premium' : 'classico',
    catalogo: true,
    updated_at: new Date().toISOString(),
  };
  const listingWrite = listingRow?.id
    ? await supabase.from('anuncios_ml').update(listingPayload).eq('id', listingRow.id)
    : await supabase.from('anuncios_ml').upsert(listingPayload, { onConflict: 'ml_item_id' });
  if (listingWrite.error) throw new Error(`Catálogo criado, mas vínculo ERP falhou: ${listingWrite.error.message}`);

  const { error: productUpdateError } = await supabase.from('produtos').update({
    ml_item_id: catalogItemId,
    ml_status: localStatus(catalogItem.data.status),
    updated_at: new Date().toISOString(),
  }).eq('id', product.id);
  if (productUpdateError) throw new Error(`Catálogo criado, mas produto ERP falhou: ${productUpdateError.message}`);

  const { error: snapshotError } = await supabase.from('catalogo_ml_snapshot').upsert({
    ml_item_id: catalogItemId,
    seller_id: Number(catalogItem.data.seller_id || 0),
    catalog_listing: true,
    title: catalogItem.data.title || catalog.data.name,
    status: catalogItem.data.status || null,
    price: Number(catalogItem.data.price || 0),
    permalink: catalogItem.data.permalink || null,
    thumbnail: catalogItem.data.thumbnail || null,
    seller_sku: SKU,
    catalog_product_id: CATALOG_PRODUCT_ID,
    category_id: catalogItem.data.category_id || null,
    domain_id: catalogItem.data.domain_id || null,
    produto_id: product.id,
    sku_local: SKU,
    last_updated_ml: catalogItem.data.last_updated || null,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'ml_item_id' });
  if (snapshotError) throw new Error(`Catálogo criado, mas snapshot ERP falhou: ${snapshotError.message}`);

  const report = {
    apply: true,
    sku: SKU,
    originalItemId: ORIGINAL_ITEM_ID,
    catalogProductId: CATALOG_PRODUCT_ID,
    catalogItemId,
    catalogName: catalog.data.name,
    status: catalogItem.data.status,
  };
  fs.writeFileSync(path.resolve('reports/ml-repair-2026-08-03/inverter-catalog-optin.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
