/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const TARGETS = [
  ['VTK001256', 'MLB4857482463'],
  ['VTK000923', 'MLB4857494309'],
  ['VTK000814', 'MLB4857481517'],
  ['VTK000870', 'MLB4857481411'],
  ['VTK001030', 'MLB6573107112'],
  ['VTK001251', 'MLB7087157484'],
  ['VTK001235', 'MLB7111548226'],
  ['VTK025467', 'MLB7295999924'],
  ['VTK025468', 'MLB7296000142'],
  ['VTK025466', 'MLB7295986978'],
  ['VTK000946', 'MLB6895933442'],
  ['VTK016187', 'MLB4903841511'],
  ['VTK001300', 'MLB7111545350'],
  ['VTK001318', 'MLB6573116714'],
].map(([sku, itemId]) => ({ sku, itemId }))
  .filter((target) => {
    const onlySku = process.argv.find((argument) => argument.startsWith('--only-sku='))?.split('=')[1] || '';
    return !onlySku || target.sku === onlySku;
  });

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
  return String((item?.attributes || []).find((row) => row.id === 'SELLER_SKU')?.value_name || '').trim();
}

function packageAttributes(product) {
  return [
    { id: 'SELLER_SKU', value_name: product.sku },
    { id: 'SELLER_PACKAGE_HEIGHT', value_name: `${product.altura} cm` },
    { id: 'SELLER_PACKAGE_WIDTH', value_name: `${product.largura} cm` },
    { id: 'SELLER_PACKAGE_LENGTH', value_name: `${product.profundidade} cm` },
    { id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Math.round(Number(product.peso_bruto) * 1000)} g` },
  ];
}

async function pictureFailures(token, item) {
  const failures = [];
  for (const picture of item.pictures || []) {
    const result = await mlRequest(token, `/pictures/${encodeURIComponent(picture.id)}/errors`);
    if (result.status === 404) continue;
    const errors = Array.isArray(result.data) ? result.data : result.data?.errors || [];
    if (errors.length > 0) failures.push({ pictureId: picture.id, errors });
  }
  return failures;
}

async function main() {
  const [{ data: integration, error: integrationError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
    supabase.from('produtos').select('*').in('sku', TARGETS.map((row) => row.sku)),
  ]);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');
  if (productError) throw new Error(productError.message);
  await assertAllowedMercadoLivreToken(integration.access_token, 'activate-validated-ml-listings-2026-08-03');

  const results = [];
  for (const target of TARGETS) {
    const product = (products || []).find((row) => row.sku === target.sku);
    if (!product || product.ml_item_id !== target.itemId || Number(product.estoque) <= 0) {
      throw new Error(`${target.sku}: produto, vínculo ou estoque divergente`);
    }
    const [before, description] = await Promise.all([
      mlRequest(integration.access_token, `/items/${target.itemId}?include_internal_attributes=true`),
      mlRequest(integration.access_token, `/items/${target.itemId}/description`),
    ]);
    if (!before.ok || !['paused', 'active'].includes(before.data?.status)) {
      throw new Error(`${target.sku}: status inesperado ${before.data?.status || before.status}`);
    }
    if (sellerSku(before.data) !== target.sku) throw new Error(`${target.sku}: SKU ao vivo divergente`);
    if (before.data?.shipping?.mode !== 'me2') throw new Error(`${target.sku}: anúncio não usa Mercado Envios`);
    if (!(before.data?.pictures || []).length) throw new Error(`${target.sku}: anúncio sem imagens`);
    if (before.data?.catalog_listing !== true) {
      const plainText = String(description.data?.plain_text || '');
      const bullets = plainText.split(/\r?\n/).filter((line) => /^-\s+\S/.test(line)).length;
      if (!description.ok || bullets < 3) throw new Error(`${target.sku}: descrição ainda não está estruturada`);
    }
    const imageFailures = await pictureFailures(integration.access_token, before.data);
    if (imageFailures.length > 0) throw new Error(`${target.sku}: imagem reprovada no diagnóstico ML`);

    if (!APPLY) {
      results.push({ ...target, action: 'would_activate', stock: product.estoque, catalog: before.data.catalog_listing === true });
      continue;
    }

    const attributesResult = await mlRequest(integration.access_token, `/items/${target.itemId}`, 'PUT', {
      attributes: packageAttributes(product),
    });
    if (!attributesResult.ok) throw new Error(`${target.sku}: embalagem recusada (HTTP ${attributesResult.status})`);

    const stockResult = await mlRequest(integration.access_token, `/items/${target.itemId}`, 'PUT', {
      available_quantity: Math.max(1, Math.floor(Number(product.estoque))),
    });
    if (!stockResult.ok) throw new Error(`${target.sku}: estoque recusado (HTTP ${stockResult.status})`);

    const activationResult = await mlRequest(integration.access_token, `/items/${target.itemId}`, 'PUT', { status: 'active' });
    if (!activationResult.ok) throw new Error(`${target.sku}: ativação recusada (HTTP ${activationResult.status}: ${activationResult.data?.message || 'erro'})`);

    const after = await mlRequest(integration.access_token, `/items/${target.itemId}?include_internal_attributes=true`);
    if (!after.ok || after.data?.status !== 'active' || sellerSku(after.data) !== target.sku || Number(after.data?.available_quantity) <= 0) {
      throw new Error(`${target.sku}: validação final do ML falhou`);
    }

    const listingPayload = {
      ml_item_id: target.itemId,
      produto_id: product.id,
      sku: target.sku,
      titulo: after.data.title,
      thumbnail: after.data.thumbnail || null,
      permalink: after.data.permalink || null,
      preco_ml: Number(after.data.price || 0),
      status: 'ativo',
      tipo: after.data.listing_type_id === 'gold_pro' ? 'premium' : 'classico',
      catalogo: after.data.catalog_listing === true,
      updated_at: new Date().toISOString(),
    };
    const { error: upsertError } = await supabase.from('anuncios_ml').upsert(listingPayload, { onConflict: 'ml_item_id' });
    if (upsertError) throw new Error(`${target.sku}: ML ativado, mas vínculo ERP falhou: ${upsertError.message}`);
    const { error: productUpdateError } = await supabase.from('produtos').update({
      ml_item_id: target.itemId,
      ml_status: 'ativo',
    }).eq('id', product.id);
    if (productUpdateError) throw new Error(`${target.sku}: ML ativado, mas produto ERP falhou: ${productUpdateError.message}`);

    results.push({ ...target, action: 'activated', stock: after.data.available_quantity, catalog: after.data.catalog_listing === true });
    console.log(`${target.sku} ${target.itemId} active`);
  }

  const reportDir = path.resolve('reports/ml-repair-2026-08-03');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, APPLY ? 'activated-validated-listings.json' : 'activate-validated-listings-dry-run.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, total: results.length, results }, null, 2)}\n`);
  console.log(JSON.stringify({ apply: APPLY, total: results.length, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
