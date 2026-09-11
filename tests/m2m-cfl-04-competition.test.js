const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const domain = load('src/services/pricing-competition.ts');
const conflicts = load('src/services/commercial-conflicts.ts');
const normalize = require('../src/lib/catalogo/no-catalogo.ts');
const economy = load('src/services/pricing-economy.ts', {
  './pricing-policy': require('../src/services/pricing-policy.ts'), './pricing': require('../src/services/pricing.ts'),
  './pricing-core.js': require('../src/services/pricing-core.js'),
});
const now = '2026-09-08T03:00:00.000Z';
function fixture(price = 10000, profit = 730) {
  const context = { productId: 'P1', offerId: 'O1', supplierId: 'S1', mlItemId: 'MLB1', pricingGroupId: 'G1',
    currency: 'BRL', unit: 'sale_unit', quantity: 1, referenceMonth: '2026-09', marketContextKey: 'market:test' };
  const component = (amountCents, source, sourceId) => ({ amountCents, source, sourceId, condition: 'known',
    observedAt: now, expiresAt: null, basis: 'unit', quantity: 1, marketContextKey: context.marketContextKey,
    quotedPriceCents: source === 'ml_live' ? price : null });
  const input = { scenario: 'projected', priceCents: price, evaluatedAt: now, offerEligible: true, context,
    cost: component(price - Math.round(price * .14) - 1000 - Math.ceil(price * .04) - profit, 'offer', 'O1'),
    fee: component(Math.round(price * .14), 'ml_live', 'quote:fee'), shipping: component(1000, 'ml_live', 'quote:shipping'),
    tax: { context: { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000, bracket: 1,
      source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null }, observedAt: now,
      sourceId: 'tax', coverage: 'unknown', confirmation: null, realizedAmountCents: null } };
  const current = economy.evaluateEconomicMemory(input);
  assert.ok(current.memory, JSON.stringify(current));
  const { priceCents, fee, scenario, ...base } = input;
  const projected = objective => economy.projectEconomicPrice({ objective,
    base: { ...base, shipping: { ...input.shipping, source: 'fallback', condition: 'estimated', quotedPriceCents: null } },
    feeModel: { source: 'fallback', sourceId: 'config:fee', observedAt: now, expiresAt: null, rate: .14, fixedFeeCents: 0 } });
  return { pricing: { current, currentPriceCents: price, costCents: input.cost.amountCents,
    floor: projected('floor'), target: projected('target'), breakEven: projected('break_even'),
    revalidation: { status: 'queried', evaluatedAt: now, contextKey: context.marketContextKey } },
    competitive: current, evidence: { itemId: 'MLB1', catalogProductId: 'MLB10', observedAt: now,
      condition: 'valid', priceCents: price, currentPriceCents: price, status: 'competing' },
    group: { id: 'G1', version: 1, state: 'verified', members: [{ itemId: 'MLB1', variationId: '', catalog: true }], protection: null, inFlight: false },
    evaluatedAt: now };
}
for (const [price, profit, classification] of [
  [10000, 730, 'VIAVEL_NO_ALVO'], [10000, 700, 'VIAVEL_NO_ALVO'], [10000, 500, 'VIAVEL_ACIMA_DO_PISO'],
  [10000, 499, 'ABAIXO_DO_PISO_MAS_POSITIVO'], [10000, 0, 'EQUILIBRIO_SEM_MARGEM'],
  [10000, -1, 'PREJUIZO_NO_PRECO_COMPETITIVO'], [20000, 1400, 'VIAVEL_NO_ALVO'],
  [20001, 1460, 'VIAVEL_ACIMA_DO_PISO'], [100000, 10000, 'VIAVEL_NO_ALVO'],
  [100001, 10000, 'ABAIXO_DO_PISO_MAS_POSITIVO'], [100001, 15001, 'VIAVEL_NO_ALVO'],
]) test(`política canônica: preço ${price}, resultado ${profit}`, () => {
  const f = fixture(price, profit); const result = domain.assessCompetitivePricing(f);
  assert.equal(result.classification, classification, JSON.stringify(result.reasons));
  assert.deepEqual(result.competitive, f.competitive);
  assert.equal(result.executionBlocked, true); assert.equal(result.autonomy, 'AUTO_OBSERVE');
  assert.notEqual(conflicts.classifyCommercialConflicts({ economy: result.assessment }).status, 'SEM_CONFLITO');
});
for (const value of [null, undefined, 0, -1, '100', NaN, Infinity, { amount: 100 }]) test(`não inventa referência: ${value}`, () => {
  const payload = { price_to_win: value, price: 100, winning_price: 90, suggested_price: 95 };
  assert.equal(normalize.normalizePriceToWin(payload), null);
});
test('valida item, moeda, catálogo, preço atual, consistência e data', () => {
  const payload = { item_id: 'MLB1', catalog_product_id: 'MLB10', currency_id: 'BRL', consistent: true,
    current_price: 100, price_to_win: 90, status: 'competing' };
  const expected = { itemId: 'MLB1', catalogProductId: 'MLB10', currentPriceCents: 10000 };
  assert.equal(domain.competitionEvidence(payload, expected, now).priceCents, 9000);
  for (const change of [{ item_id: 'MLB2' }, { currency_id: 'ARS' }, { consistent: false }, { consistent: null },
    { current_price: 101 }, { catalog_product_id: 'MLB11' }, { status: 'unknown' }]) {
    const evidence = domain.competitionEvidence({ ...payload, ...change }, expected, now);
    assert.equal(evidence.condition, 'inconsistent'); assert.equal(evidence.priceCents, null);
  }
  const missing = domain.competitionEvidence({ ...payload, price_to_win: null, status: 'listed' }, expected, now);
  assert.equal(missing.condition, 'valid'); assert.equal(missing.priceCents, null);
});
test('stale, fonte ausente, memória de outro preço ou contexto não confirmam prejuízo', () => {
  for (const change of [f => { f.evidence.condition = 'stale'; }, f => { f.evidence.priceCents = null; },
    f => { f.evidence.observedAt = '2099-01-01T00:00:00Z'; }, f => { f.pricing.revalidation.status = 'inconclusive'; },
    f => { f.competitive = structuredClone(f.competitive); f.competitive.memory.revenueCents++; },
    f => { f.competitive = structuredClone(f.competitive); f.competitive.memory.context.offerId = 'other'; }]) {
    const f = fixture(10000, -100); change(f);
    const result = domain.assessCompetitivePricing(f);
    assert.equal(result.classification, 'INCONCLUSIVO'); assert.equal(result.buyBoxConflict, null);
  }
});
test('positivo abaixo do piso vai à revisão; prejuízo tem conflito; premium não ordena desconto', () => {
  assert.equal(domain.assessCompetitivePricing(fixture(10000, 499)).assessment.status, 'PENDENCIA_VALIDACAO');
  assert.equal(domain.assessCompetitivePricing(fixture(10000, -1)).assessment.status, 'CONFLITO_CONFIRMADO');
  const f = fixture(10000, 3000); f.evidence.status = 'winning'; f.group.protection = { id: 'override' };
  const result = domain.assessCompetitivePricing(f);
  assert.equal(result.overrideActive, true); assert.equal(result.competitive.memory.resultCents, 3000);
  assert.ok(result.reasons.includes('NAO_REDUZIR_POR_POSICAO_COMPETITIVA'));
});
test('referência de catálogo pode avaliar o anúncio de origem somente dentro do mesmo grupo verificado', () => {
  const linked = fixture(10000, -100);
  linked.evidence.itemId = 'MLB2';
  linked.group.members = [
    { itemId: 'MLB1', variationId: '', catalog: false },
    { itemId: 'MLB2', variationId: '', catalog: true },
  ];
  assert.equal(domain.assessCompetitivePricing(linked).classification, 'PREJUIZO_NO_PRECO_COMPETITIVO');
  linked.group.state = 'unverified';
  assert.equal(domain.assessCompetitivePricing(linked).classification, 'INCONCLUSIVO');
});
test('liquidação exige cenário interno explícito, grupo atual e limite; diagnóstico não apaga prejuízo', () => {
  const f = fixture(10000, -100);
  f.clearance = { id: 'C1', groupId: 'G1', groupVersion: 1, state: 'active', endsAt: null,
    available: 2, quantity: 1, maxLossCents: 100, fulfillmentSource: 'internal', stockVerified: true, conflict: false };
  const result = domain.assessCompetitivePricing(f);
  assert.equal(result.clearanceApplied, 'C1'); assert.equal(result.buyBoxConflict, false);
  assert.equal(result.classification, 'PREJUIZO_NO_PRECO_COMPETITIVO'); assert.equal(result.executionBlocked, true);
  for (const change of [{ fulfillmentSource: 'supplier' }, { state: 'expired' }, { available: 0 }, { maxLossCents: 99 },
    { groupVersion: 2 }, { groupId: 'G2' }, { quantity: 0 }, { endsAt: now }, { stockVerified: false }, { conflict: true }]) {
    const denied = domain.assessCompetitivePricing({ ...f, clearance: { ...f.clearance, ...change } });
    assert.equal(denied.clearanceApplied, null); assert.equal(denied.buyBoxConflict, true);
  }
});
test('snapshots não recomendam preços e a interface não pré-seleciona a Buy Box', () => {
  const route = fs.readFileSync('src/app/api/catalogo/no-catalogo/analise-preco/route.ts', 'utf8');
  assert.match(route, /assessCompetitivePricing/); assert.match(route, /preliminary: true/);
  assert.match(route, /preco_recomendado: null/);
  for (const path of ['src/components/catalogo/CatalogoView.tsx', 'src/app/(app)/anuncios/page.tsx']) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /CompetitivePricingSummary/); assert.match(source, /Simular referência competitiva/);
    assert.doesNotMatch(source, /Usar preço para ganhar|priceToWin \|\| activeCatalog.price_to_win|setNewPrice\(row.price_to_win/);
    assert.match(source, /PricingProposalButton/);
  }
  assert.match(fs.readFileSync('src/components/products/PricingDecisionCenter.tsx','utf8'), /esta operação não está liberada no ambiente/);
});
test('interface renderiza memórias, resultado, grupo e aviso sem inventar referências', () => {
  const ui = load('src/components/products/LivePricingQuote.tsx', {
    react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'),
    '@/lib/user-feedback': require('../src/lib/user-feedback.ts'),
    '@/lib/format': { formatCurrency: value => value == null ? '—' : `R$ ${Number(value).toFixed(2)}` },
  });
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  for (const [profit, label] of [[730, 'atende ao alvo'], [499, 'abaixo do piso'], [-100, 'Prejuízo projetado']]) {
    const html = renderToStaticMarkup(React.createElement(ui.CompetitivePricingSummary, { assessment: domain.assessCompetitivePricing(fixture(10000, profit)) }));
    assert.ok(html.includes(label)); assert.ok(html.includes('Referência competitiva')); assert.ok(html.includes('Vínculo dos anúncios'));
    for (const heading of ['Tarifa ML total', 'Frete estimado', 'Tributo', 'Equilíbrio', 'Alvo', 'Piso']) assert.ok(html.includes(heading), heading);
    assert.ok(html.includes('Nenhum preço será aplicado'));
  }
  const f = fixture(); f.evidence.priceCents = null; f.competitive = null;
  const html = renderToStaticMarkup(React.createElement(ui.CompetitivePricingSummary, { assessment: domain.assessCompetitivePricing(f) }));
  assert.ok(html.includes('Não informada')); assert.ok(html.includes('inconclusiva'));
});
