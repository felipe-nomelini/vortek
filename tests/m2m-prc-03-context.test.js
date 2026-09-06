const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const policy = require('../src/services/pricing-policy.ts');
const pricing = require('../src/services/pricing.ts');
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': pricing, './pricing-core.js': require('../src/services/pricing-core.js') });
const preferred = require('../src/lib/preferred-offer.ts');
const now = new Date(Date.now() - 60_000).toISOString();
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };
const product = { id: 'P1', ativo: true, oferta_preferencial_id: 'O1', fornecedor_preferencial_manual: true,
  ml_item_id: 'MLB1', custom_price: 100, ml_shipping_warning: 'not_specified', custo: 99999 };
const offer = { id: 'O1', produto_id: 'P1', ativo: true, custo: 40, estoque: 10, prioridade: 100,
  dslite_fornecedor_id: 'S1', updated_at: now };
const commercial = { mlFeeFallbackRate: .14, unspecifiedShippingCost: 10 };

function harness(rows = {}, overrideTax = tax) {
  const operations = [];
  const client = { from(table) {
    const filters = []; let page = null; const query = {
      select() { return this; }, in(field, values) { filters.push([field, values]); return this; },
      order() { return this; }, range(start, end) { page = [start, end]; return this; },
      returns() { return this; },
      then(resolve) {
        operations.push(table);
        const data = (rows[table] || []).filter(r => filters.every(([f, v]) => v.includes(r[f])));
        return Promise.resolve({ data: page ? data.slice(page[0], page[1] + 1) : data, error: null }).then(resolve);
      },
    }; return query;
  } };
  const module = load('src/services/pricing-context.ts', {
    'server-only': {}, './pricing-economy': economy,
    './commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => commercial },
    './pricing-tax-context': { loadPricingTaxContext: async () => overrideTax },
    '@/lib/preferred-offer': preferred,
    '@/lib/dslite/supplier-policy': { loadOperationalDropshippingSupplierIds: async () => new Set(['S1', 'S2']) },
  });
  return { ...module, client, operations,
    loadProductPricing: (client, products, options = { shippingModes: new Map(products.filter(p => p.ml_shipping_warning === 'not_specified')
      .map(p => [p.id, { mode: 'not_specified', mlItemId: p.ml_item_id, observedAt: now }])) }) => module.loadProductPricing(client, products, options),
  };
}

test('custo é a oferta manual válida; produto.custo não governa pricing', async () => {
  const h = harness({ produto_fornecedor_ofertas: [offer, { ...offer, id: 'O2', custo: 30 }] });
  const result = (await h.loadProductPricing(h.client, [product])).get('P1');
  assert.equal(result.current.status, 'estimated', JSON.stringify(result.current.reasons));
  assert.equal(result.current.memory.cost.amountCents, 4000);
  assert.equal(result.current.memory.context.offerId, 'O1');
  assert.equal(result.target.ok, true);
  assert.equal(result.target.evaluation.memory.band.target, .07);
  assert.equal(result.current.memory.revenueCents, 10000);
});

test('preferência inativa volta à menor oferta operacional válida', async () => {
  const h = harness({ produto_fornecedor_ofertas: [{ ...offer, ativo: false }, { ...offer, id: 'O2', custo: 30 },
    { ...offer, id: 'O3', custo: 1, dslite_fornecedor_id: 'RETIRED' }] });
  const result = (await h.loadProductPricing(h.client, [product])).get('P1');
  assert.equal(result.current.memory.context.offerId, 'O2');
  assert.equal(result.current.memory.cost.amountCents, 3000);
});

test('nenhuma oferta válida não vira CMV de produto nem zero', async () => {
  const h = harness(); const result = (await h.loadProductPricing(h.client, [product])).get('P1');
  assert.equal(result.current.status, 'inconclusive'); assert.equal(result.target.ok, false);
});

test('snapshot de frete e updated_at genérico não viram cotação ML', async () => {
  const h = harness({ produto_fornecedor_ofertas: [offer] });
  const result = (await h.loadProductPricing(h.client, [{ ...product, ml_shipping: 0, ml_shipping_warning: null, updated_at: now }])).get('P1');
  assert.equal(result.current.status, 'inconclusive');
  assert.ok(result.current.reasons.some(r => r.field === 'shipping' && r.code === 'DADO_AUSENTE'));
});

test('warning não comprova modalidade e cotação de outro anúncio não é reaproveitada', async () => {
  const h = harness({ produto_fornecedor_ofertas: [offer] });
  for (const options of [{}, { shippingModes: new Map([['P1', { mode: 'not_specified', mlItemId: 'OTHER', observedAt: now }]]) }]) {
    const result = (await h.loadProductPricing(h.client, [product], options)).get('P1');
    assert.ok(result.current.reasons.some(r => r.field === 'shipping' && r.code === 'DADO_AUSENTE'));
  }
});

test('kit simples registra oferta do componente × quantidade sem inventar oferta do pai', async () => {
  const component = { ...product, id: 'C1' };
  const h = harness({ produto_fornecedor_ofertas: [{ ...offer, produto_id: 'C1' }], produtos: [component],
    produto_kits: [{ produto_id: 'P1', ativo: true }],
    produto_kit_componentes: [{ kit_produto_id: 'P1', componente_produto_id: 'C1', quantidade: 3 }] });
  const result = (await h.loadProductPricing(h.client, [product])).get('P1');
  assert.equal(result.current.status, 'estimated');
  assert.equal(result.current.memory.cost.amountCents, 12000);
  assert.equal(result.current.memory.context.offerId, null);
  assert.equal(result.current.memory.context.quantity, 1);
  assert.deepEqual(result.current.memory.cost.composition,
    { productId: 'C1', offerId: 'O1', supplierId: 'S1', quantity: 3, unitCostCents: 4000 });
});

for (const invalid of ['compound', 'nested', 'inactive', 'fractional']) {
  test(`kit ${invalid} é inconclusivo sem expandir fulfillment`, async () => {
    const h = harness({ produto_fornecedor_ofertas: [{ ...offer, produto_id: 'C1' }],
      produtos: [{ ...product, id: 'C1', ativo: invalid !== 'inactive' }],
      produto_kits: [{ produto_id: 'P1', ativo: true }, ...(invalid === 'nested' ? [{ produto_id: 'C1', ativo: true }] : [])],
      produto_kit_componentes: [{ kit_produto_id: 'P1', componente_produto_id: 'C1', quantidade: invalid === 'fractional' ? 1.5 : 3 },
        ...(invalid === 'compound' ? [{ kit_produto_id: 'P1', componente_produto_id: 'C2', quantidade: 1 }] : [])] });
    assert.equal((await h.loadProductPricing(h.client, [product])).get('P1').target.ok, false);
  });
}

test('PGDAS exigível sem prova não é marcado como confirmado', async () => {
  const h = harness({ produto_fornecedor_ofertas: [offer] }, { ...tax, source: 'confirmed', confirmedRate: .04, manualRequired: true });
  const result = (await h.loadProductPricing(h.client, [product])).get('P1');
  assert.ok(result.current.reasons.some(r => r.code === 'PGDAS_NAO_COMPROVADO'));
});

test('um produto incompleto não derruba o lote', async () => {
  const h = harness({ produto_fornecedor_ofertas: [offer] });
  const results = await h.loadProductPricing(h.client, [product, { ...product, id: 'P2' }]);
  assert.equal(results.get('P1').target.ok, true); assert.equal(results.get('P2').target.ok, false);
  assert.equal(h.operations.filter(t => t === 'produto_fornecedor_ofertas').length, 1);
});

test('tarifa usa arredondamento central, inclusive meio centavo', () => {
  assert.equal(economy.calculateEconomicFeeCents(75, .14, 600), 611);
  assert.ok(Number.isNaN(economy.calculateEconomicFeeCents(100, -1, 0)));
});

test('oferta mais barata após a primeira página não é perdida', async () => {
  const offers = Array.from({ length: 201 }, (_, i) => ({ ...offer, id: `O${i}`, custo: i === 200 ? 1 : 40 }));
  const h = harness({ produto_fornecedor_ofertas: offers });
  const result = (await h.loadProductPricing(h.client, [{ ...product, fornecedor_preferencial_manual: false }])).get('P1');
  assert.equal(result.current.memory.context.offerId, 'O200');
  assert.equal(h.operations.filter(t => t === 'produto_fornecedor_ofertas').length, 2);
});

test('lote excessivo falha explicitamente antes de consultar o banco', async () => {
  const h = harness();
  await assert.rejects(h.loadProductPricing(h.client, Array(101).fill(product)), /até 100/);
  assert.equal(h.operations.length, 0);
});

test('simulação tem identidade hipotética explícita, sem IDs operacionais', () => {
  const h = harness();
  const context = { productId: null, offerId: null, supplierId: null, mlItemId: null, pricingGroupId: null,
    currency: 'BRL', unit: 'sale_unit', quantity: 1, referenceMonth: '2026-09', marketContextKey: 'simulation' };
  const component = { amountCents: 1000, condition: 'estimated', source: 'simulation', sourceId: 'simulator.input',
    observedAt: now, expiresAt: null, basis: 'unit', quantity: 1, marketContextKey: 'simulation', quotedPriceCents: null };
  const base = { scenario: 'simulation', evaluatedAt: now, context, offerEligible: false,
    cost: { ...component, amountCents: 4000 }, shipping: component,
    tax: { context: tax, observedAt: now, sourceId: 'tax-context', coverage: 'unknown', confirmation: null, realizedAmountCents: null } };
  const result = h.evaluateProductPricing(base, 10000, .14);
  assert.equal(result.current.status, 'estimated');
  assert.equal(result.target.ok, true);
  assert.equal(result.target.evaluation.memory.scenario, 'simulation');
  assert.equal(result.target.evaluation.memory.context.productId, null);
  assert.equal(h.evaluateProductPricing({ ...base, scenario: 'projected' }, 10000, .14).current.status, 'inconclusive');
  assert.equal(h.evaluateProductPricing({ ...base, context: { ...context, productId: 'FAKE' } }, 10000, .14).current.status, 'inconclusive');
});
