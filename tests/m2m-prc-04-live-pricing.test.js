const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const economy = load('src/services/pricing-economy.ts', {
  './pricing-policy': require('../src/services/pricing-policy.ts'), './pricing': require('../src/services/pricing.ts'),
  './pricing-core.js': require('../src/services/pricing-core.js'),
});
const market = load('src/services/pricing-market-quote.ts', { './pricing-economy': economy });
const context = { sellerId: '123', itemId: 'MLB1', categoryId: 'MLB10', catalogProductId: null, listingType: 'gold_special',
  condition: 'new', mode: 'me2', logisticType: 'drop_off', freeShipping: true, dimensions: null, currency: 'BRL', quantity: 1 };
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };
const now = new Date(Date.now() - 60000).toISOString();
const key = market.marketContextKey(context);
const product = { id: 'P1', ativo: true, oferta_preferencial_id: 'O1', fornecedor_preferencial_manual: true,
  ml_item_id: 'MLB1', custom_price: 100, altura: 10, largura: 10, profundidade: 10, peso_bruto: .8 };
const offer = { id: 'O1', produto_id: 'P1', ativo: true, custo: 40, estoque: 10, prioridade: 100,
  dslite_fornecedor_id: 'S1', updated_at: now };
const commercial = { mlFeeFallbackRate: .14, unspecifiedShippingCost: 10 };
const base = () => ({ scenario: 'projected', evaluatedAt: now, offerEligible: true,
  context: { productId: 'P1', offerId: 'O1', supplierId: 'S1', mlItemId: 'MLB1', pricingGroupId: null,
    currency: 'BRL', unit: 'sale_unit', quantity: 1, referenceMonth: '2026-09', marketContextKey: key },
  cost: { amountCents: 4000, source: 'offer', sourceId: 'O1', condition: 'known', observedAt: now,
    expiresAt: null, basis: 'unit', quantity: 1, marketContextKey: key, quotedPriceCents: null },
  tax: { context: tax, observedAt: now, sourceId: 'tax', coverage: 'unknown', confirmation: null, realizedAmountCents: null },
});
function mlFetch(calls, transform = x => x) {
  return async path => {
    calls.push(path);
    const url = new URL(path, 'https://test.invalid');
    const p = Number(url.searchParams.get('price'));
    const data = path.includes('shipping_options/free')
      ? { coverage: { all_country: { list_cost: 10, currency_id: 'BRL', billable_weight: 800 } } }
      : [{ listing_type_id: 'gold_special', currency_id: 'BRL', sale_fee_amount: (economy.calculateEconomicFeeCents(Math.round(p * 100), .14, 600)) / 100,
        sale_fee_details: { percentage_fee: 14, fixed_fee: 6 } }];
    return transform({ ok: true, data }, path);
  };
}
const read = (fetch, options = {}) => market.readMarketQuote({ fetch, context, priceCents: 10000,
  fallbackRate: .14, unspecifiedShippingCost: 10, ...options });

test('total ML inclui fixa uma única vez; contexto completo e peso faturável são enviados', async () => {
  const calls = []; const quote = await read(mlFetch(calls));
  assert.equal(quote.fee.amountCents, 2000); assert.equal(quote.fixedFeeCents, 600); assert.equal(quote.feeRate, .14);
  assert.equal(quote.shipping.amountCents, 1000); assert.equal(quote.shipping.condition, 'estimated');
  assert.equal(quote.fee.marketContextKey, key); assert.equal(quote.fee.quotedPriceCents, 10000);
  const ship = new URL(calls[0], 'https://test.invalid').searchParams;
  for (const [name, value] of Object.entries({ item_id: 'MLB1', item_price: '100', listing_type_id: 'gold_special',
    mode: 'me2', logistic_type: 'drop_off', condition: 'new', free_shipping: 'true' })) assert.equal(ship.get(name), value);
  assert.equal(new URL(calls[1], 'https://test.invalid').searchParams.get('billable_weight'), '800');
  const result = economy.evaluateEconomicMemory({ ...base(), evaluatedAt: new Date().toISOString(), priceCents: 10000, fee: quote.fee, shipping: quote.shipping });
  assert.equal(result.memory.resultCents, 2600); // 100 - 40 - 20 - 10 - 4
});

for (const bad of [null, {}, { options: [{ cost: 0, list_cost: 10 }] }, { coverage: { all_country: { list_cost: null, currency_id: 'BRL' } } },
  { coverage: { all_country: { list_cost: 10, currency_id: 'ARS' } } }]) {
  test(`frete incompleto/recebedor/moeda não vira zero: ${JSON.stringify(bad)}`, async () => {
    const quote = await read(mlFetch([], (result, path) => path.includes('shipping_options') ? { ok: true, data: bad } : result));
    assert.equal(quote.shipping.amountCents, null);
  });
}
test('zero explícito com contexto completo é válido; falha ML não usa snapshot de produto', async () => {
  const quote = await read(mlFetch([], (r, p) => {
    if (p.includes('shipping_options')) r.data.coverage.all_country.list_cost = 0;
    return r;
  }));
  assert.equal(quote.shipping.amountCents, 0);
  const missing = await read(async () => ({ ok: false }));
  assert.equal(missing.shipping.amountCents, null); assert.equal(missing.fee.source, 'fallback');
  assert.equal(missing.fee.condition, 'estimated');
});
test('fallback de frete exclusivo not_specified e novo produto usa dimensões comprovadas', async () => {
  const calls = []; const quote = await read(mlFetch(calls), { context: { ...context, mode: 'not_specified' } });
  assert.equal(calls.length, 1); assert.equal(quote.shipping.source, 'fallback'); assert.equal(quote.shipping.amountCents, 1000);
  const calls2 = []; await read(mlFetch(calls2), { context: { ...context, itemId: null, dimensions: '10x10x10,800' } });
  assert.equal(new URL(calls2[0], 'https://test.invalid').searchParams.get('dimensions'), '10x10x10,800');
});
test('tarifa de outro tipo, moeda ou resposta ambígua não é aplicada; percentual não deriva do total', async () => {
  for (const change of [rows => { rows[0].listing_type_id = 'gold_pro'; }, rows => { rows[0].currency_id = 'ARS'; }, rows => rows.push({ ...rows[0] })]) {
    const quote = await read(mlFetch([], (r, p) => { if (!p.includes('shipping_options')) change(r.data); return r; }));
    assert.equal(quote.fee.source, 'fallback');
  }
  const quote = await read(mlFetch([], (r, p) => { if (!p.includes('shipping_options')) delete r.data[0].sale_fee_details; return r; }));
  assert.equal(quote.fee.source, 'ml_live'); assert.equal(quote.feeRate, null); assert.equal(quote.fixedFeeCents, null);
});

for (const price of [20000, 20001, 100000, 100001]) test(`recota e estabiliza a partir da fronteira ${price}`, async () => {
  const b = base(); b.cost.amountCents = Math.round(price * .68);
  const candidates = []; const fetch = mlFetch([]);
  const result = await economy.projectQuotedEconomicPrice({ base: b, seedCents: price, objective: 'target',
    quote: p => { candidates.push(p); return read(fetch, { priceCents: p }); } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.evaluation.memory.fee.source, 'ml_live');
  assert.equal(result.evaluation.memory.fee.quotedPriceCents, result.priceCents);
  assert.equal(result.evaluation.memory.shipping.quotedPriceCents, result.priceCents);
  assert.ok(result.evaluation.memory.margin >= result.evaluation.memory.band.target);
  assert.ok(candidates.length <= economy.ECONOMIC_MAX_REFINEMENTS);
});
test('recota frete e tarifa quando candidato muda, sem extrapolar total anterior', async () => {
  const fetch = mlFetch([], (r, path) => {
    if (path.includes('shipping_options')) r.data.coverage.all_country.list_cost = Number(new URL(path, 'https://test.invalid').searchParams.get('item_price')) < 100 ? 15 : 10;
    return r;
  });
  const result = await economy.projectQuotedEconomicPrice({ base: base(), seedCents: 10000, objective: 'target', quote: p => read(fetch, { priceCents: p }) });
  assert.equal(result.ok, true); assert.equal(result.evaluation.memory.shipping.amountCents, 1500);
});
test('oscilações falham explicitamente sem devolver última semente como validada', async () => {
  let count = 0;
  const fetch = mlFetch([], (r, path) => {
    if (path.includes('shipping_options')) r.data.coverage.all_country.list_cost = ++count % 2 ? 10 : 80;
    return r;
  });
  const result = await economy.projectQuotedEconomicPrice({ base: base(), seedCents: 10000, objective: 'target', quote: p => read(fetch, { priceCents: p }) });
  assert.equal(result.ok, false); assert.equal(result.reasons[0].code, 'PRECIFICACAO_NAO_CONVERGIU');
  assert.ok(count <= economy.ECONOMIC_MAX_REFINEMENTS);
});

function liveHarness({ mutate = () => {}, transform = x => x, verify = async () => true, rows: customRows = {} } = {}) {
  const calls = []; let productReads = 0;
  const rows = { produtos: [structuredClone(product)], produto_fornecedor_ofertas: [structuredClone(offer)], ...customRows };
  const client = { from(table) {
    const filters = []; let page, single = false;
    const query = { select() { return this; }, in(f, v) { filters.push([f, v]); return this; }, eq(f, v) { filters.push([f, [v]]); return this; },
      order() { return this; }, range(a, b) { page = [a, b]; return this; }, returns() { return this; }, maybeSingle() { single = true; return this; },
      then(resolve) { if (table === 'produtos' && single && ++productReads === 1) mutate(rows);
        const data = (rows[table] || []).filter(r => filters.every(([f, values]) => values.includes(r[f])));
        return Promise.resolve({ data: single ? data[0] ?? null : page ? data.slice(page[0], page[1] + 1) : data, error: null }).then(resolve); },
    }; return query;
  } };
  const contextModule = load('src/services/pricing-context.ts', {
    'server-only': {}, './pricing-economy': economy, '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'),
    './commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => commercial },
    './pricing-tax-context': { loadPricingTaxContext: async () => tax },
    '@/lib/dslite/supplier-policy': { loadOperationalDropshippingSupplierIds: async () => new Set(['S1']) },
  });
  const live = load('src/services/pricing-live.ts', { 'server-only': {}, './integration': { fetchMLResult: mlFetch(calls, transform) },
    './pricing-economy': economy, './pricing-context': contextModule, './pricing-market-quote': market });
  return { calls, run: () => live.loadLiveProductPricing(client, structuredClone(product), context, 10000, verify) };
}
test('integração usa oferta real e serviço canônico, deduplica por preço somente dentro da consulta', async () => {
  const h = liveHarness(); const result = await h.run();
  assert.equal(result.revalidation.status, 'queried', JSON.stringify(result));
  assert.equal(result.current.memory.cost.amountCents, 4000); assert.equal(result.current.memory.context.offerId, 'O1');
  assert.equal(result.current.memory.fee.amountCents, 2000); assert.equal(result.current.memory.tax.status, 'estimated');
  assert.equal(new Set(h.calls).size, h.calls.length);
  const length = h.calls.length; await h.run(); assert.equal(h.calls.length, length * 2);
});
for (const timestamp of [now.replace('Z', '+00:00'), now.replace('Z', '456+00:00'), '2026-09-02T01:19:34.638-03:00']) {
  test(`timestamp timestamptz da oferta é normalizado na entrada: ${timestamp}`, async () => {
    const result = await liveHarness({ rows: { produto_fornecedor_ofertas: [{ ...offer, updated_at: timestamp }] } }).run();
    assert.equal(result.revalidation.status, 'queried', JSON.stringify(result));
    for (const memory of [result.current.memory, result.target.evaluation.memory,
      result.floor.evaluation.memory, result.breakEven.evaluation.memory]) {
      assert.equal(memory.cost.observedAt, new Date(timestamp).toISOString());
      assert.equal(memory.cost.amountCents, 4000);
    }
  });
}
for (const timestamp of ['', 'invalid', '2026-09-02', '2099-09-02T01:19:34.638+00:00']) {
  test(`data ausente, inválida, ambígua ou futura não é substituída por agora: ${timestamp}`, async () => {
    const result = await liveHarness({ rows: { produto_fornecedor_ofertas: [{ ...offer, updated_at: timestamp }] } }).run();
    assert.equal(result.revalidation.status, 'inconclusive');
    assert.equal(result.current.memory, null);
    assert.equal(result.target.ok, false);
    assert.ok(result.current.reasons.some(r => r.field === 'cost' && r.code === 'DADO_INVALIDO'));
  });
}
for (const mutate of [r => r.produto_fornecedor_ofertas[0].custo++, r => { r.produtos[0].ativo = false; },
  r => { r.produto_fornecedor_ofertas[0].ativo = false; }, r => { r.produtos[0].peso_bruto++; }, r => { r.produtos[0].ml_item_id = 'MLB2'; }]) {
  test(`revalidação material invalida consulta: ${mutate}`, async () => {
    const result = await liveHarness({ mutate }).run();
    assert.equal(result.revalidation.code, 'CONTEXTO_ALTERADO'); assert.equal(result.target.ok, false); assert.equal(result.current.memory, null);
  });
}
test('atualização não material preserva resultado e falha viva não confirma prejuízo', async () => {
  assert.equal((await liveHarness({ mutate: r => { r.produto_fornecedor_ofertas[0].updated_at = new Date().toISOString(); } }).run()).revalidation.status, 'queried');
  for (const verify of [async () => false, async () => null]) {
    const result = await liveHarness({ verify }).run(); assert.equal(result.current.memory, null); assert.equal(result.target.ok, false);
  }
  const result = await liveHarness({ transform: () => ({ ok: false }) }).run();
  assert.equal(result.revalidation.code, 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL'); assert.equal(result.current.memory, null);
});
test('sem oferta não faz consulta comercial; escrita não faz parte desta entrega', async () => {
  const h = liveHarness({ rows: { produto_fornecedor_ofertas: [] } });
  const result = await h.run(); assert.equal(result.revalidation.status, 'inconclusive'); assert.equal(h.calls.length, 0);
  for (const file of ['src/services/pricing-live.ts', 'src/services/pricing-market-quote.ts', 'src/app/api/ml/anuncio/preco-detalhe/route.ts']) {
    const source = fs.readFileSync(file, 'utf8'); assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  }
});
