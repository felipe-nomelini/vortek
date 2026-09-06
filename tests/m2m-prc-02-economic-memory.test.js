const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const policy = require('../src/services/pricing-policy.ts');
const pricing = require('../src/services/pricing.ts');
// Injeta módulos reais, não stubs econômicos; o loader existente resolve imports TS no Node.
const { evaluateEconomicMemory: evaluate, projectEconomicPrice: project, ECONOMIC_MAX_REFINEMENTS } = load(
  'src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': pricing, './pricing-core.js': require('../src/services/pricing-core.js') },
);
const observedAt = '2026-09-05T01:00:00.000Z';
const evaluatedAt = '2026-09-05T02:00:00.000Z';
const context = {
  productId: 'P1', offerId: 'O1', supplierId: 'S1', mlItemId: 'MLB1', pricingGroupId: null,
  currency: 'BRL', unit: 'sale_unit', quantity: 1, referenceMonth: '2026-09',
  marketContextKey: 'seller-test/category-test/gold_special/me2/drop_off',
};
const component = (amountCents, source, sourceId) => ({
  amountCents, source, sourceId, condition: 'known', observedAt, expiresAt: null,
  basis: 'unit', quantity: 1, marketContextKey: context.marketContextKey,
  quotedPriceCents: source.startsWith('ml_') ? 10000 : null,
});
function fixture() {
  return {
    priceCents: 10000, scenario: 'projected', evaluatedAt, context: { ...context }, offerEligible: true,
    cost: component(5000, 'offer', 'O1'), fee: component(1400, 'ml_live', 'fee-quote-1'),
    shipping: component(1000, 'ml_live', 'shipping-quote-1'),
    tax: {
      context: { appliedRate: 0.04, estimatedRate: 0.04, confirmedRate: 0.04, rbt12: 120000,
        bracket: 1, source: 'confirmed', referenceMonth: '2026-09', manualRequired: false, warning: null },
      observedAt, sourceId: 'tax-context-1', coverage: 'complete',
      confirmation: { referenceMonth: '2026-09', evidenceId: 'pgdas-test-1', confirmedAt: observedAt },
      realizedAmountCents: null,
    },
  };
}
function projection() {
  const { priceCents, scenario, fee, ...base } = fixture();
  base.shipping = { ...base.shipping, source: 'fallback', condition: 'estimated', quotedPriceCents: null };
  return { base, objective: 'target', feeModel: {
    source: 'fallback', sourceId: 'config-fee-1', observedAt, expiresAt: null, rate: 0.14, fixedFeeCents: 600,
  } };
}
const hasReason = (result, code, field) => {
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.memory, null);
  assert.ok(result.reasons.some(r => r.code === code && (!field || r.field === field)), JSON.stringify(result));
};

test('uma memória soma tarifa total exatamente uma vez e margem é sobre receita', () => {
  const result = evaluate(fixture());
  assert.equal(result.status, 'available');
  assert.equal(result.memory.tax.amountCents, 400);
  assert.equal(result.memory.resultCents, 2200);
  assert.equal(result.memory.margin, 0.22);
  assert.equal(result.memory.band.id, 'UP_TO_200');
  assert.equal(result.memory.band.floor, 0.05);
  assert.equal(result.memory.policyVersion, policy.FINAL_PRICE_POLICY.version);
  assert.equal(result.memory.version, 'VORTEK-CANON-1.0-ECON-2');
  assert.equal('additionalVariableCosts' in result.memory, false);
  assert.equal('additionalVariableCosts' in JSON.parse(result.memory.fingerprint), false);
  const withBreakdown = fixture();
  withBreakdown.fee.fixedFeeCents = 600; // Extra da API não é um segundo débito.
  assert.deepEqual(evaluate(withBreakdown), result);
});

for (const [cost, profit] of [[7200, 0], [8200, -1000], [5000, 2200]]) {
  test(`resultado ${profit} não publica, pausa nem altera dados`, () => {
    const input = fixture(); input.cost.amountCents = cost;
    assert.equal(evaluate(input).memory.resultCents, profit);
    assert.equal('action' in evaluate(input), false);
  });
}

test('zero de frete é válido; frete ausente não vira zero', () => {
  const input = fixture(); input.shipping.amountCents = 0;
  assert.equal(evaluate(input).memory.resultCents, 3200);
  input.shipping.amountCents = null;
  hasReason(evaluate(input), 'DADO_AUSENTE', 'shipping');
});

test('exemplo M2M de margem 7,3% abaixo de R$200 não é rejeitado por piso universal 10%', () => {
  const input = fixture(); input.cost.amountCents = 6470;
  const result = evaluate(input);
  assert.equal(result.status, 'available');
  assert.equal(result.memory.resultCents, 730);
  assert.equal(result.memory.margin, 0.073);
  assert.ok(result.memory.margin > result.memory.band.target);
  assert.equal('action' in result, false);
});

for (const field of ['cost', 'fee', 'shipping']) {
  test(`${field}: ausente, inválido, stale, vencido e origem inválida`, () => {
    for (const [patch, code] of [
      [{ amountCents: null }, 'DADO_AUSENTE'], [{ condition: 'missing' }, 'DADO_AUSENTE'],
      [{ amountCents: -1 }, 'DADO_INVALIDO'], [{ amountCents: '10' }, 'DADO_INVALIDO'],
      [{ amountCents: 10.1 }, 'DADO_INVALIDO'], [{ amountCents: NaN }, 'DADO_INVALIDO'],
      [{ amountCents: Infinity }, 'DADO_INVALIDO'], [{ amountCents: Number.MAX_SAFE_INTEGER + 1 }, 'DADO_INVALIDO'],
      [{ condition: 'invalid' }, 'DADO_INVALIDO'], [{ condition: 'stale' }, 'DADO_VENCIDO'],
      [{ expiresAt: evaluatedAt }, 'DADO_VENCIDO'], [{ source: 'invented' }, 'DADO_INVALIDO'],
      [{ observedAt: '2026-02-30T00:00:00Z' }, 'DADO_INVALIDO'],
      [{ observedAt: '2026-10-01T00:00:00Z' }, 'DADO_INVALIDO'],
      [{ expiresAt: '2026-01-01T00:00:00Z' }, 'DADO_INVALIDO'],
    ]) {
      const input = fixture(); Object.assign(input[field], patch);
      hasReason(evaluate(input), code, field);
    }
  });
}

test('preço, moeda, quantidade e base inválidos não geram memória', () => {
  for (const priceCents of [0, -1, 0.1, null, undefined, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    hasReason(evaluate({ ...fixture(), priceCents }), 'DADO_INVALIDO');
  }
  for (const patch of [{ currency: 'USD' }, { quantity: 0 }, { quantity: 1.2 }, { unit: 'order_total' }]) {
    const input = fixture(); Object.assign(input.context, patch);
    hasReason(evaluate(input), 'BASE_INCOMPATIVEL');
  }
  const input = fixture(); input.shipping.basis = 'total';
  hasReason(evaluate(input), 'BASE_INCOMPATIVEL', 'shipping');
  hasReason(evaluate(null), 'DADO_INVALIDO');
});

test('quantidade da cotação é explícita e não multiplica valores unitários novamente', () => {
  const input = fixture(); input.context.quantity = 3;
  for (const field of ['cost', 'fee', 'shipping']) input[field].quantity = 3;
  assert.equal(evaluate(input).memory.resultCents, 2200);
  input.fee.quantity = 1;
  hasReason(evaluate(input), 'BASE_INCOMPATIVEL', 'fee');
});

test('preço ou contexto diferente invalida cotação; sem preço cotado não presume compatibilidade', () => {
  for (const field of ['fee', 'shipping']) {
    for (const patch of [{ quotedPriceCents: 9999 }, { quotedPriceCents: null }, { marketContextKey: 'other-logistics' }]) {
      const input = fixture(); Object.assign(input[field], patch);
      hasReason(evaluate(input), 'COTACAO_INCOMPATIVEL', field);
    }
  }
});

test('oferta projetada precisa ser elegível, identificada e corresponder à origem do custo', () => {
  for (const mutate of [i => { i.offerEligible = false; }, i => { i.context.offerId = null; },
    i => { i.cost.sourceId = 'other-offer'; }, i => { i.cost.source = 'historical'; }]) {
    const input = fixture(); mutate(input); hasReason(evaluate(input), 'OFERTA_INELEGIVEL', 'cost');
  }
});

test('fallback explícito é estimativa mesmo se chamador rotular known', () => {
  const input = fixture(); input.fee.source = 'fallback';
  assert.equal(evaluate(input).status, 'estimated');
  assert.ok(evaluate(input).reasons.includes('fee:estimated'));
});

test('reutiliza contexto real RBT12/Simples e mantém proteção como estimativa', () => {
  const input = fixture(); input.tax.confirmation = null;
  input.tax.context = pricing.buildPricingTaxContext({ activityStartDate: '2026-07-01',
    referenceDate: '2026-09-05', monthlyRevenue: [{ month: '2026-07', revenue: 20000 },
      { month: '2026-08', revenue: 20000 }], confirmedRate: 0.055 });
  const result = evaluate(input);
  assert.equal(result.memory.tax.context.rbt12, 240000);
  assert.equal(result.memory.tax.context.source, 'protected');
  assert.equal(result.memory.tax.amountCents, 550);
  assert.equal(result.memory.tax.status, 'estimated');
});

test('alíquota preenchida e cobertura desconhecida não comprovam confirmação fiscal', () => {
  const input = fixture(); input.tax.confirmation = null;
  assert.equal(evaluate(input).memory.tax.status, 'estimated');
  for (const coverage of ['unknown', 'incomplete']) {
    const uncovered = fixture(); uncovered.tax.coverage = coverage;
    assert.equal(evaluate(uncovered).memory.tax.status, 'estimated');
    assert.ok(evaluate(uncovered).reasons.includes('tax:coverage_unconfirmed'));
  }
});

test('mínimo 4%, competência, PGDAS e prova são verificados sem inferir dados fiscais', () => {
  for (const appliedRate of [null, 0, 0.039, -1, 1, NaN]) {
    const input = fixture(); input.tax.context.appliedRate = appliedRate;
    hasReason(evaluate(input), appliedRate === null ? 'DADO_AUSENTE' : 'DADO_INVALIDO', 'tax');
  }
  const old = fixture(); old.tax.context.referenceMonth = '2026-08';
  hasReason(evaluate(old), 'COMPETENCIA_INCOMPATIVEL');
  const oldProof = fixture(); oldProof.tax.confirmation.referenceMonth = '2026-08';
  hasReason(evaluate(oldProof), 'COMPETENCIA_INCOMPATIVEL');
  for (const mutate of [i => { i.tax.confirmation = null; }, i => { i.tax.coverage = 'unknown'; },
    i => { i.tax.context.source = 'estimated'; }]) {
    const input = fixture(); input.tax.context.manualRequired = true; mutate(input);
    hasReason(evaluate(input), 'PGDAS_NAO_COMPROVADO');
  }
  const proven = fixture(); proven.tax.context.manualRequired = true;
  assert.equal(evaluate(proven).status, 'available');
});

test('realizado preserva custo histórico e montante tributário, sem atualizar pela oferta atual', () => {
  const input = fixture(); input.scenario = 'realized'; input.offerEligible = false;
  input.cost.source = 'historical'; input.tax.realizedAmountCents = 401;
  assert.equal(evaluate(input).memory.tax.amountCents, 401);
  assert.equal(evaluate(input).memory.resultCents, 2199);
  input.tax.realizedAmountCents = null;
  assert.equal(evaluate(input).memory.tax.status, 'estimated');
  assert.equal(evaluate(input).status, 'estimated');
  input.tax.realizedAmountCents = 401;
  input.cost.source = 'offer';
  hasReason(evaluate(input), 'BASE_INCOMPATIVEL', 'cost');
  input.scenario = 'projected'; input.offerEligible = true;
  hasReason(evaluate(input), 'DADO_INVALIDO', 'tax');
});

test('meio centavo tributário arredonda uma vez para cima, sem erro binário', () => {
  const input = fixture(); input.priceCents = 101;
  input.tax.context.appliedRate = 0.045; input.tax.context.confirmedRate = 0.045;
  input.fee.quotedPriceCents = 101; input.shipping.quotedPriceCents = 101;
  assert.equal(evaluate(input).memory.tax.amountCents, 5);
  input.priceCents = 100; input.fee.quotedPriceCents = 100; input.shipping.quotedPriceCents = 100;
  assert.equal(evaluate(input).memory.tax.amountCents, 5);
});

for (const [priceCents, taxRate, expected] of [
  [100, 0.04, 4], [100, 0.041, 5], [100, 0.045, 5], [100, 0.049, 5],
  [1, 0.04, 1], [2500, 0.07, 175], [101, 0.040000000000001, 5],
  [20000, 0.04, 800], [20001, 0.04, 801],
  [100000, 0.04, 4000], [100001, 0.04, 4001],
  [Number.MAX_SAFE_INTEGER, 0.04, 360287970189640],
]) {
  test(`tributo calculado usa teto exato: ${priceCents} centavos x ${taxRate}`, () => {
    const input = fixture(); input.priceCents = priceCents;
    input.tax.context.appliedRate = taxRate; input.tax.context.confirmedRate = taxRate;
    for (const field of ['cost', 'fee', 'shipping']) {
      input[field].amountCents = 0;
      if (field !== 'cost') input[field].quotedPriceCents = priceCents;
    }
    const result = evaluate(input);
    assert.equal(result.status, 'available');
    assert.equal(result.memory.tax.amountCents, expected);
    assert.equal(result.memory.resultCents, priceCents - expected);
    assert.equal(result.memory.version, 'VORTEK-CANON-1.0-ECON-2');
    input.scenario = 'realized'; input.cost.source = 'historical';
    const estimated = evaluate(input);
    assert.equal(estimated.status, 'estimated');
    assert.equal(estimated.memory.tax.status, 'estimated');
    assert.equal(estimated.memory.tax.amountCents, expected);
  });
}

test('montante fiscal realizado, inclusive zero, prevalece sobre o teto calculado', () => {
  const input = fixture(); input.scenario = 'realized'; input.cost.source = 'historical';
  input.tax.context.appliedRate = 0.04001; input.tax.context.confirmedRate = 0.04001;
  for (const amount of [0, 399, 400, 402]) {
    input.tax.realizedAmountCents = amount;
    const before = structuredClone(input);
    const result = evaluate(input);
    assert.equal(result.memory.tax.amountCents, amount);
    assert.equal(result.memory.tax.status, 'confirmed');
    assert.equal(result.memory.resultCents, 2600 - amount);
    assert.deepEqual(input, before);
  }
});

test('contrato ECON-2 remove extras sem alterar versão da política nem ecoar campos desconhecidos', () => {
  const input = fixture();
  const baseline = evaluate(input);
  input.additionalVariableCosts = { amountCents: 999, status: 'not_applicable' };
  assert.deepEqual(evaluate(input), baseline);
  assert.equal(baseline.memory.policyVersion, policy.FINAL_PRICE_POLICY.version);
  const types = fs.readFileSync('src/types/pricing.ts', 'utf8');
  const source = fs.readFileSync('src/services/pricing-economy.ts', 'utf8');
  assert.doesNotMatch(types, /additionalVariableCosts|M2M-PRC-02-v1/);
  assert.doesNotMatch(source, /additionalVariableCosts|M2M-PRC-02-v1/);
});

test('projeção mantém half-up da tarifa ML e usa teto somente para tributo', () => {
  for (const [feeRate, expectedFee, fixedFee, taxRate] of [[0.04, 0, 0, 0.04], [0.05, 1, 0, 0.1], [0.04, 2, 2, 0.04]]) {
    const input = projection(); input.objective = 'break_even';
    input.base.cost.amountCents = 9 - expectedFee;
    input.base.shipping.amountCents = 0;
    input.base.tax.context.appliedRate = taxRate; input.base.tax.context.confirmedRate = taxRate;
    input.feeModel.rate = feeRate; input.feeModel.fixedFeeCents = fixedFee;
    const result = project(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.priceCents, 10);
    assert.equal(result.evaluation.memory.fee.amountCents, expectedFee);
    assert.equal(result.evaluation.memory.tax.amountCents, 1);
    assert.equal(result.evaluation.memory.resultCents, 0);
    assert.equal(result.evaluation.memory.version, 'VORTEK-CANON-1.0-ECON-2');
    assert.equal('additionalVariableCosts' in result.evaluation.memory, false);
  }
});

test('soma insegura de componentes não gera lucro aparentemente válido', () => {
  const input = fixture(); input.cost.amountCents = Number.MAX_SAFE_INTEGER;
  hasReason(evaluate(input), 'PRECISAO_INSEGURA');
});

test('memória é determinística, independente da ordem das chaves e sem mutação/referências externas', () => {
  const input = fixture(); const before = structuredClone(input);
  const result = evaluate(input);
  assert.deepEqual(evaluate(input), result); assert.deepEqual(input, before);
  assert.deepEqual(evaluate(Object.fromEntries(Object.entries(input).reverse())), result);
  assert.deepEqual(JSON.parse(result.memory.fingerprint), JSON.parse(JSON.stringify({ ...result.memory, fingerprint: undefined })));
  input.cost.amountCents = 1; input.tax.context.appliedRate = 0.09; input.context.productId = 'other';
  assert.equal(result.memory.cost.amountCents, 5000);
  assert.equal(result.memory.tax.context.appliedRate, 0.04);
  assert.equal(result.memory.context.productId, 'P1');
  const materialChange = fixture(); materialChange.shipping.amountCents++;
  assert.notEqual(evaluate(materialChange).memory.fingerprint, result.memory.fingerprint);
});

for (const [price, band] of [[20000, 'UP_TO_200'], [20001, 'FROM_200_TO_1000'],
  [100000, 'FROM_200_TO_1000'], [100001, 'ABOVE_1000']]) {
  test(`memória aplica faixa ao preço final ${price}`, () => {
    const input = fixture(); input.priceCents = price;
    input.fee.quotedPriceCents = price; input.shipping.quotedPriceCents = price;
    assert.equal(evaluate(input).memory.band.id, band);
  });
}

for (const objective of ['floor', 'target', 'limit', 'break_even']) {
  test(`projeção ${objective} satisfaz economia e solver, sem autorização de escrita`, () => {
    const input = projection(); input.objective = objective;
    const result = project(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.evaluation.status, 'estimated');
    const m = result.evaluation.memory;
    const margin = objective === 'break_even' ? 0 : m.band[objective];
    assert.ok(m.resultCents / m.revenueCents >= margin);
    assert.equal(m.fee.amountCents, Math.round(m.revenueCents * 0.14) + 600);
    assert.equal('action' in result, false);
    assert.deepEqual(project(input), result);
  });
}

test('projeção e avaliação usam exatamente a mesma memória', () => {
  const p = projection(); const result = project(p);
  const evaluation = evaluate({ ...p.base, scenario: 'projected', priceCents: result.priceCents,
    fee: result.evaluation.memory.fee });
  assert.deepEqual(evaluation, result.evaluation);
});

test('preços projetados nas duas fronteiras cumprem a faixa resultante', () => {
  for (const cost of [13000, 14500, 15000, 65000, 70000, 75000, 100000]) {
    const input = projection(); input.base.cost.amountCents = cost;
    const result = project(input); assert.equal(result.ok, true, JSON.stringify(result));
    const m = result.evaluation.memory;
    assert.equal(m.band.id, policy.getFinalPriceBand(result.priceCents).id);
    assert.ok(m.margin >= m.band.target);
  }
});

test('projeção rejeita cotação vinculada, dados ausentes, denominador inviável e política inválida', () => {
  for (const [mutate, code] of [
    [i => { i.base.shipping = fixture().shipping; }, 'COTACAO_INCOMPATIVEL'],
    [i => { i.feeModel.source = 'ml_observed'; }, 'DADO_INVALIDO'],
    [i => { i.feeModel.rate = null; }, 'DADO_INVALIDO'],
    [i => { i.base.cost.amountCents = null; }, 'DADO_AUSENTE'],
    [i => { i.feeModel.rate = 0.96; }, 'DENOMINADOR_INVIAVEL'],
    [i => { i.base.policy = null; }, 'POLITICA_PRICING_INVALIDA'],
    [i => { i.objective = 'discount'; }, 'OBJETIVO_PRICING_INVALIDO'],
  ]) {
    const input = projection(); mutate(input); const result = project(input);
    assert.equal(result.ok, false); assert.ok(result.reasons.some(r => r.code === code), JSON.stringify(result));
    assert.equal('priceCents' in result, false);
  }
});

test('refinamento por arredondamento tem teto e falha explícita', () => {
  assert.equal(ECONOMIC_MAX_REFINEMENTS, 12);
  const input = projection();
  input.base.policy = structuredClone(policy.FINAL_PRICE_POLICY);
  input.base.policy.bands.forEach(b => { b.floor = 0; b.target = 0.005; b.limit = 0.01; });
  input.feeModel.rate = 0.494999999999; input.feeModel.fixedFeeCents = 0;
  input.base.tax.context.appliedRate = 0.5;
  input.base.tax.context.estimatedRate = 0.5;
  input.base.tax.context.source = 'estimated';
  input.base.cost.amountCents = 0; input.base.shipping.amountCents = 0;
  const result = project(input);
  assert.deepEqual(result, { ok: false, reasons: [{ field: 'projection', code: 'PRECIFICACAO_NAO_CONVERGIU' }] });
  assert.equal('priceCents' in result, false);
});

test('preço sobe um centavo quando componentes arredondados ainda não atingem o alvo', () => {
  const input = projection(); input.base.cost.amountCents = 11;
  input.base.shipping.amountCents = 0; input.feeModel.fixedFeeCents = 0;
  const result = project(input);
  assert.equal(result.ok, true); assert.equal(result.priceCents, 16);
  assert.ok(result.evaluation.memory.margin >= 0.07);
});

test('contexto estimado/protegido não pode enfraquecer a maior alíquota existente', () => {
  const input = fixture(); input.tax.context.source = 'protected';
  input.tax.context.estimatedRate = 0.055;
  hasReason(evaluate(input), 'DADO_INVALIDO', 'tax');
});

test('origens de componentes não podem trocar custo por frete ou projetar histórico como cotação', () => {
  const input = fixture(); input.shipping.source = 'offer';
  hasReason(evaluate(input), 'BASE_INCOMPATIVEL', 'shipping');
  input.shipping.source = 'historical';
  hasReason(evaluate(input), 'BASE_INCOMPATIVEL', 'shipping');
});

test('núcleo novo não importa banco/rede, não lê relógio/ambiente nem escreve consumidores', () => {
  const source = fs.readFileSync('src/services/pricing-economy.ts', 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|fetchML|createClient|createServiceClient|Date\.now|setTimeout|process\.env)\s*[.(]/);
  assert.doesNotMatch(source, /new Date\(\)/);
});
