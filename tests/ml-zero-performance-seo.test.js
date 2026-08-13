const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPlainTextDescription,
  descriptionNeedsOptimization,
  factualAttributes,
  sanitizeTitle,
  sanitizeGeneratedDescription,
  validateEvidenceTitle,
} = require('../scripts/lib/ml-zero-performance-seo');

test('sanitiza claims, acentos e símbolos proibidos', () => {
  assert.equal(
    sanitizeTitle('Pilha AA Original + Pronta Entrega NF'),
    'Pilha AA',
  );
});

test('termo proibido não bloqueia trecho interno de marca', () => {
  assert.deepEqual(
    validateEvidenceTitle('Alicate Hikari HK 701', 'Alicate Hikari HK 701', 60),
    { ok: true },
  );
});

test('título aceita somente evidência e sinônimos permitidos', () => {
  assert.deepEqual(
    validateEvidenceTitle('Pilha AA Pequena Elgin 8 Unidades', '8 Pilhas AA Elgin', 60),
    { ok: true },
  );
  assert.equal(
    validateEvidenceTitle('Pilha AA Elgin Industrial', '8 Pilhas AA Elgin', 60).reason,
    'title_without_evidence',
  );
});

test('atributos factuais não sobrescrevem valor existente', () => {
  assert.deepEqual(factualAttributes({ attributes: [{ id: 'BRAND', value_name: 'Elgin' }] }, {
    marca: 'Outra', gtin: '7891234567890',
  }), [{ id: 'GTIN', value_name: '7891234567890' }]);
});

test('descrição é plain text factual', () => {
  const description = buildPlainTextDescription({
    productName: 'Pilha AA Elgin', sku: 'VTK1',
    attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'Elgin' }],
  });
  assert.match(description, /CARACTERISTICAS/);
  assert.match(description, /- Marca: Elgin/);
  assert.doesNotMatch(description, /[#*_]/);
});

test('preserva descrição estruturada e filtra atributos internos', () => {
  assert.equal(descriptionNeedsOptimization('PRODUTO\n\nCARACTERISTICAS\n- A: 1\n- B: 2\n- C: 3'), false);
  assert.equal(descriptionNeedsOptimization('Texto curto'), true);
  const sanitized = sanitizeGeneratedDescription([
    'PRODUTO', '', 'CARACTERISTICAS', '- Marca: Elgin',
    '- É marca TOM: Não', '- Altura da embalagem do vendor: 10 cm',
    '- SKU: VTK1', '', 'SKU: VTK1',
  ].join('\n'), 'VTK1');
  assert.doesNotMatch(sanitized, /vendor|marca TOM|- SKU:/i);
  assert.match(sanitized, /SKU: VTK1/);
});
