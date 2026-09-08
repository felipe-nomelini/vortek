const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const contracts = require('../src/lib/configuracoes/contracts.ts');
const policy = require('../src/services/pricing-policy.ts');
const taxRules = require('../src/services/pricing.ts');
const evaluatedAt = '2026-09-08T12:00:00.000Z';
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };
const parameters = { mlFeeFallbackPercent: 15, unspecifiedShippingCost: 30, inactiveCostThreshold: 2000 };
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': taxRules,
  './pricing-core.js': require('../src/services/pricing-core.js') });
const context = load('src/services/pricing-context.ts', { 'server-only': {}, './pricing-economy': economy,
  './commercial-pricing-configuration': {}, './pricing-tax-context': {}, '@/lib/preferred-offer': {},
  '@/lib/dslite/supplier-policy': {} });
const request = (body, method = 'PUT') => new Request('http://localhost/comercial', { method, body: JSON.stringify(body) });

function adminRoute(options = {}) {
  const state = { values: { ...parameters }, writes: [], auditRows: [], reads: 0, clientCalls: 0 };
  const audit = load('src/services/configuration-audit.ts', { '@/lib/configuracoes/contracts': contracts });
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'save_commercial_pricing_configuration');
      if (options.rpcFailure) return { error: { message: 'Gravação indisponível' } };
      state.writes.push(args);
      state.values = { mlFeeFallbackPercent: args.p_ml_fee_fallback_rate * 100,
        unspecifiedShippingCost: args.p_unspecified_shipping_cost, inactiveCostThreshold: args.p_inactive_cost_threshold };
      return { error: null };
    },
    from: name => {
      assert.equal(name, 'configuracoes_auditoria');
      return { insert: rows => ({ select: async () => {
        if (options.auditFailure) return { data: null, error: { code: 'unavailable' } };
        state.auditRows.push(...rows);
        return { data: rows.map((_, i) => ({ id: String(i) })), error: null };
      } }) };
    },
  };
  const route = load('src/app/api/configuracoes/comercial/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => { state.clientCalls++; return client; } },
    '@/lib/auth/admin': { requireAdminUser: async () => options.denied
      ? { ok: false, response: new Response(null, { status: 403 }) }
      : { ok: true, user: { id: 'admin-test' }, nome: 'Administrador de teste' } },
    '@/lib/configuracoes/contracts': contracts, '@/services/pricing-policy': policy,
    '@/services/configuration-audit': audit,
    '@/services/commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => {
      state.reads++;
      if (options.loadFailure || options.readAfterWriteFailure && state.writes.length) throw new Error('Leitura indisponível');
      return { mlFeeFallbackRate: state.values.mlFeeFallbackPercent / 100,
        unspecifiedShippingCost: state.values.unspecifiedShippingCost, inactiveCostThreshold: state.values.inactiveCostThreshold };
    } },
    '@/services/pricing-tax-context': { loadPricingTaxContext: async () => ({ ...tax }) },
  });
  return { route, state };
}

test('GET devolve os três parâmetros, política canônica e fiscal, sem escrita e sem cache', async () => {
  const { route, state } = adminRoute();
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ...parameters, finalPricePolicy: policy.FINAL_PRICE_POLICY, pricingTaxContext: tax });
  assert.equal(state.writes.length, 0); assert.equal(state.auditRows.length, 0);
});

test('GET e PUT negam não administrador antes de abrir cliente privilegiado', async () => {
  const { route, state } = adminRoute({ denied: true });
  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.PUT(request(parameters))).status, 403);
  assert.equal(state.clientCalls, 0);
});

test('PUT valida limites, campos ausentes e regras legadas antes da persistência', async () => {
  const { route, state } = adminRoute();
  for (const input of [null, {}, { ...parameters, mlFeeFallbackPercent: 100 }, { ...parameters, mlFeeFallbackPercent: -1 },
    { ...parameters, unspecifiedShippingCost: null }, { ...parameters, unspecifiedShippingCost: 10000001 },
    { ...parameters, inactiveCostThreshold: 0 }, { ...parameters, inactiveCostThreshold: 10000001 },
    ...['costTiers', 'quantityPricingTiers', 'minProfit', 'margin', 'finalPricePolicy'].map(key => ({ ...parameters, [key]: [] }))]) {
    assert.equal((await route.PUT(request(input))).status, 422, JSON.stringify(input));
  }
  assert.equal(state.clientCalls, 0); assert.equal(state.writes.length, 0);
});

test('PUT grava somente parâmetros e audita somente mudanças reais; GET relê o estado salvo', async () => {
  const { route, state } = adminRoute();
  const input = { ...parameters, mlFeeFallbackPercent: 0, unspecifiedShippingCost: 0 };
  assert.equal((await route.PUT(request(input))).status, 200);
  assert.deepEqual(state.writes, [{ p_ml_fee_fallback_rate: 0, p_unspecified_shipping_cost: 0, p_inactive_cost_threshold: 2000 }]);
  assert.equal(state.auditRows.length, 2);
  assert.deepEqual(state.auditRows.map(r => r.chave), ['configuracoes.pricing_ml_fee_fallback_rate', 'configuracoes.pricing_unspecified_shipping_cost']);
  assert.deepEqual(state.auditRows[0].valor_anterior, { value: 15 });
  assert.deepEqual(state.auditRows[0].valor_novo, { value: 0 });
  assert.equal(state.auditRows[0].autor_id, 'admin-test');
  assert.equal((await (await route.GET()).json()).unspecifiedShippingCost, 0);
  assert.equal((await route.PUT(request(input))).status, 200);
  assert.equal(state.auditRows.length, 2, 'não cria histórico fictício em repetição sem alteração');
});

test('falha de leitura/RPC não informa persistência e não escreve auditoria', async () => {
  for (const options of [{ loadFailure: true }, { rpcFailure: true }]) {
    const { route, state } = adminRoute(options);
    const response = await route.PUT(request(parameters));
    assert.equal(response.status, 500); assert.equal((await response.json()).persisted, undefined);
    assert.equal(state.writes.length, 0); assert.equal(state.auditRows.length, 0);
  }
});

test('falha de auditoria após gravar é explícita e não repete o RPC', async () => {
  const { route, state } = adminRoute({ auditFailure: true });
  const response = await route.PUT(request({ ...parameters, unspecifiedShippingCost: 40 }));
  assert.equal(response.status, 500);
  const data = await response.json();
  assert.equal(data.persisted, true); assert.match(data.erro, /histórico/);
  assert.equal(state.writes.length, 1); assert.equal(state.values.unspecifiedShippingCost, 40);
});

test('falha de releitura após o RPC também informa persistência, sem repetir gravação', async () => {
  const { route, state } = adminRoute({ readAfterWriteFailure: true });
  const response = await route.PUT(request({ ...parameters, unspecifiedShippingCost: 40 }));
  assert.equal(response.status, 500); assert.equal((await response.json()).persisted, true);
  assert.equal(state.writes.length, 1); assert.equal(state.auditRows.length, 0);
});

function simulationRoute(taxContext = tax, fails = false) {
  return load('src/app/api/configuracoes/comercial/simular/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/configuracoes/contracts': contracts,
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => ({}) },
    '@/lib/auth/admin': { requireAdminUser: async () => ({ ok: true }) },
    '@/services/pricing-tax-context': { loadPricingTaxContext: async () => { if (fails) throw Error('unavailable'); return taxContext; } },
    '@/services/pricing-context': context,
  });
}
const scenario = { costCents: 3000, shippingCents: 1000, feeRate: .15, priceCents: null };

test('simulação aceita zero explícito, mas não converte ausência em zero nem aceita legado/threshold', async () => {
  const route = simulationRoute();
  for (const input of [{ ...scenario, costCents: null }, { ...scenario, costCents: undefined },
    { ...scenario, priceCents: 0 }, { ...scenario, priceCents: undefined }, { ...scenario, shippingCents: null },
    { ...scenario, feeRate: 1 }, { ...scenario, inactiveCostThreshold: 2000 }, { ...scenario, minProfit: 20 }]) {
    assert.equal((await route.POST(request(input, 'POST'))).status, 422);
  }
  const response = await route.POST(request({ ...scenario, costCents: 0, shippingCents: 0, feeRate: 0 }, 'POST'));
  assert.equal(response.status, 200); assert.equal((await response.json()).pricing.costCents, 0);
});

for (const [priceCents, bandId] of [[20000, 'UP_TO_200'], [20001, 'FROM_200_TO_1000'], [100000, 'FROM_200_TO_1000'], [100001, 'ABOVE_1000']]) {
  test(`simulador preserva memória canônica e faixa em ${priceCents} centavos`, async () => {
    const response = await simulationRoute().POST(request({ ...scenario, priceCents }, 'POST'));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    const direct = context.simulateProductPricing({ ...scenario, priceCents, taxContext: tax, evaluatedAt: payload.pricing.current.memory.evaluatedAt });
    assert.deepEqual(payload.pricing, direct);
    assert.equal(payload.pricing.current.memory.band.id, bandId);
    assert.equal(payload.pricing.current.memory.scenario, 'simulation');
  });
}

test('falha fiscal é 503; fiscal sem evidência permanece inconclusivo, nunca imposto zero', async () => {
  assert.equal((await simulationRoute(tax, true).POST(request(scenario, 'POST'))).status, 503);
  const unavailable = { ...tax, appliedRate: null, source: 'unavailable', warning: 'Fiscal indisponível' };
  const data = await (await simulationRoute(unavailable).POST(request({ ...scenario, priceCents: 10000 }, 'POST'))).json();
  assert.equal(data.pricing.current.status, 'inconclusive');
  assert.equal(data.pricing.current.memory, null); assert.equal(data.pricing.target.ok, false);
  assert.deepEqual(data.pricingTaxContext, unavailable);
});

test('contexto fiscal é retornado intacto em cada classificação e aplicado pelo motor', async () => {
  for (const source of ['estimated', 'confirmed', 'protected']) {
    const fiscal = { ...tax, source, appliedRate: .06, estimatedRate: .06, confirmedRate: source === 'confirmed' ? .06 : null };
    const data = await (await simulationRoute(fiscal).POST(request({ ...scenario, priceCents: 10000 }, 'POST'))).json();
    assert.deepEqual(data.pricingTaxContext, fiscal);
    assert.deepEqual(data.pricing, context.simulateProductPricing({ ...scenario, priceCents: 10000, taxContext: fiscal, evaluatedAt: data.pricing.current.memory?.evaluatedAt || evaluatedAt }));
    assert.equal(data.pricing.current.memory.tax.status, 'estimated', 'não inventa montante realizado confirmado');
  }
});

test('apresentação da simulação não se passa por ML vivo e preserva apresentador dos outros consumidores', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const ui = load('src/components/products/LivePricingQuote.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'),
    '@/lib/format': { formatCurrency: value => value == null ? '—' : `R$ ${value.toFixed(2)}` },
  });
  const pricing = context.simulateProductPricing({ ...scenario, priceCents: 10000, evaluatedAt, taxContext: tax });
  const html = renderToStaticMarkup(React.createElement(ui.PricingQuoteSummary, { pricing, presentation: 'simulation', currentLabel: 'Preço avaliado' }));
  for (const text of ['Preço avaliado', 'Alvo', 'Piso', 'Equilíbrio', 'Tributo', 'Resultado / margem', 'Taxa do cenário', 'Frete do cenário', '4,00%', 'sem consulta ao Mercado Livre']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Consulta econômica inconclusiva|Fontes consultadas no Mercado Livre|Configuração not_specified/);
  const live = renderToStaticMarkup(React.createElement(ui.PricingQuoteSummary, { pricing: { ...pricing, revalidation: { status: 'queried', evaluatedAt } } }));
  assert.match(live, /Fontes consultadas no Mercado Livre/); assert.match(live, /Tarifa ML total/);
  assert.doesNotMatch(live, /Taxa do cenário|Frete do cenário/);
});
