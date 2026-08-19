const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCanaryAttributes,
  buildCanaryDescription,
  buildCanaryTitle,
  classifyRemoteItem,
  comparePhase3,
  publicAttributes,
  validateGeneratedTitle,
} = require('../scripts/lib/ml-p0-phase4');

test('payload do canário usa somente SKU autorizado e título dentro do limite', () => {
  const title = buildCanaryTitle();
  const attributes = publicAttributes(buildCanaryAttributes());
  assert.equal(title.length, 56);
  assert.ok(title.length <= 60);
  assert.equal(attributes.find((attribute) => attribute.id === 'SELLER_SKU').value_name, 'VTK000486');
  assert.equal(attributes.find((attribute) => attribute.id === 'PRODUCT_TYPE').value_id, '28280064');
  assert.doesNotMatch(JSON.stringify(attributes), /VTK(?!000486)\d{6}/);
});

test('descrição contém conteúdo, compatibilidade e alerta comprovados', () => {
  const description = buildCanaryDescription();
  assert.match(description, /4 pilhas recarregáveis AA Toshiba 2600 mAh/);
  assert.match(description, /AA e AAA/);
  assert.match(description, /Não carrega baterias de 9 V/);
  assert.doesNotMatch(description, /https?:\/\//);
});

test('match remoto por GTIN bloqueia criação mesmo sem seller SKU', () => {
  const result = classifyRemoteItem({
    title: 'Carregador Toshiba TNHC-6GAE4',
    attributes: [
      { id: 'GTIN', value_name: '4904530109270' },
      { id: 'BRAND', value_name: 'Toshiba' },
      { id: 'MODEL', value_name: 'TNHC-6GAE4 CB' },
    ],
  }, {
    sku: 'VTK000486',
    gtin: '4904530109270',
    model: 'TNHC-6GAE4 CB',
    brand: 'Toshiba',
    catalog_product_id: 'MLB24107281',
  });
  assert.equal(result.match_type, 'EXACT_GTIN_MATCH');
  assert.equal(result.confidence, 100);
});

test('drift compara identidade, estoque, custo, oferta e estado comercial', () => {
  const current = {
    product: { id: 'p1', sku: 'VTK000486', gtin: '4904530109270', estoque: 15, oferta_preferencial_id: 'o1', ml_item_id: null, ml_status: 'sem_anuncio', ativo: true },
    offer: { custo: 96.22, ativo: true },
  };
  const baseline = { produto_id: 'p1', sku: 'VTK000486', gtin: '4904530109270', stock: 15, offer_id: 'o1', pricing: { cost: 96.22 } };
  assert.equal(comparePhase3(current, baseline).has_drift, false);
  current.product.estoque = 14;
  assert.equal(comparePhase3(current, baseline).has_drift, true);
});

test('valida título gerado pelo ML sem exigir detalhes opcionais do kit', () => {
  assert.equal(validateGeneratedTitle('Carregador de Pilhas Toshiba TNHC-6GAE4 CB').valid, true);
  assert.equal(validateGeneratedTitle('Carregador Toshiba TNHC-6GAE4 CB com 4 Pilhas AA 2600mAh').valid, true);
});

test('bloqueia título ML que deturpa quantidade, capacidade ou tensão', () => {
  assert.equal(validateGeneratedTitle('Carregador de Pilhas Toshiba TNHC-6GAE4 CB com 2 Pilhas').valid, false);
  assert.equal(validateGeneratedTitle('Carregador de Pilhas Toshiba TNHC-6GAE4 CB 950mAh').valid, false);
  assert.equal(validateGeneratedTitle('Carregador de Pilhas Toshiba TNHC-6GAE4 CB 220V').valid, false);
});
