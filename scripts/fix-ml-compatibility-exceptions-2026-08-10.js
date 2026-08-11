const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.env.APPLY === '1';
const SELECTED_SKUS = new Set(
  String(process.env.ML_COMPAT_SKUS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const MAIN_DOMAIN_ID = 'MLB-CARS_AND_VANS';
const TARGETS = [
  {
    sku: 'VTK017608',
    itemId: 'MLB4981461191',
    userProductId: 'MLBU4556916998',
    comment: 'Lâmpada universal H9 24 V. A aplicação depende do encaixe H9 e da tensão 24 V, não de um veículo específico.',
  },
  {
    sku: 'VTK019659',
    itemId: 'MLB4981464537',
    userProductId: 'MLBU4556925220',
    comment: 'Palheta universal de 26 polegadas. A aplicação depende da medida e do encaixe, não de um veículo específico.',
  },
  {
    sku: 'VTK018513',
    itemId: 'MLB7285499326',
    userProductId: 'MLBU4480892699',
    comment: 'Lâmpada universal HB3/9005 12 V 60 W. A aplicação depende do encaixe HB3/9005, não de um veículo específico.',
  },
  {
    sku: 'VTK018224',
    itemId: 'MLB4981496529',
    userProductId: 'MLBU4531688891',
    comment: 'Módulo universal. A aplicação depende do sistema elétrico e dos vidros automatizados de fábrica, não de um veículo único.',
  },
];

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sellerSku(item) {
  return String(
    (item?.attributes || []).find((attribute) => attribute.id === 'SELLER_SKU')?.value_name || '',
  ).trim();
}

async function mlRequest(token, pathname, method = 'GET', body) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

async function waitForException(token, userProductId) {
  let result = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    result = await mlRequest(
      token,
      `/user-products/${userProductId}/compatibilities/exception`,
    );
    if (result.ok && result.data?.has_exception === true) return result;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return result;
}

async function main() {
  const selected = SELECTED_SKUS.size
    ? TARGETS.filter((target) => SELECTED_SKUS.has(target.sku))
    : TARGETS;
  if (selected.length !== (SELECTED_SKUS.size || TARGETS.length)) {
    throw new Error('Há SKU solicitado fora da lista de exceções validada.');
  }

  const [{ data: integration, error: integrationError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
    supabase.from('produtos').select('id,sku,nome,descricao,estoque,ml_item_id').in('sku', selected.map((target) => target.sku)),
  ]);
  if (integrationError || !integration?.access_token) {
    throw new Error(integrationError?.message || 'Token Mercado Livre indisponível');
  }
  if (productError) throw new Error(productError.message);
  await assertAllowedMercadoLivreToken(
    integration.access_token,
    'fix-ml-compatibility-exceptions-2026-08-10',
  );
  const productBySku = new Map((products || []).map((product) => [product.sku, product]));
  const results = [];

  for (const target of selected) {
    const row = { ...target, action: APPLY ? 'failed' : 'would_add_exception' };
    try {
      const product = productBySku.get(target.sku);
      if (!product || product.ml_item_id !== target.itemId) throw new Error('vínculo do ERP diverge');
      const [item, compatibilities, exception] = await Promise.all([
        mlRequest(integration.access_token, `/items/${target.itemId}?include_internal_attributes=true`),
        mlRequest(integration.access_token, `/user-products/${target.userProductId}/compatibilities?main_domain_id=${MAIN_DOMAIN_ID}&extended=true`),
        mlRequest(integration.access_token, `/user-products/${target.userProductId}/compatibilities/exception`),
      ]);
      if (!item.ok || !compatibilities.ok || !exception.ok) throw new Error('consulta ao Mercado Livre falhou');
      if (sellerSku(item.data) !== target.sku || item.data.user_product_id !== target.userProductId) {
        throw new Error('SKU ou produto ao vivo diverge');
      }
      if (Number(compatibilities.data?.products?.length || 0) > 0) {
        throw new Error('anúncio já tem veículos; exceção não é permitida');
      }
      row.before = {
        status: item.data.status,
        subStatus: item.data.sub_status,
        tags: item.data.tags,
        hasException: exception.data?.has_exception === true,
        stock: product.estoque,
      };
      if (exception.data?.has_exception === true) {
        row.action = 'already_fixed';
        results.push(row);
        continue;
      }
      if (!APPLY) {
        results.push(row);
        console.log(`${target.sku}: exceção validada`);
        continue;
      }
      const created = await mlRequest(
        integration.access_token,
        `/user-products/${target.userProductId}/compatibilities/exception`,
        'POST',
        { comment: target.comment },
      );
      if (!created.ok) {
        throw new Error(`Mercado Livre recusou (HTTP ${created.status}: ${created.data?.message || JSON.stringify(created.data)})`);
      }
      const confirmed = await waitForException(integration.access_token, target.userProductId);
      if (!confirmed.ok || confirmed.data?.has_exception !== true) {
        throw new Error('exceção aceita, mas não confirmada na conferência final');
      }
      const afterItem = await mlRequest(integration.access_token, `/items/${target.itemId}`);
      row.action = 'exception_added';
      row.response = created.data;
      row.after = {
        status: afterItem.data?.status,
        subStatus: afterItem.data?.sub_status,
        tags: afterItem.data?.tags,
        hasException: true,
      };
      console.log(`${target.sku}: exceção registrada (${afterItem.data?.status || 'status indisponível'})`);
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`${target.sku}: ${row.error}`);
    }
    results.push(row);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    selected: selected.length,
    corrected: results.filter((row) => row.action === 'exception_added').length,
    alreadyFixed: results.filter((row) => row.action === 'already_fixed').length,
    validated: results.filter((row) => row.action === 'would_add_exception').length,
    failed: results.filter((row) => row.action === 'failed').length,
    results,
  };
  const reportDir = path.resolve('reports/ml-vehicle-compatibilities-2026-08-10');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, APPLY ? 'exceptions-applied.json' : 'exceptions-dry-run.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, results: undefined, reportPath }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
