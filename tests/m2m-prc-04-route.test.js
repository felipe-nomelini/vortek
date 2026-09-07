const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const quote = load('src/services/pricing-market-quote.ts', { './pricing-economy': {} });
const product = { id: 'P1', ml_item_id: 'MLB1', altura: 10, largura: 20, profundidade: 30, peso_bruto: .7605 };
const item = { id: 'MLB1', seller_id: 123, currency_id: 'BRL', price: 100, listing_type_id: 'gold_special',
  category_id: 'MLB10', condition: 'new', catalog_listing: false, tags: ['dynamic_standard_price'],
  shipping: { mode: 'me2', logistic_type: 'drop_off', free_shipping: true } };
const context = { categoryId: 'MLB10', listingType: 'gold_special', condition: 'new', mode: 'me2', logisticType: 'drop_off', freeShipping: true };
const pricing = { currentPriceCents: 10000, costCents: 4000, current: { status: 'inconclusive', memory: null, reasons: [] },
  target: { ok: false, reasons: [] }, floor: { ok: false, reasons: [] }, breakEven: { ok: false, reasons: [] } };
function harness(options = {}) {
  const calls = []; const captured = []; const p = { ...product, ...options.product }; let itemReads = 0;
  const client = { from(table) { return { select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ error: null, data: table === 'produtos' ? p : options.unlinked ? null : { ml_item_id: 'MLB1' } }) }; } };
  const routes = load('src/app/api/ml/anuncio/preco-detalhe/route.ts', {
    '@/services/pricing-audit': { recordPricingEvaluation: async () => 'evaluation-test' },
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } }, zod: require('zod'),
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: 'U1' } } }) } }), createServiceClient: () => client },
    '@/services/integration': { fetchMLResult: async path => {
      calls.push(path);
      if (options.mlDown) return { ok: false };
      if (path === '/users/me') return { ok: true, data: { id: 123, site_id: 'MLB' } };
      if (path === '/items/MLB1') return { ok: true, data: { ...item, ...(options.item || {}),
        ...(++itemReads > 1 && options.changed ? { price: 101 } : {}) } };
      if (path === '/categories/MLB10') return { ok: true, data: { id: 'MLB10', settings: { listing_allowed: true }, children_categories: [] } };
      if (path === '/users/123/shipping_preferences') return { ok: true, data: { logistics: [{ mode: 'me2', types: [{ type: 'drop_off' }] }] } };
      if (path === '/categories/MLB10/shipping_preferences') return { ok: true, data: { logistics: [{ mode: 'me2', types: ['drop_off'] }] } };
      if (path.includes('/prices')) return { ok: true, data: { prices: [] } };
      throw new Error('Unexpected endpoint');
    } },
    '@/services/pricing-live': { loadLiveProductPricing: async (_client, _product, market, price, verify) => {
      captured.push({ market, price, valid: await verify() }); return pricing;
    } },
    '@/services/pricing-market-quote': quote,
    '@/lib/pricing-view': require('../src/lib/pricing-view.ts'),
    '@/lib/products/bnt-d07-visual-review': { loadBntD07VisualReview: async () => options.review || null },
    '@/lib/ml/quantity-pricing': require('../src/lib/ml/quantity-pricing.ts'),
    '@/lib/ml/item-price-policy': require('../src/lib/ml/item-price-policy.ts'),
    '@/lib/catalogo/no-catalogo': require('../src/lib/catalogo/no-catalogo.ts'),
  });
  return { calls, captured, get: query => routes.GET(new Request('http://localhost/api/ml/anuncio/preco-detalhe?' + query)),
    post: body => routes.POST(new Request('http://localhost/api/ml/anuncio/preco-detalhe', { method: 'POST', body: JSON.stringify(body) })) };
}
test('401, contrato estrito e fixture são recusados antes de qualquer chamada ML', async () => {
  const anonymous = harness({ anonymous: true }); assert.equal((await anonymous.get('produtoId=P1')).status, 401); assert.equal(anonymous.calls.length, 0);
  for (const body of [{ produtoId: 'P1', sellerId: 999 }, { produtoId: 'P1', priceCents: 0 }, { produtoId: 'P1', context: { ...context, extra: true } }, { produtoId: 'bnt-d07-review-1' }]) {
    const h = harness(); const response = await h.post(body); assert.ok([409, 422].includes(response.status)); assert.equal(h.calls.length, 0);
  }
  const h = harness({ review: { items: [{ product: { id: 'bnt-d07-review-X' }, mlListings: [{ itemId: 'MLB1' }] }] } });
  assert.equal((await h.post({ produtoId: 'P1', mlItemId: 'MLB1' })).status, 409); assert.equal(h.calls.length, 0);
});
test('GET mantém preço, descontos e automação; avaliação identificada não altera preço', async () => {
  const h = harness(); const response = await h.get('produtoId=P1&mlItemId=MLB1');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.equal(body.evaluationId, 'evaluation-test'); assert.equal(body.currentPrice, 100); assert.deepEqual(body.quantityPricing, []); assert.equal(body.automaticPricing.active, true);
  assert.equal(h.captured[0].market.sellerId, '123'); assert.equal(h.captured[0].market.dimensions, null); assert.equal(h.captured[0].valid, true);
});
test('POST consulta preço alternativo sem atribuir seu lucro ao preço atual', async () => {
  const h = harness(); const response = await h.post({ produtoId: 'P1', priceCents: 13000 });
  assert.equal(response.status, 200); assert.equal(h.captured[0].price, 13000); assert.equal((await response.json()).currentProfit, null);
});
test('tipo gratuito observado é preservado no item existente, sem simular tarifa de Clássico', async () => {
  const h = harness({ item: { listing_type_id: 'free' } });
  assert.equal((await h.get('produtoId=P1')).status, 200);
  assert.equal(h.captured[0].market.listingType, 'free');
});
test('novo produto exige contexto explícito, valida categoria/logística e converte kg para gramas', async () => {
  const h = harness({ product: { ml_item_id: null } });
  assert.equal((await h.post({ produtoId: 'P1' })).status, 422);
  const response = await h.post({ produtoId: 'P1', context }); assert.equal(response.status, 200);
  assert.equal(h.captured[0].market.dimensions, '10x20x30,761'); assert.equal(h.captured[0].price, null);
  assert.equal(h.captured[0].valid, true);
  assert.equal(h.calls.filter(p => p === '/categories/MLB10/shipping_preferences').length, 2);
});
test('logística incompatível, dimensões ausentes, vínculo divergente e seller alheio não são cotados', async () => {
  for (const [options, body] of [
    [{ product: { ml_item_id: null } }, { produtoId: 'P1', context: { ...context, logisticType: 'fulfillment' } }],
    [{ product: { ml_item_id: null, peso_bruto: null } }, { produtoId: 'P1', context }],
    [{ unlinked: true }, { produtoId: 'P1', mlItemId: 'MLB9' }],
    [{ item: { seller_id: 999 } }, { produtoId: 'P1' }],
    [{}, { produtoId: 'P1', context }],
  ]) { const h = harness(options); assert.equal((await h.post(body)).status, 422); assert.equal(h.captured.length, 0); }
});
test('fonte indisponível é explícita; alteração do anúncio invalida contexto', async () => {
  const down = harness({ mlDown: true }); const response = await down.get('produtoId=P1');
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  const changed = harness({ changed: true }); await changed.get('produtoId=P1'); assert.equal(changed.captured[0].valid, false);
});
