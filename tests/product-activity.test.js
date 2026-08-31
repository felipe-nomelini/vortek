const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PRODUCT_COST_INACTIVE_THRESHOLD,
  shouldProductBeInactiveByCost,
} = require('../src/lib/product-activity.ts');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('mantém o limite central de custo com comparação estrita', () => {
  assert.equal(PRODUCT_COST_INACTIVE_THRESHOLD, 2000);
  assert.equal(shouldProductBeInactiveByCost(2000), false);
  assert.equal(shouldProductBeInactiveByCost('2000'), false);
  assert.equal(shouldProductBeInactiveByCost(2000.01), true);
  assert.equal(shouldProductBeInactiveByCost('2001'), true);
});

test('não classifica custos inválidos ou não positivos como custo alto', () => {
  for (const cost of [undefined, null, '', 'inválido', Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(shouldProductBeInactiveByCost(cost), false);
  }
});

test('pricing automático reutiliza a regra central sem repetir o threshold', () => {
  const source = read('src/lib/ml/automatic-pricing.ts');

  assert.match(source, /shouldProductBeInactiveByCost\(cost\)/);
  assert.doesNotMatch(source, /cost\s*>\s*2_?000/);
});

test('sync registra no outbox o mesmo threshold da regra central', () => {
  const source = read('src/app/api/sync/preco-estoque/route.ts');

  assert.match(source, /threshold:\s*PRODUCT_COST_INACTIVE_THRESHOLD/);
  assert.doesNotMatch(source, /threshold:\s*2000/);
});
