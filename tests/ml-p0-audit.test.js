const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePrice,
  extractLabeledGtins,
  identityTokens,
  isManufacturerHost,
  isValidGtin,
  normalizeGtin,
  reconcileOfficial,
  scoreAudit,
} = require('../scripts/lib/ml-p0-audit');

test('normaliza e valida GTIN-13', () => {
  assert.equal(normalizeGtin('7898566200414'), '7898566200414');
  assert.equal(isValidGtin('7898566200414'), true);
  assert.equal(isValidGtin('7898566200415'), false);
});

test('não trata marketplace como fabricante oficial', () => {
  assert.equal(isManufacturerHost('https://www.mercadolivre.com.br/item', 'Storm'), false);
  assert.equal(isManufacturerHost('https://storm.com.br/produto', 'Storm'), true);
});

test('confirma fabricante somente com GTIN exato em domínio da marca', () => {
  const result = reconcileOfficial({
    brand: 'Storm',
    gtin: '7898566200414',
    identifiers: ['RG6-100'],
    sources: [{ url: 'https://storm.com.br/rg6', title: 'Conector RG6', content: 'Código GTIN 7898566200414 modelo RG6-100' }],
  });
  assert.equal(result.status, 'fabricante_confirmado');
  assert.equal(result.gtin_match, true);
});

test('bloqueia GTIN divergente quando modelo coincide', () => {
  const result = reconcileOfficial({
    brand: 'Storm',
    gtin: '7898566200414',
    identifiers: ['RG6-100'],
    sources: [{ url: 'https://storm.com.br/rg6', title: 'RG6-100', content: 'Modelo RG6-100. GTIN 7898566200421.' }],
  });
  assert.equal(result.status, 'checagem_manual_gtin');
  assert.equal(result.gtin_match, false);
});

test('ignora números longos não rotulados em URLs de imagem', () => {
  assert.deepEqual(extractLabeledGtins('https://cdn.exemplo/imagem-17725631777427.jpg'), []);
  assert.deepEqual(extractLabeledGtins('EAN: 7898566200414'), ['7898566200414']);
});

test('aceita identidade sem GTIN apenas com combinação de identificadores exatos', () => {
  const identifiers = identityTokens('SZ-02', 'REF-2026', 'Suporte para teclado');
  const result = reconcileOfficial({
    brand: 'Saty',
    gtin: '',
    identifiers,
    sources: [{ url: 'https://saty.com.br/sz-02', title: 'SZ-02 REF-2026', content: 'Suporte para teclado modelo SZ-02, referência REF-2026.' }],
  });
  assert.equal(result.status, 'identidade_sem_gtin_confirmada');
});

test('motor preserva margem e lucro mínimo da regra atual', () => {
  const result = calculatePrice({ cost: 100, saleFeeRate: 0.15, shippingCost: 25 });
  assert.ok(result.grossMarginPercent >= 15);
  assert.ok(result.grossMargin >= 20);
});

test('score máximo exige todos os gates', () => {
  const score = scoreAudit({
    officialStatus: 'fabricante_confirmado', level1Identity: true, imageApproved: true,
    categoryValidated: true, requiredAttributesComplete: true, pricingApproved: true,
    duplicateChecked: true, technicalDivergence: false, sensitive: false, anyDivergence: false,
  });
  assert.equal(score, 100);
});
