const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  shouldSupplierOfferBeInactiveByCost,
} = require('../src/lib/product-activity.ts');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('mantém o limite comercial configurado com comparação estrita', () => {
  assert.equal(shouldSupplierOfferBeInactiveByCost(2000, 2000), false);
  assert.equal(shouldSupplierOfferBeInactiveByCost('2000', 2000), false);
  assert.equal(shouldSupplierOfferBeInactiveByCost(2000.01, 2000), true);
  assert.equal(shouldSupplierOfferBeInactiveByCost('2001', 2000), true);
  assert.equal(shouldSupplierOfferBeInactiveByCost(501, 500), true);
});

test('não classifica custos inválidos ou não positivos como custo alto', () => {
  for (const cost of [undefined, null, '', 'inválido', Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(shouldSupplierOfferBeInactiveByCost(cost, 2000), false);
  }
});

test('pricing automático reutiliza a regra central sem repetir o threshold', () => {
  const source = read('src/lib/ml/automatic-pricing.ts');

  assert.match(source, /shouldSupplierOfferBeInactiveByCost\(cost, commercial\.inactiveCostThreshold\)/);
  assert.doesNotMatch(source, /cost\s*>\s*2_?000/);
});

test('sync de preço torna a oferta inelegível sem alterar a atividade do produto', () => {
  const source = read('src/app/api/sync/preco-estoque/route.ts');

  assert.match(source, /ativo:\s*!inactiveOfferByCost/);
  assert.match(source, /\.lte\('custo', inactiveCostThreshold\)/);
  assert.doesNotMatch(source, /threshold:\s*2000/);
  assert.doesNotMatch(
    source,
    /\.from\(['"]produtos['"]\)[\s\S]{0,120}\.update\(\{\s*ativo:\s*false/,
  );
});

test('sync de catálogo cria produto ativo e aplica o threshold somente à oferta', () => {
  const source = read('src/app/api/sync/catalogo/route.ts');

  assert.match(source, /const insertPayload = \{[\s\S]{0,120}_product_key:[\s\S]{0,80}ativo:\s*true/);
  assert.match(source, /ativo:\s*!shouldSupplierOfferBeInactiveByCost\(/);
  assert.doesNotMatch(source, /ativo:\s*!inactiveByCost/);
});

test('rota de custo alto processa ofertas e preserva produtos.ativo', () => {
  const source = read('src/app/api/produtos/inativar-custo-alto/route.ts');
  const proxySource = read('src/proxy.ts');

  assert.match(source, /\.from\('produto_fornecedor_ofertas'\)[\s\S]{0,120}\.update\(\{ ativo: false \}/);
  assert.match(source, /products_without_eligible_offer/);
  assert.match(source, /loadProductFulfillmentCapacities\(client, productIds\)/);
  assert.doesNotMatch(
    source,
    /\.from\('produtos'\)[\s\S]{0,120}\.update\(\{\s*ativo:/,
  );
  assert.match(proxySource, /pathname === "\/api\/produtos\/inativar-custo-alto"/);
  assert.match(
    proxySource,
    /isInternalProductMaintenanceRoute[\s\S]{0,160}apiKey === process\.env\.API_SECRET_KEY/,
  );
});

test('importador Panasonic não sobrescreve a atividade de produto existente', () => {
  const source = read('scripts/import-panasonic-kits.js');

  assert.doesNotMatch(
    source,
    /\.from\('produtos'\)\s*\.update\(\{\s*ativo:\s*canFulfillInOneDsliteItem/,
  );
});
