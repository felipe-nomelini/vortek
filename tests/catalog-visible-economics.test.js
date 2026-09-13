const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const competition = require('../src/lib/catalogo/competition-evidence.ts');
const presentation = require('../src/lib/catalogo/visible-economics.ts');
const bulk = require('../src/lib/ml/items-bulk.ts');
const market = load('src/services/pricing-market-quote.ts', {
  './pricing-economy': { calculateEconomicFeeCents: (price, rate, fixed) => Math.round(price * rate) + fixed },
});

const observedAt = '2026-09-13T12:00:00.000Z';
const item = { id: 'MLB1', site_id: 'MLB', seller_id: 123, currency_id: 'BRL', catalog_listing: true,
  catalog_product_id: 'MLB10', category_id: 'MLB20', listing_type_id: 'gold_special', condition: 'new',
  price: 100, shipping: { mode: 'me2', logistic_type: 'drop_off', free_shipping: true } };
const priceToWin = { item_id: 'MLB1', catalog_product_id: 'MLB10', currency_id: 'BRL',
  current_price: 100, price_to_win: 90, status: 'competing', consistent: true };

test('persistência competitiva aceita somente a resposta integralmente compatível', () => {
  const valid = competition.validatedCatalogCompetition(priceToWin, item, observedAt, true);
  assert.equal(valid.evidence.condition, 'valid');
  assert.deepEqual(valid.payload, { status: 'competing', price_to_win: 90 });
  for (const change of [{ item_id: 'MLB2' }, { currency_id: 'ARS' }, { current_price: 101 },
    { catalog_product_id: 'MLB11' }, { consistent: false }, { status: 'unknown' }]) {
    const result = competition.validatedCatalogCompetition({ ...priceToWin, ...change }, item, observedAt, true);
    assert.equal(result.evidence.condition, 'inconsistent');
    assert.equal(result.payload, null);
  }
  const absent = competition.validatedCatalogCompetition({ ...priceToWin, price_to_win: null, status: 'listed' }, item, observedAt, true);
  assert.deepEqual(absent.payload, { status: 'listed', price_to_win: null });
});

test('contexto de cotação não infere conta, moeda, site ou logística', () => {
  assert.equal(market.observedMarketContext(item, '123').itemId, 'MLB1');
  for (const changed of [{ site_id: 'MLA' }, { seller_id: 456 }, { currency_id: 'ARS' },
    { shipping: { ...item.shipping, mode: null } }, { listing_type_id: 'invalid' }]) {
    assert.equal(market.observedMarketContext({ ...item, ...changed }, '123'), null);
  }
});

function fakeEconomic(priceCents, fee, shipping, evaluatedAt) {
  if (!priceCents || fee?.amountCents == null || shipping?.amountCents == null) {
    return { status: 'inconclusive', memory: null, reasons: [{ field: 'shipping', code: 'DADO_AUSENTE' }] };
  }
  const resultCents = priceCents - 4000 - fee.amountCents - shipping.amountCents;
  return { status: 'available', reasons: [], memory: { resultCents, margin: resultCents / priceCents, evaluatedAt } };
}

function harness({ competitivePrice = 90 } = {}) {
  const calls = [];
  const snapshot = { ml_item_id: 'MLB1', produto_id: 'P1', seller_id: 123, catalog_listing: true,
    catalog_product_id: 'MLB10', buy_box_status: 'competing', price: 100, price_to_win: 95,
    synced_at: '2026-09-13T11:59:00.000Z' };
  const product = { id: 'P1', ativo: true, oferta_preferencial_id: 'O1',
    fornecedor_preferencial_manual: true, ml_item_id: 'MLB1', custom_price: 100 };
  const client = { from(table) {
    const query = { select() { return query; }, in() { return query; }, then(resolve) {
      return Promise.resolve({ data: table === 'catalogo_ml_snapshot' ? [snapshot] : [product], error: null }).then(resolve);
    } };
    return query;
  } };
  const fetchMLResult = async path => {
    calls.push(path);
    if (path === '/users/me') return { ok: true, status: 200, data: { id: 123, site_id: 'MLB' }, error: null };
    if (path.startsWith('/items/bulk?')) return { ok: true, status: 200,
      data: [{ id: 'MLB1', status_code: 200, body: item }], error: null };
    if (path.includes('/price_to_win?')) return { ok: true, status: 200,
      data: { ...priceToWin, price_to_win: competitivePrice }, error: null };
    if (path.includes('/shipping_options/free?')) return { ok: true, status: 200,
      data: { coverage: { all_country: { currency_id: 'BRL', list_cost: 10, billable_weight: 500 } } }, error: null };
    if (path.includes('/listing_prices?')) {
      const price = Number(new URL(path, 'https://test.invalid').searchParams.get('price'));
      return { ok: true, status: 200, data: [{ listing_type_id: 'gold_special', currency_id: 'BRL',
        sale_fee_amount: price * .2, sale_fee_details: { percentage_fee: 20, fixed_fee: 0 } }], error: null };
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const pricingContext = {
    loadPricingRequestContext: async () => ({ evaluatedAt: observedAt, commercial: {
      mlFeeFallbackRate: .14, unspecifiedShippingCost: 0,
    } }),
    evaluateProductPricing: (base, price, _rate, fee) => ({ currentPriceCents: price, costCents: 4000,
      current: fakeEconomic(price, fee, base.shipping, base.evaluatedAt),
      target: { ok: false, reasons: [] }, floor: { ok: false, reasons: [] }, breakEven: { ok: false, reasons: [] } }),
    loadProductPricing: async (_client, products, options) => {
      const result = new Map();
      for (const row of products) {
        const evidence = options.evidence.get(row.id);
        const base = { evaluatedAt: observedAt, context: { productId: row.id, mlItemId: evidence.mlItemId,
          marketContextKey: evidence.marketContextKey }, shipping: evidence.shipping };
        result.set(row.id, options.evaluate(base, evidence.currentPriceCents, .14, evidence.fee));
      }
      return result;
    },
  };
  const service = load('src/services/catalog-visible-economics.ts', {
    'server-only': {}, '@/lib/catalogo/competition-evidence': competition,
    '@/lib/catalogo/visible-economics': presentation, '@/lib/ml/items-bulk': bulk,
    '@/services/integration': { fetchMLResult }, '@/services/pricing-context': pricingContext,
    '@/services/pricing-market-quote': market,
  });
  return { calls, snapshot, run: () => service.loadCatalogVisibleEconomics(client,
    [{ mlItemId: 'MLB1', snapshotSyncedAt: snapshot.synced_at }]) };
}

test('página calcula preço atual e preço para ganhar com frete e tarifa do preço correspondente', async () => {
  const h = harness();
  const response = await h.run();
  assert.equal(response.haltReason, null);
  assert.equal(response.data[0].reference.currentPrice, 100);
  assert.equal(response.data[0].reference.priceToWin, 90);
  assert.equal(response.data[0].reference.changedFromSnapshot, true);
  assert.equal(response.data[0].current.profit, 30);
  assert.equal(response.data[0].competitive.profit, 22);
  assert.equal(response.data[0].current.source, 'ml_live');
  assert.equal(response.data[0].competitive.source, 'ml_live');
  assert.equal(h.calls.filter(path => path.includes('/shipping_options/free?')).length, 2);
  assert.equal(h.calls.filter(path => path.includes('/listing_prices?')).length, 2);
});

test('mesmo preço reutiliza a cotação dentro da linha', async () => {
  const h = harness({ competitivePrice: 100 });
  const response = await h.run();
  assert.equal(response.data[0].competitive.profit, response.data[0].current.profit);
  assert.equal(h.calls.filter(path => path.includes('/shipping_options/free?')).length, 1);
  assert.equal(h.calls.filter(path => path.includes('/listing_prices?')).length, 1);
});

test('rota é autenticada, limitada e o cálculo não possui writers', () => {
  const route = fs.readFileSync('src/app/api/catalogo/no-catalogo/economics/route.ts', 'utf8');
  const service = fs.readFileSync('src/services/catalog-visible-economics.ts', 'utf8');
  const view = fs.readFileSync('src/components/catalogo/CatalogoView.tsx', 'utf8');
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /max\(CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE\)/);
  assert.match(service, /buildMlItemsBulkPath/);
  assert.doesNotMatch(service, /\.(?:insert|update|upsert|delete)\(/);
  assert.match(view, /CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE/);
  assert.match(view, /controller\.abort\(\)/);
  assert.match(view, /Nenhum preço será alterado/);
  assert.doesNotMatch(view, /setNewPrice\(row\.price_to_win/);
});

test('writers preservam a última competição válida diante de resposta inconsistente', () => {
  const refresh = fs.readFileSync('src/app/api/catalogo/no-catalogo/refresh/route.ts', 'utf8');
  const sync = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
  const backfill = fs.readFileSync('src/app/api/catalogo/no-catalogo/backfill-catalog-listing/route.ts', 'utf8');
  for (const source of [refresh, sync, backfill]) assert.match(source, /validatedCatalogCompetition/);
  assert.match(refresh, /previousCompetitionByItemId\.get\(itemId\)/);
  assert.match(sync, /price_to_win: pricePayload \? enrichment\.priceToWin : previous\?\.price_to_win/);
  assert.match(backfill, /if \(pricePayload\) \{[\s\S]*updatePayload\.price_to_win = enrichment\.priceToWin/);
});
