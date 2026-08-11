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
const REPORT_DIR = path.resolve('reports/ml-vehicle-compatibilities-2026-08-10');

function family(brand, model, year, note) {
  return {
    domain_id: MAIN_DOMAIN_ID,
    creation_source: 'DEFAULT',
    attributes: [
      { id: 'BRAND', value_name: brand },
      { id: 'MODEL', value_name: model },
      { id: 'VEHICLE_YEAR', value_name: String(year) },
    ],
    note,
  };
}

const TARGETS = [
  {
    sku: 'VTK018706',
    itemId: 'MLB7311575674',
    userProductId: 'MLBU4531620991',
    evidence: 'Descrição do produto no ERP: Fiat Stilo 2003, todos.',
    families: [family('Fiat', 'Stilo', 2003, 'Aplicação informada pelo fabricante: Stilo 2003.')],
  },
  {
    sku: 'VTK018518',
    itemId: 'MLB4981485621',
    userProductId: 'MLBU4531624693',
    evidence: 'Descrição do produto no ERP: Ford Ranger 2013, 2 portas.',
    families: [family('Ford', 'Ranger', 2013, 'Aplicação informada pelo fabricante: Ranger 2013, 2 portas.')],
  },
  {
    sku: 'VTK018613',
    itemId: 'MLB4981463283',
    userProductId: 'MLBU4531620909',
    evidence: 'Manual FKS MLV408 CO para Hyundai ix35; anos iniciais confirmados no catálogo do produto.',
    families: [
      family('Hyundai', 'ix35', 2010, 'Aplicação do módulo FKS MLV408 CO para Hyundai ix35.'),
      family('Hyundai', 'ix35', 2011, 'Aplicação do módulo FKS MLV408 CO para Hyundai ix35.'),
    ],
  },
  {
    sku: 'VTK019118',
    itemId: 'MLB7311576392',
    userProductId: 'MLBU4556924934',
    evidence: 'Aplicação Tury PRO 4.78 BR: Toyota Hilux e SW4 a partir de 2016.',
    families: [
      family('Toyota', 'Hilux', 2016, 'Aplicação Tury PRO 4.78 BR a partir de 2016.'),
      family('Toyota', 'SW4', 2016, 'Aplicação Tury PRO 4.78 BR a partir de 2016.'),
    ],
  },
  {
    sku: 'VTK017842',
    itemId: 'MLB7311574378',
    userProductId: 'MLBU4531609305',
    evidence: 'Aplicação Tury PRO 2.10 CR: Renault Duster 2016, vidros dianteiros.',
    families: [family('Renault', 'Duster', 2016, 'Aplicação Tury PRO 2.10 CR nos vidros dianteiros.')],
  },
  {
    sku: 'VTK017888',
    itemId: 'MLB4981462179',
    userProductId: 'MLBU4531609407',
    evidence: 'Aplicação Tury PRO 2.8 CW: Renault Duster 2016, vidros traseiros.',
    families: [family('Renault', 'Duster', 2016, 'Aplicação Tury PRO 2.8 CW nos vidros traseiros.')],
  },
  {
    sku: 'VTK019039',
    itemId: 'MLB4981463707',
    userProductId: 'MLBU4556924700',
    evidence: 'Descrição do produto no ERP: Hyundai Novo i30 2014.',
    families: [family('Hyundai', 'i30', 2014, 'Aplicação informada pelo fabricante: Novo i30 2014.')],
  },
  {
    sku: 'VTK019114',
    itemId: 'MLB4981486471',
    userProductId: 'MLBU4531625277',
    evidence: 'Descrição do produto no ERP: Toyota Etios 4 portas a partir de 2014.',
    families: [family('Toyota', 'Etios', 2014, 'Aplicação Soft AW32: Etios 4 portas a partir de 2014.')],
  },
  {
    sku: 'VTK019168',
    itemId: 'MLB4981464231',
    userProductId: 'MLBU4531625497',
    evidence: 'Descrição do produto no ERP: Honda City a partir de 2021.',
    families: [family('Honda', 'City', 2021, 'Aplicação Tury PRO 3.4 B a partir de 2021.')],
  },
  {
    sku: 'VTK018867',
    itemId: 'MLB4981505671',
    userProductId: 'MLBU4531691041',
    evidence: 'Descrição do produto no ERP: Kia Picanto a partir de 2011.',
    families: [family('Kia', 'Picanto', 2011, 'Aplicação informada pelo fabricante a partir de 2011.')],
  },
  {
    sku: 'VTK019046',
    itemId: 'MLB4981312507',
    userProductId: 'MLBU4556786374',
    evidence: 'Manual oficial Tury PRO 4.16 BM.',
    families: [
      family('Peugeot', '208', 2013, 'Aplicação Tury PRO 4.16 BM a partir de 2013.'),
      family('Peugeot', '2008', 2015, 'Aplicação Tury PRO 4.16 BM a partir de 2015.'),
      family('Citroën', 'Aircross', 2016, 'Aplicação Tury PRO 4.16 BM a partir de 2016.'),
    ],
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

function localStatus(status) {
  return status === 'active' ? 'ativo' : 'pausado';
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

async function familyCount(token, productFamily) {
  const result = await mlRequest(
    token,
    '/catalog_compatibilities/products_search/count_family_products',
    'POST',
    {
      domain_id: MAIN_DOMAIN_ID,
      attributes: productFamily.attributes,
    },
  );
  if (!result.ok) {
    throw new Error(`contagem recusada (HTTP ${result.status})`);
  }
  return Number(result.data?.count || 0);
}

async function waitForResult(token, target) {
  let item = null;
  let compatibilities = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    [item, compatibilities] = await Promise.all([
      mlRequest(token, `/items/${target.itemId}?include_internal_attributes=true`),
      mlRequest(
        token,
        `/user-products/${target.userProductId}/compatibilities?main_domain_id=${MAIN_DOMAIN_ID}&extended=true`,
      ),
    ]);
    const hasCompatibility = Number(compatibilities.data?.products?.length || 0) > 0
      || Number(compatibilities.data?.catalog_compatibilities_count || 0) > 0;
    if (item.ok && compatibilities.ok && hasCompatibility) return { item, compatibilities };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { item, compatibilities };
}

async function persistStatus(product, item) {
  const status = localStatus(item.status);
  const updatedAt = new Date().toISOString();
  const [{ error: productError }, { error: adError }] = await Promise.all([
    supabase
      .from('produtos')
      .update({ ml_status: status })
      .eq('id', product.id)
      .eq('ml_item_id', item.id),
    supabase
      .from('anuncios_ml')
      .update({ status, updated_at: updatedAt })
      .eq('ml_item_id', item.id),
  ]);
  if (productError || adError) {
    throw new Error(productError?.message || adError?.message || 'falha ao atualizar ERP');
  }
}

async function main() {
  const selected = SELECTED_SKUS.size > 0
    ? TARGETS.filter((target) => SELECTED_SKUS.has(target.sku))
    : TARGETS;
  if (SELECTED_SKUS.size > 0 && selected.length !== SELECTED_SKUS.size) {
    const found = new Set(selected.map((target) => target.sku));
    throw new Error(`SKU desconhecido: ${[...SELECTED_SKUS].filter((sku) => !found.has(sku)).join(', ')}`);
  }

  const [{ data: integration, error: integrationError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
    supabase
      .from('produtos')
      .select('id,sku,nome,descricao,estoque,ml_item_id,ml_status')
      .in('sku', selected.map((target) => target.sku)),
  ]);
  if (integrationError || !integration?.access_token) {
    throw new Error(integrationError?.message || 'Token Mercado Livre indisponível');
  }
  if (productError) throw new Error(productError.message);
  await assertAllowedMercadoLivreToken(
    integration.access_token,
    'fix-ml-vehicle-compatibilities-2026-08-10',
  );

  const productBySku = new Map((products || []).map((product) => [product.sku, product]));
  const results = [];

  for (const target of selected) {
    const product = productBySku.get(target.sku);
    const result = {
      sku: target.sku,
      itemId: target.itemId,
      userProductId: target.userProductId,
      evidence: target.evidence,
      action: APPLY ? 'failed' : 'would_add',
    };
    try {
      if (!product || product.ml_item_id !== target.itemId) {
        throw new Error('vínculo do SKU no ERP diverge do anúncio');
      }
      const [before, currentCompatibilities] = await Promise.all([
        mlRequest(integration.access_token, `/items/${target.itemId}?include_internal_attributes=true`),
        mlRequest(
          integration.access_token,
          `/user-products/${target.userProductId}/compatibilities?main_domain_id=${MAIN_DOMAIN_ID}&extended=true`,
        ),
      ]);
      if (!before.ok) throw new Error(`anúncio indisponível (HTTP ${before.status})`);
      if (!currentCompatibilities.ok) {
        throw new Error(`compatibilidades indisponíveis (HTTP ${currentCompatibilities.status})`);
      }
      if (sellerSku(before.data) !== target.sku) throw new Error('SKU ao vivo diverge do ERP');
      if (before.data.user_product_id !== target.userProductId) {
        throw new Error('produto do anúncio diverge do esperado');
      }
      const currentCount = Number(currentCompatibilities.data?.products?.length || 0)
        + Number(currentCompatibilities.data?.catalog_compatibilities_count || 0);
      if (currentCount > 0) {
        result.action = 'already_fixed';
        result.before = { status: before.data.status, tags: before.data.tags, currentCount };
        results.push(result);
        continue;
      }

      const counts = [];
      for (const productFamily of target.families) {
        const count = await familyCount(integration.access_token, productFamily);
        if (count < 1) {
          const attributes = productFamily.attributes.map((row) => row.value_name).join(' / ');
          throw new Error(`veículo não encontrado no catálogo: ${attributes}`);
        }
        counts.push(count);
      }
      const totalCount = counts.reduce((total, count) => total + count, 0);
      if (totalCount > 200) throw new Error(`seleção excede 200 veículos (${totalCount})`);

      const payload = {
        domain_id: MAIN_DOMAIN_ID,
        category_id: before.data.category_id,
        products_families: target.families,
      };
      result.before = {
        status: before.data.status,
        subStatus: before.data.sub_status,
        tags: before.data.tags,
      };
      result.familyCounts = counts;
      result.totalVehicles = totalCount;
      result.payload = payload;
      if (!APPLY) {
        results.push(result);
        console.log(`${target.sku}: validado (${totalCount} veículos no catálogo)`);
        continue;
      }

      const created = await mlRequest(
        integration.access_token,
        `/user-products/${target.userProductId}/compatibilities`,
        'POST',
        payload,
      );
      if (!created.ok) {
        throw new Error(`Mercado Livre recusou (HTTP ${created.status}: ${created.data?.message || JSON.stringify(created.data)})`);
      }

      const after = await waitForResult(integration.access_token, target);
      const createdCount = Number(after.compatibilities?.data?.products?.length || 0)
        + Number(after.compatibilities?.data?.catalog_compatibilities_count || 0);
      if (!after.item?.ok || !after.compatibilities?.ok || createdCount < 1) {
        throw new Error('Mercado Livre aceitou, mas a conferência final não encontrou os veículos');
      }
      await persistStatus(product, after.item.data);
      result.action = 'compatibilities_added';
      result.response = created.data;
      result.after = {
        status: after.item.data.status,
        subStatus: after.item.data.sub_status,
        tags: after.item.data.tags,
        compatibilityCount: createdCount,
      };
      console.log(`${target.sku}: corrigido (${createdCount} veículos; ${after.item.data.status})`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      results.push(result);
      console.error(`${target.sku}: ${result.error}`);
      continue;
    }
    results.push(result);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    selected: selected.length,
    corrected: results.filter((result) => result.action === 'compatibilities_added').length,
    alreadyFixed: results.filter((result) => result.action === 'already_fixed').length,
    validated: results.filter((result) => result.action === 'would_add').length,
    failed: results.filter((result) => result.action === 'failed').length,
    activeAfter: results.filter((result) => result.after?.status === 'active').length,
    pendingReviewAfter: results.filter((result) => result.after?.status === 'under_review').length,
    notAutomated: [
      { sku: 'VTK017608', reason: 'lâmpada H9 universal; compatibilidade universal indisponível na API de produção' },
      { sku: 'VTK019659', reason: 'palheta universal e sem estoque; manter pausado' },
      { sku: 'VTK018513', reason: 'lâmpada HB3/9005 universal; compatibilidade universal indisponível na API de produção' },
      { sku: 'VTK018224', reason: 'módulo universal condicionado ao sistema elétrico; não há veículo único seguro' },
    ],
    results,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, APPLY ? 'applied.json' : 'dry-run.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, results: undefined, reportPath }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
