const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const produtoId = '11111111-1111-4111-8111-111111111111';
const body = { produtoId, mlItemId: 'MLB123', priceCents: 350000 };

function harness(options = {}) {
  const reads = [];
  const client = { from(table) {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ error: null,
      data: table === 'produtos' ? { id: produtoId, ml_item_id: 'MLB123' }
        : { produto_id: options.owner || produtoId } }) };
    return query;
  } };
  const route = load('src/app/api/catalogo/preco/preview/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => options.unauthorized
      ? { ok: false, response: Response.json({ error: 'Não autorizado' }, { status: 403 }) }
      : { ok: true, userId: 'actor' } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/services/integration': { fetchMLResult: async endpoint => {
      reads.push(endpoint);
      if (endpoint === '/users/me') return { ok: true, data: { id: 123, site_id: 'MLB' } };
      return { ok: true, data: { id: 'MLB123', seller_id: options.otherSeller ? 456 : 123,
        catalog_listing: options.notCatalog ? false : true, price: 3829.8, tags: ['dynamic_standard_price'] } };
    } },
    '@/services/pricing-economy': { evaluateEconomicMemory: ({ priceCents }) => options.economyMissing
      ? { status: 'inconclusive', memory: null }
      : { status: 'available', memory: { resultCents: -1000, margin: -0.1, band: { floor: 0.1 } } } },
    '@/services/pricing-context': { loadPricingRequestContext: async () => ({ commercial: {
      mlFeeFallbackRate: 0.15, unspecifiedShippingCost: 0 } }),
    loadProductPricing: async (_client, _products, input) => {
      input.evaluate({ context: { productId: produtoId } }, body.priceCents, 0.15); return new Map();
    }, evaluateProductPricing: () => ({}) },
    '@/services/pricing-market-quote': { marketContextKey: context => JSON.stringify(context), observedMarketContext: (item, seller) =>
      String(item.seller_id) === seller ? { sellerId: seller, itemId: item.id } : null,
    quoteMoney: value => Math.round(value * 100),
    readMarketQuote: async input => { reads.push(`quote:${input.priceCents}`); return {
      fee: { source: options.fallbackFee ? 'fallback' : 'ml_live' }, shipping: { amountCents: 1000 },
    }; } },
    '@/lib/ml/item-price-policy': { hasMlAutomaticPrice: item => item.tags.includes('dynamic_standard_price') },
  });
  return { reads, post: value => route.POST(new Request('http://localhost/api/catalogo/preco/preview', {
    method: 'POST', body: JSON.stringify(value) })) };
}

test('prévia consulta um único preço sem escrever e mostra perda, piso e automação', async () => {
  const h = harness();
  const response = await h.post(body);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.priceCents, body.priceCents);
  assert.equal(result.currentPriceCents, 382980);
  assert.equal(result.resultCents, -1000);
  assert.equal(result.marginPercent, -10);
  assert.equal(result.automaticPricingActive, true);
  assert.deepEqual(result.warnings, ['PRECO_ABAIXO_DO_PISO', 'PREJUIZO_PREVISTO']);
  assert.deepEqual(h.reads, ['/users/me', '/items/MLB123', 'quote:350000']);
});

test('tarifa sem confirmação viva é inconclusiva e não apresenta lucro como exato', async () => {
  const result = await (await harness({ fallbackFee: true }).post(body)).json();
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.resultCents, null);
  assert.deepEqual(result.warnings, ['ECONOMIA_INCONCLUSIVA']);
});

test('preço já observado vira aviso, sem criar outra etapa de confirmação', async () => {
  const result = await (await harness().post({ ...body, priceCents: 382980 })).json();
  assert.equal(result.warnings.includes('PRECO_JA_APLICADO'), true);
  assert.equal(result.priceCents, result.currentPriceCents);
});

test('prévia recusa acesso, valor, vínculo, seller e anúncio incompatíveis', async () => {
  assert.equal((await harness({ unauthorized: true }).post(body)).status, 403);
  assert.equal((await harness().post({ ...body, priceCents: 0 })).status, 422);
  assert.equal((await harness({ owner: 'outro' }).post(body)).status, 422);
  assert.equal((await harness({ otherSeller: true }).post(body)).status, 409);
  assert.equal((await harness({ notCatalog: true }).post(body)).status, 409);
});

test('catálogo usa um painel, prévia automática e confirmação única sem modal', () => {
  const view = fs.readFileSync(path.join(__dirname, '../src/components/catalogo/CatalogoView.tsx'), 'utf8');
  assert.match(view, /setTimeout\(\(\) => void \(async \(\) =>/);
  assert.match(view, /controller\.abort\(\); clearTimeout\(timer\)/);
  assert.match(view, /requestId !== previewRequest\.current/);
  assert.match(view, /Confirmar alteração/);
  assert.match(view, /setOperations\(current => \(\{ \.\.\.current, \[activeCatalog\.ml_item_id\]/);
  assert.doesNotMatch(view, /<Modal|<ProgressModal|setPriceReview/);
});
