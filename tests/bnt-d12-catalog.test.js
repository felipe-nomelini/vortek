const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildCatalogOptinTargets,
  catalogCompetitionPresentation,
  classifyCatalogEligibility,
} = require('../src/lib/catalogo/dashboard.ts');

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
  assert.doesNotMatch(view, /Reanálise de Preço/);
});
