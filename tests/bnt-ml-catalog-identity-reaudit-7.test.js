const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('../scripts/catalog-identity-p0-reaudit-7.js');

test('reauditoria contém somente os sete anúncios bloqueados', () => {
  assert.equal(audit.CASES.length, 7);
  assert.equal(new Set(audit.CASES.map(row => row.sku)).size, 7);
  assert.equal(new Set(audit.CASES.map(row => row.ml_item_id)).size, 7);
  assert.equal(new Set(audit.CASES.map(row => row.catalog_product_id)).size, 7);
});

test('classificador libera identidade coerente e mantém pricing bloqueado nesta etapa', () => {
  const rule = audit.CASES.find(row => row.sku === 'VTK017306');
  const context = {
    listing: { ml_item_id: rule.ml_item_id, produto_id: 'p', sku: rule.sku, titulo: 'Cooler Evus CP130', status: 'ativo' },
    snapshot: { ml_item_id: rule.ml_item_id, seller_id: 3294514937, seller_sku: rule.sku,
      catalog_product_id: rule.catalog_product_id, title: 'Cooler Evus CP130' },
    product: { id: 'p', sku: rule.sku, nome: 'Cooler Para Processador Evus CP-130', marca: 'EVUS', gtin: rule.gtin },
    current: { identity_state: 'PENDENCIA_VALIDACAO', block_price_write: true, block_buy_box_chase: true },
    item: { id: rule.ml_item_id, seller_id: 3294514937, status: 'active', catalog_product_id: rule.catalog_product_id,
      title: 'Cooler Para Processador Evus CP130', attributes: [{ id: 'GTIN', value_name: rule.gtin }, { id: 'BRAND', value_name: 'Evus' }, { id: 'MODEL', value_name: 'CP130' }] },
    catalogProduct: { id: rule.catalog_product_id, status: 'active', name: 'Cooler Evus CP130',
      attributes: [{ id: 'GTIN', values: [{ name: rule.gtin }] }, { id: 'BRAND', values: [{ name: 'Evus' }] }] },
  };
  assert.equal(audit.classifyCase(rule, context).identity_state, 'SEM_CONFLITO');
  assert.equal(audit.classifyCase(rule, { ...context, item: { ...context.item, catalog_product_id: 'MLB_OUTRO' } }).identity_state, 'PENDENCIA_VALIDACAO');
});

test('barreira de rede recusa qualquer método mutante', async () => {
  const tracker = audit.safeFetchTracker(async () => ({ ok: true }));
  await assert.rejects(() => tracker.request('https://api.mercadolibre.com/items/MLB1', { method: 'PUT' }), /READONLY_METHOD_BLOCKED:PUT/);
  assert.equal(tracker.stats.mutation_attempts, 1);
});

test('script não contém escrita no banco ou no Mercado Livre', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog-identity-p0-reaudit-7.js'), 'utf8');
  assert.doesNotMatch(source, /\.from\([^\n]+\)\.(?:insert|update|upsert|delete)\(/);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.match(source, /pricing_eligible_by_identity:\s*false/);
});
