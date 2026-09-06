const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const policy = require('../src/services/pricing-policy.ts');
const taxRules = require('../src/services/pricing.ts');
const core = require('../src/services/pricing-core.js');
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': taxRules, './pricing-core.js': core });
const view = load('src/lib/pricing-view.ts');
const evaluatedAt = '2026-09-06T12:00:00.000Z';
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };
const context = load('src/services/pricing-context.ts', {
  'server-only': {}, './pricing-economy': economy,
  './commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => ({ mlFeeFallbackRate: .14, unspecifiedShippingCost: 10 }) },
  './pricing-tax-context': { loadPricingTaxContext: async () => tax },
  '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'),
  '@/lib/dslite/supplier-policy': { loadOperationalDropshippingSupplierIds: async () => new Set() },
});
const sample = (i, complete = true) => context.simulateProductPricing({
  costCents: complete ? 3000 + i : null, shippingCents: 1000, priceCents: 10000 + i,
  feeRate: .14, taxContext: tax, evaluatedAt,
});
const query = { search: '', supplierIds: [], includeInternal: false, active: 'todos',
  mlStatus: '', stock: '', priceField: 'cost', priceMin: null, priceMax: null,
  sortBy: 'profit', sortOrder: 'desc', page: 1, pageSize: 100 };
const rows = Array.from({ length: 1105 }, (_, i) => ({
  product: { id: String(i), sku: String(i).padStart(5, '0'), estoque: 2, ml_status: 'sem_anuncio', pricing: sample(i, i !== 1104) },
  preferredOffer: null, offersCount: 0,
}));

function queryModule(extra = {}) {
  return load('src/services/product-pricing-query.ts', {
    'server-only': {}, './pricing-context': context, '@/lib/pricing-view': view,
    '@/lib/ml/product-listings': {}, '@/lib/orders/fulfillment-capacity-loader': {}, ...extra,
  });
}

test('filtro, ordenação e resumo abrangem mais de 1000 produtos antes da paginação', () => {
  const { selectPricedProducts } = queryModule();
  const result = selectPricedProducts(rows, { ...query, priceMin: 40, sortBy: 'custo', sortOrder: 'desc' });
  assert.equal(result.total, 104);
  assert.equal(result.data.length, 100);
  assert.equal(result.data[0].product.id, '1103');
  assert.equal(result.summary.total, 104);
  const all = selectPricedProducts(rows, { ...query, priceMin: 40, pageSize: 2000 });
  const second = selectPricedProducts(rows, { ...query, priceMin: 40, page: 2 });
  assert.equal(second.data.length, 4);
  assert.deepEqual(result.summary, all.summary);
  assert.equal(result.summary.receitaPotencial, all.data.reduce((sum, r) => sum + r.product.pricing.target.priceCents * 2, 0) / 100);
});

test('inconclusivo permanece null e não contamina média nem vira receita zero', () => {
  const { selectPricedProducts } = queryModule();
  const all = selectPricedProducts(rows, query);
  assert.equal(all.summary.receitaPotencial, null);
  assert.equal(all.summary.pricingInconclusive, 1);
  assert.equal(all.summary.profitSampleCount, 1104);
  const missing = selectPricedProducts([rows.at(-1)], query);
  assert.equal(missing.summary.lucroMedio, null);
  assert.equal(view.pricingView(rows.at(-1).product.pricing).cost, null);
  assert.equal(view.pricingView(undefined).profit, null);
});

test('carregamento em lotes não trunca 1105 registros e compartilha contexto por requisição', async () => {
  const calls = []; const supplied = { evaluatedAt, taxContext: tax };
  const q = queryModule({
    './pricing-context': { loadProductPricing: async (_, batch, options) => {
      assert.equal(options.requestContext, supplied);
      assert.ok(batch.length <= 100);
      calls.push(batch.length);
      return new Map(batch.map(p => [p.id, p.pricing]));
    } },
    '@/lib/ml/product-listings': { loadProductMlListings: async () => new Map() },
    '@/lib/orders/fulfillment-capacity-loader': { loadProductFulfillmentCapacities: async (_, ids) => new Map(ids.map(id => [id, { safe: 2, internal: 2, supplier: 0 }])) },
  });
  const client = {
    rpc: async (_, args) => {
      assert.equal(args.p_tax_rate, undefined);
      assert.equal(args.p_price_min, undefined);
      return { data: { data: rows.slice((args.p_page - 1) * 100, args.p_page * 100), total: rows.length }, error: null };
    },
    from: () => ({ select() { return this; }, in() { return this; }, returns: async () => ({ data: [], error: null }) }),
  };
  const result = await q.queryPricedProducts(client, { ...query, page: 12 }, supplied);
  assert.equal(result.total, 1105); assert.equal(result.data.length, 5);
  assert.equal(calls.length, 12); assert.equal(calls.at(-1), 5);
});

test('paginação detecta lote repetido sem laço infinito ou resumo parcial', async () => {
  const q = queryModule({
    './pricing-context': { loadProductPricing: async (_, batch) => new Map(batch.map(p => [p.id, p.pricing])) },
    '@/lib/ml/product-listings': { loadProductMlListings: async () => new Map() },
    '@/lib/orders/fulfillment-capacity-loader': { loadProductFulfillmentCapacities: async (_, ids) => new Map(ids.map(id => [id, { safe: 2, internal: 2, supplier: 0 }])) },
  });
  const client = {
    rpc: async () => ({ data: { data: rows.slice(0, 100) }, error: null }),
    from: () => ({ select() { return this; }, in() { return this; }, returns: async () => ({ data: [], error: null }) }),
  };
  await assert.rejects(q.queryPricedProducts(client, query, {}), /lista mudou/);
});

test('simulador autentica antes do contexto e rejeita campos legados sem efeitos', async () => {
  let allowed = false; let reads = 0;
  const route = load('src/app/api/configuracoes/comercial/simular/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } }, zod: require('zod'),
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => { reads++; return {}; } },
    '@/lib/auth/admin': { requireAdminUser: async () => allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 403 }) } },
    '@/services/pricing-tax-context': { loadPricingTaxContext: async () => tax },
    '@/services/pricing-context': context,
  });
  const input = { costCents: 4000, shippingCents: 1000, feeRate: .14, priceCents: 10000 };
  const request = data => new Request('http://localhost/simular', { method: 'POST', body: JSON.stringify(data) });
  assert.equal((await route.POST(request(input))).status, 403); assert.equal(reads, 0);
  allowed = true;
  assert.equal((await route.POST(request({ ...input, minProfit: 20 }))).status, 422); assert.equal(reads, 0);
  const response = await route.POST(request(input)); const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.equal(payload.pricing.current.memory.resultCents, context.simulateProductPricing({ ...input, taxContext: tax, evaluatedAt }).current.memory.resultCents);
  assert.equal(payload.pricing.target.priceCents, context.simulateProductPricing({ ...input, taxContext: tax, evaluatedAt }).target.priceCents);
  assert.equal(payload.pricing.current.memory.scenario, 'simulation');
});

test('PDF usa uma única leitura completa, inclusive com economia inconclusiva', async () => {
  let reads = 0;
  const pdfLib = require('pdf-lib');
  const route = load('src/app/api/produtos/exportar-pdf/route.ts', {
    'node:fs/promises': require('node:fs/promises'), 'node:path': { default: require('node:path') }, 'pdf-lib': pdfLib,
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/services/product-list': { getProductListResponse: async (_, allRows) => {
      reads++; assert.equal(allRows, true);
      return Response.json({ data: [rows[0], rows.at(-1)], total: 2, fornecedores: [] });
    } },
    '@/lib/pricing-view': view, '@/theme/bentevi': require('../src/theme/bentevi.ts'),
    '@/lib/commercial-pricing': require('../src/lib/commercial-pricing.ts'),
  });
  const response = await route.GET(new Request('http://localhost/api/produtos/exportar-pdf'));
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  const document = await pdfLib.PDFDocument.load(await response.arrayBuffer());
  assert.ok(document.getPageCount() > 0);
});
