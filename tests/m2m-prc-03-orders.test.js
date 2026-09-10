const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const policy = require('../src/services/pricing-policy.ts');
const pricing = require('../src/services/pricing.ts');
const core = require('../src/services/pricing-core.js');
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': pricing, './pricing-core.js': core });
const orderProfit = load('src/lib/ml/order-profit.ts', { '../../services/pricing-core.js': core });
const tax = { appliedRate: .05, estimatedRate: .05, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-08', manualRequired: false, warning: null };
const detail = { id: 1, total_amount: 200, date_closed: '2026-09-01T01:00:00Z',
  order_items: [{ item: { id: 'MLB1' }, quantity: 2, sale_fee: 10 }] };
const proof = [{ itemId: 'MLB1', quantity: 2, totalCostCents: 8000, evidenceId: 'invoice:1:item:1' }];
function harness() {
  const months = [];
  const result = load('src/services/orders.ts', {
    '@/lib/supabase': { createServiceClient: () => ({ from() { throw Error('Custo atual não pode ser consultado'); } }) },
    './integration': { fetchML: async () => { throw Error('Chamada externa não autorizada'); } },
    './pricing-tax-context': { loadPricingTaxContext: async (_, date) => {
      months.push(date.toISOString()); return { ...tax, referenceMonth: date.toISOString().slice(0, 7) };
    } },
    './pricing-economy': economy, '@/lib/ml/order-sale-date': require('../src/lib/ml/order-sale-date.ts'),
    '@/lib/ml/order-profit': orderProfit,
  });
  return { ...result, months };
}
const options = { allowShipmentFetch: false, sellerShippingCost: 10, taxContext: tax, historicalCosts: proof };

test('pedido usa CMV de todos os itens, tarifa × quantidade e base total explícita', async () => {
  const h = harness();
  const result = await h.calculateOrderProfit(detail, null, options);
  assert.equal(result.custoTotal, 80); assert.equal(result.taxasTotal, 20);
  assert.equal(result.imposto, 10); assert.equal(result.lucro, 80);
  assert.equal(result.lucro * 100, core.calculateEconomicTotalsCents({
    basis: 'order_total', revenueCents: 20000, costCents: 8000, feeCents: 2000, shippingCents: 1000, taxCents: 1000,
  }));
});
test('custo histórico ausente, parcial, duplicado ou quantidade divergente não confirma lucro', async () => {
  const h = harness();
  for (const historicalCosts of [undefined, [], [...proof, ...proof], [{ ...proof[0], quantity: 1 }], [{ ...proof[0], evidenceId: '' }]]) {
    assert.equal((await h.calculateOrderProfit(detail, null, { ...options, historicalCosts })).lucro, null);
  }
  assert.equal((await h.calculateOrderProfit({ ...detail, order_items: [...detail.order_items,
    { item: { id: 'MLB2' }, quantity: 1, sale_fee: 1 }] }, null, options)).lucro, null);
});
test('competência usa venda concretizada no fuso oficial e compartilha leitura entre pedidos', async () => {
  const h = harness(); const taxContexts = new Map();
  const opts = { ...options, taxContext: undefined, taxContexts };
  await Promise.all([h.calculateOrderProfit(detail, null, opts), h.calculateOrderProfit(detail, null, opts)]);
  assert.deepEqual(h.months, ['2026-08-01T00:00:00.000Z']);
  await h.calculateOrderProfit({ ...detail, payments: [{ status: 'approved', date_approved: '2026-09-02T12:00:00Z' }] }, null, opts);
  assert.equal(h.months[1], '2026-09-01T00:00:00.000Z');
});
test('alíquota de outra competência, PGDAS pendente e receita ausente não viram zero confirmado', async () => {
  const h = harness();
  for (const taxContext of [{ ...tax, referenceMonth: '2026-09' }, { ...tax, manualRequired: true }, { ...tax, appliedRate: null }]) {
    const result = await h.calculateOrderProfit(detail, null, { ...options, taxContext });
    assert.equal(result.imposto, null); assert.equal(result.lucro, null);
  }
  assert.equal((await h.calculateOrderProfit({ ...detail, total_amount: undefined }, null, options)).lucro, null);
  assert.equal((await h.calculateOrderProfit(null)).imposto, null);
});
test('sync não sobrescreve lucro histórico e não aceita cobertura parcial', () => {
  const source = fs.readFileSync('src/app/api/sync/pedidos/route.ts', 'utf8');
  assert.match(source, /existingPedido\?\.lucro == null && typeof lucro === 'number'/);
  assert.match(source, /lucro === null \|\| !freteDisponivel \|\| custoProdutoPendente/);
  assert.match(source, /historicalCosts,/);
  assert.match(source, /loadOrderItemCmvSnapshots/);
  assert.doesNotMatch(source, /lucro_pendente_produto'[\s\S]{0,180}snapshot\.incompleto = true/);
});
test('entrypoints e comandos de campanhas aposentadas não permanecem disponíveis', () => {
  const scripts = fs.readdirSync('scripts').filter(name =>
    /^(run-ml-p0-.+|finalize-ml-p0-.+|cleanup-ml-listings|seo-reactivation|apply-supplier-pricing-campaign|create-ml-batch-from-manifest|create-profitable-shelf-listings|prepare-ml-anuncio-batches|prepare-profitable-shelf-2)\.js$/.test(name));
  assert.deepEqual(scripts, []);
  const commands = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
  assert.deepEqual(Object.keys(commands).filter(name =>
    /^(ml:p0:|test:ml-p0-|ml:shelf:|ml:family-names:|ml:seo-|seo-reactivation:|cleanup:ml-listings:)/.test(name)), []);
  assert.equal(commands['test:ml-quantity-pricing'], 'node --test tests/ml-quantity-pricing.test.js');
});

for (const quantity of [1, 3, 5, 10]) {
  test(`compra normal de ${quantity} unidades mantém preço unitário e economia total`, async () => {
    const h = harness();
    const order = { ...detail, total_amount: 100 * quantity,
      order_items: [{ item: { id: 'MLB1' }, quantity, unit_price: 100, sale_fee: 10 }] };
    const original = structuredClone(order);
    const result = await h.calculateOrderProfit(order, null, { ...options,
      historicalCosts: [{ ...proof[0], quantity, totalCostCents: 4000 * quantity }] });
    assert.equal(result.custoTotal, 40 * quantity);
    assert.equal(result.taxasTotal, 10 * quantity);
    assert.equal(result.imposto, 5 * quantity);
    assert.equal(result.lucro, 45 * quantity - 10);
    assert.deepEqual(order, original);
  });
}
