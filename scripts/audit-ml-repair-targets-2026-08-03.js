/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const SKUS = 'VTK000059 VTK000416 VTK000270 VTK000497 VTK001256 VTK000923 VTK000814 VTK000870 VTK001881 VTK018587 VTK001030 VTK001251 VTK002586 VTK000636 VTK001235 VTK000585 VTK025467 VTK025468 VTK025466 VTK002651 VTK000946 VTK000561 VTK016187'.split(' ');
const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function mlGet(token, pathname) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function sellerSku(item) {
  const row = (item?.attributes || []).find((attribute) => attribute.id === 'SELLER_SKU');
  return String(row?.value_name || item?.seller_custom_field || '').trim();
}

async function main() {
  const [{ data: products, error: productError }, { data: integration, error: integrationError }] = await Promise.all([
    supabase.from('produtos').select('*').in('sku', SKUS),
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
  ]);
  if (productError) throw new Error(productError.message);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');
  await assertAllowedMercadoLivreToken(integration.access_token, 'audit-ml-repair-targets-2026-08-03');

  const productIds = (products || []).map((product) => product.id);
  const [{ data: listings, error: listingError }, { data: offers, error: offerError }] = await Promise.all([
    supabase.from('anuncios_ml').select('*').in('produto_id', productIds),
    supabase.from('produto_fornecedor_ofertas').select('*').in('produto_id', productIds).eq('ativo', true),
  ]);
  if (listingError) throw new Error(listingError.message);
  if (offerError) throw new Error(offerError.message);

  const output = [];
  for (const sku of SKUS) {
    const product = (products || []).find((row) => row.sku === sku);
    if (!product) {
      output.push({ sku, error: 'Produto não encontrado' });
      continue;
    }
    const productListings = (listings || []).filter((row) => row.produto_id === product.id);
    const itemId = product.ml_item_id || productListings[0]?.ml_item_id || null;
    const [item, description] = itemId
      ? await Promise.all([
          mlGet(integration.access_token, `/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`),
          mlGet(integration.access_token, `/items/${encodeURIComponent(itemId)}/description`),
        ])
      : [{ ok: false, status: 0, data: null }, { ok: false, status: 0, data: null }];
    output.push({
      sku,
      product,
      offers: (offers || []).filter((row) => row.produto_id === product.id),
      erpListings: productListings,
      live: item.ok ? {
        id: item.data.id,
        sellerSku: sellerSku(item.data),
        status: item.data.status,
        subStatus: item.data.sub_status,
        title: item.data.title,
        familyName: item.data.family_name,
        categoryId: item.data.category_id,
        catalogListing: item.data.catalog_listing,
        catalogProductId: item.data.catalog_product_id,
        price: item.data.price,
        availableQuantity: item.data.available_quantity,
        soldQuantity: item.data.sold_quantity,
        listingTypeId: item.data.listing_type_id,
        shipping: item.data.shipping,
        sellerAddress: item.data.seller_address,
        saleTerms: item.data.sale_terms,
        attributes: item.data.attributes,
        pictures: item.data.pictures,
        tags: item.data.tags,
        health: item.data.health,
        warranty: item.data.warranty,
        condition: item.data.condition,
        moderationData: item.data.moderation_data,
      } : { error: `HTTP ${item.status}`, data: item.data },
      description: description.ok ? description.data?.plain_text || '' : null,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const reportDir = path.resolve('reports/ml-repair-2026-08-03');
  fs.mkdirSync(reportDir, { recursive: true });
  const outputPath = path.join(reportDir, 'reusable-live-audit.json');
  fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: output.length, rows: output }, null, 2)}\n`);
  console.log(JSON.stringify({ total: output.length, outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
