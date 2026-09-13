const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildCatalogOptinTargets,
  catalogBoostPresentation,
  catalogCompetitionPresentation,
  catalogOperationalPresentation,
  classifyCatalogEligibility,
} = require('../src/lib/catalogo/dashboard.ts');
const {
  buildMercadoLivreCatalogProductUrl,
  resolveCatalogLocalProduct,
} = require('../src/lib/catalogo/no-catalogo.ts');

test('apresenta separadamente todos os estados oficiais da competição', () => {
  assert.equal(catalogCompetitionPresentation('winning').label, 'Ganhando');
  assert.equal(catalogCompetitionPresentation('sharing_first_place').label, 'Dividindo 1º lugar');
  assert.equal(catalogCompetitionPresentation('competing').label, 'Competindo');
  assert.equal(catalogCompetitionPresentation('listed').label, 'Fora da competição');
  assert.equal(catalogCompetitionPresentation('not_listed').label, 'Fora da competição');
  assert.equal(catalogCompetitionPresentation(null).label, 'Estado indisponível');
});

test('classifica elegibilidade sem esconder candidatos bloqueados', () => {
  const base = {
    local_product_id: 'produto-1',
    catalog_product_id: 'MLB123',
    catalog_product_status: 'active',
    eligibility_status: 'READY_FOR_OPTIN',
    variation_eligibility: [],
  };
  assert.equal(classifyCatalogEligibility(base).state, 'ready');
  assert.equal(classifyCatalogEligibility({ ...base, local_product_id: null }).state, 'local_product_missing');
  assert.equal(classifyCatalogEligibility({ ...base, catalog_product_status: 'inactive' }).state, 'catalog_product_unavailable');
  assert.equal(classifyCatalogEligibility({ ...base, catalog_product_warning: 'Divergência' }).state, 'review_required');
});

test('prioriza pendências operacionais e reconhece somente estados saudáveis confirmados', () => {
  const base = { status: 'active', produto_id: 'produto-1', buy_box_status: 'winning' };
  assert.equal(catalogOperationalPresentation(base).needsAction, false);
  assert.equal(catalogOperationalPresentation({ ...base, buy_box_status: 'competing' }).actionLabel, 'Revisar preço');
  assert.equal(catalogOperationalPresentation({ ...base, buy_box_status: 'unexpected' }).needsAction, true);
  assert.equal(catalogOperationalPresentation({ ...base, produto_id: null }).label, 'Produto não identificado no Bentevi');
  assert.equal(catalogOperationalPresentation({ ...base, status: 'paused' }).label, 'Anúncio pausado');
});

test('resolve produto local pelo vínculo mais confiável do par de anúncios', () => {
  const direct = { produto_id: 'produto-catalogo', sku: 'VTK000001' };
  const related = { produto_id: 'produto-padrao', sku: 'VTK000002' };
  const bySku = { id: 'produto-sku', sku: 'VTK000003' };
  const byGtin = { id: 'produto-gtin', sku: 'VTK000004' };

  assert.deepEqual(resolveCatalogLocalProduct({ catalogListing: direct, relatedListing: related, skuProduct: bySku, gtinProduct: byGtin }), {
    produtoId: 'produto-catalogo', sku: 'VTK000001', source: 'catalog_listing',
  });
  assert.deepEqual(resolveCatalogLocalProduct({ relatedListing: related, skuProduct: bySku, gtinProduct: byGtin }), {
    produtoId: 'produto-padrao', sku: 'VTK000002', source: 'related_listing',
  });
  assert.deepEqual(resolveCatalogLocalProduct({ skuProduct: bySku, gtinProduct: byGtin }), {
    produtoId: 'produto-sku', sku: 'VTK000003', source: 'sku',
  });
  assert.deepEqual(resolveCatalogLocalProduct({ gtinProduct: byGtin, fallbackSku: 'vtk000099' }), {
    produtoId: 'produto-gtin', sku: 'VTK000004', source: 'gtin',
  });
  assert.deepEqual(resolveCatalogLocalProduct({ fallbackSku: 'vtk000099' }), {
    produtoId: null, sku: 'VTK000099', source: 'none',
  });
});

test('atualização do catálogo consulta e reaproveita o vínculo do anúncio padrão', () => {
  const refreshRoute = fs.readFileSync(
    path.join(__dirname, '../src/app/api/catalogo/no-catalogo/refresh/route.ts'),
    'utf8',
  );
  assert.match(refreshRoute, /new Set\(\[\.\.\.allItemIds, \.\.\.relatedIdList\]\)/);
  assert.match(refreshRoute, /relatedListing = anuncioMap\.get\(baseRelatedItemId \|\| ''\)/);
  assert.match(refreshRoute, /resolveCatalogLocalProduct\(\{/);
});

test('sincronização geral não apaga o vínculo herdado do anúncio padrão', () => {
  const observedSyncRoute = fs.readFileSync(
    path.join(__dirname, '../src/app/api/sync/anuncios/route.ts'),
    'utf8',
  );
  assert.match(observedSyncRoute, /relatedLocalListingByItemId/);
  assert.match(observedSyncRoute, /\.from\('anuncios_ml'\)[\s\S]*\.select\('ml_item_id, produto_id, sku'\)/);
  assert.match(observedSyncRoute, /relatedListing: relatedLocalListingByItemId\.get\(enriched\.related_item_id \|\| ''\)/);
  assert.match(observedSyncRoute, /snapshot\.produto_id = localProduct\.produtoId/);
});

test('gera link público apenas para código válido de produto de catálogo', () => {
  assert.equal(
    buildMercadoLivreCatalogProductUrl('mlb21193637'),
    'https://www.mercadolivre.com.br/p/MLB21193637',
  );
  assert.equal(buildMercadoLivreCatalogProductUrl('código inválido'), null);
});

test('traduz os estados oficiais dos benefícios competitivos', () => {
  assert.equal(catalogBoostPresentation('boosted').label, 'Ativo e ajuda na disputa');
  assert.equal(catalogBoostPresentation('not_boosted').label, 'Ativo, mas sem vantagem');
  assert.equal(catalogBoostPresentation('opportunity').actionable, true);
  assert.equal(catalogBoostPresentation('not_apply').label, 'Não se aplica');
  assert.equal(catalogBoostPresentation(null).label, 'Situação não informada pelo Mercado Livre');
});

test('gera uma operação de opt-in para cada variação pronta', () => {
  assert.deepEqual(buildCatalogOptinTargets({
    ml_item_id: 'MLB1',
    catalog_product_id: 'MLB-PRODUCT',
    eligibility_status: null,
    variation_eligibility: [
      { id: 10, status: 'READY_FOR_OPTIN', buy_box_eligible: true, catalog_product_id: 'MLB-P10' },
      { id: 11, status: 'NOT_ELIGIBLE', buy_box_eligible: false, catalog_product_id: 'MLB-P11' },
      { id: 12, status: 'READY_FOR_OPTIN', buy_box_eligible: true, catalog_product_id: 'MLB-P12' },
    ],
  }), [
    { itemId: 'MLB1', catalogProductId: 'MLB-P10', variationId: 10 },
    { itemId: 'MLB1', catalogProductId: 'MLB-P12', variationId: 12 },
  ]);
});

test('mantém duas rotas com nomes inequívocos e acompanhamento compartilhado', () => {
  const navigation = fs.readFileSync(path.join(__dirname, '../src/lib/app-navigation.ts'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../src/components/catalogo/CatalogoView.tsx'), 'utf8');
  assert.match(navigation, /label: 'Anúncios de catálogo'/);
  assert.match(navigation, /label: 'Elegíveis ao catálogo'/);
  assert.match(view, /Anúncio padrão/);
  assert.match(view, /Produto de catálogo/);
  assert.match(view, /Anúncio de catálogo/);
  assert.match(view, /useMlPricePublishTracking/);
  assert.match(view, /Pendências/);
  assert.match(view, /Preço para ganhar/);
  assert.match(view, /Revisar alteração/);
  assert.match(view, /Confirmar alteração/);
  assert.match(view, /Detalhes técnicos/);
  assert.match(view, /className=\{styles\.mlCodeLink\}/);
  assert.match(view, /target="_blank" rel="noopener noreferrer"/);
  assert.match(view, /related_permalink/);
  assert.match(view, /buildMercadoLivreCatalogProductUrl/);
  assert.doesNotMatch(view, /Três identificadores diferentes|Preço e sincronização|Preparar proposta|Reanalisar oportunidades/);
  assert.doesNotMatch(view, /Reanálise de Preço/);
});

test('alteração manual do catálogo usa confirmação única sem pedir motivo ao operador', () => {
  const view = fs.readFileSync(path.join(__dirname, '../src/components/catalogo/CatalogoView.tsx'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/catalogo/preco/confirmar/route.ts'), 'utf8');
  assert.match(view, /api\/catalogo\/preco\/confirmar/);
  assert.match(route, /Alteração manual confirmada no Catálogo/);
  assert.match(route, /prepare_pricing_decision/);
  assert.match(route, /manage_pricing_decision/);
  assert.match(route, /enqueueApprovedPricingDecision/);
  assert.doesNotMatch(route, /reason:\s*z\./);
});

test('distingue falha de carregamento de uma lista realmente vazia', () => {
  const view = fs.readFileSync(path.join(__dirname, '../src/components/catalogo/CatalogoView.tsx'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/catalogo/elegiveis/route.ts'), 'utf8');

  assert.match(view, /Não foi possível carregar os anúncios elegíveis/);
  assert.match(view, /Tentar novamente/);
  assert.match(view, /AbortController/);
  assert.match(view, /!loading && total === 0/);
  assert.match(route, /O Mercado Livre não devolveu a elegibilidade de todos os anúncios solicitados/);
  assert.match(route, /status: authFatal \? 401 : 502/);
});
