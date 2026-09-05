const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const {
  FINAL_PRICE_POLICY,
  FINAL_PRICE_MAX_ITERATIONS,
  isFinalPricePolicy,
  getFinalPriceBand,
  resolveFinalPrice,
} = require('../src/services/pricing-policy.ts');

const clonePolicy = () => JSON.parse(JSON.stringify(FINAL_PRICE_POLICY));
const candidatePrices = prices => ({ band }) => prices[band.id];
const stablePrices = { UP_TO_200: 19_000, FROM_200_TO_1000: 50_000, ABOVE_1000: 150_000 };

test('política M2M é versionada, imutável e contém somente as três faixas finais', () => {
  assert.equal(FINAL_PRICE_POLICY.version, 'M2M-PRC-01-v1');
  assert.deepEqual(FINAL_PRICE_POLICY.bands, [
    { id: 'UP_TO_200', maxCents: 20_000, floor: 0.05, target: 0.07, limit: 0.10 },
    { id: 'FROM_200_TO_1000', maxCents: 100_000, floor: 0.07, target: 0.10, limit: 0.15 },
    { id: 'ABOVE_1000', maxCents: null, floor: 0.10, target: 0.15, limit: 0.20 },
  ]);
  assert.equal(isFinalPricePolicy(FINAL_PRICE_POLICY), true);
  for (const value of [FINAL_PRICE_POLICY, FINAL_PRICE_POLICY.bands, ...FINAL_PRICE_POLICY.bands]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Reflect.set(FINAL_PRICE_POLICY.bands[0], 'floor', 0.99), false);
});

for (const [priceCents, bandId] of [
  [1, 'UP_TO_200'], [19_999, 'UP_TO_200'], [20_000, 'UP_TO_200'],
  [20_001, 'FROM_200_TO_1000'], [100_000, 'FROM_200_TO_1000'],
  [100_001, 'ABOVE_1000'], [Number.MAX_SAFE_INTEGER, 'ABOVE_1000'],
]) {
  test(`seleção e estabilização no preço final de ${priceCents} centavos`, () => {
    assert.equal(getFinalPriceBand(priceCents).id, bandId);
    const result = resolveFinalPrice({ objective: 'target', calculateCandidate: () => priceCents });
    assert.equal(result.ok, true);
    assert.equal(result.priceCents, priceCents);
    assert.equal(result.band.id, bandId);
    assert.equal(result.policyVersion, FINAL_PRICE_POLICY.version);
    assert.equal(result.objective, 'target');
  });
}

test('rejeita preços ausentes, zero, negativos, fração de centavo e precisão insegura', () => {
  for (const value of [null, undefined, '', '20000', 0, -1, 20_000.1, NaN, Infinity,
    -Infinity, Number.MAX_SAFE_INTEGER + 1, {}, false]) {
    assert.equal(getFinalPriceBand(value), null);
    const result = resolveFinalPrice({ objective: 'target', calculateCandidate: () => value });
    assert.deepEqual(result, { ok: false, error: 'PRECO_CANDIDATO_INVALIDO', iterations: 1 });
    assert.equal('priceCents' in result, false);
  }
});

test('política inválida não usa fallback nem executa o cálculo', () => {
  const invalid = [null, {}, [], { ...clonePolicy(), version: '' },
    { ...clonePolicy(), version: 1 }, { ...clonePolicy(), bands: [] },
    { ...clonePolicy(), bands: new Array(3) }];
  for (const mutate of [
    p => { p.bands[0] = null; },
    p => { p.bands[0].maxCents = null; },
    p => { p.bands[0].maxCents = 20_001; },
    p => { p.bands[1].maxCents = 20_000; },
    p => { p.bands[2].maxCents = 1_000_000; },
    p => { p.bands.reverse(); },
    p => { p.bands[1].id = p.bands[0].id; },
    p => { p.bands[0].floor = 0.08; },
    p => { p.bands[0].target = 0.11; },
    p => { p.bands[0].floor = -0.01; },
    p => { p.bands[2].limit = 1; },
    p => { p.bands[0].floor = NaN; },
    p => { p.bands[0].target = Infinity; },
    p => { p.bands[0].target = '0.07'; },
  ]) {
    const policy = clonePolicy();
    mutate(policy);
    invalid.push(policy);
  }
  for (const policy of invalid) {
    assert.equal(isFinalPricePolicy(policy), false);
    assert.equal(getFinalPriceBand(10_000, policy), null);
    assert.deepEqual(resolveFinalPrice({
      policy, objective: 'target', calculateCandidate: () => assert.fail('não deve calcular'),
    }), { ok: false, error: 'POLITICA_PRICING_INVALIDA', iterations: 0 });
  }
});

test('aceita parâmetros ordenados em política explícita sem alterar a canônica', () => {
  const policy = clonePolicy();
  policy.version = 'test-only';
  policy.bands[0].target = 0.08;
  assert.equal(isFinalPricePolicy(policy), true);
  const result = resolveFinalPrice({ policy, objective: 'target', calculateCandidate: ({ band, margin }) => {
    assert.equal(margin, band.target);
    return stablePrices[band.id];
  } });
  assert.equal(result.policyVersion, 'test-only');
  assert.equal(FINAL_PRICE_POLICY.bands[0].target, 0.07);
});

for (const objective of ['floor', 'target', 'limit', 'break_even']) {
  test(`objetivo ${objective} usa a margem da faixa sobre receita`, () => {
    const seen = [];
    const result = resolveFinalPrice({ objective, calculateCandidate: input => {
      seen.push([input.band.id, input.margin]);
      assert.equal(input.objective, objective);
      assert.equal(input.margin, objective === 'break_even' ? 0 : input.band[objective]);
      return stablePrices[input.band.id];
    } });
    assert.equal(result.ok, true);
    assert.equal(result.priceCents, 19_000);
    assert.equal(result.iterations, 3);
    assert.deepEqual(seen.map(row => row[0]), FINAL_PRICE_POLICY.bands.map(b => b.id));
  });
}

test('cruza para cima e recalcula usando a margem da faixa resultante', () => {
  const visited = [];
  const result = resolveFinalPrice({ objective: 'target', calculateCandidate: ({ band }) => {
    visited.push(band.id);
    return { UP_TO_200: 20_001, FROM_200_TO_1000: 21_000, ABOVE_1000: 21_000 }[band.id];
  } });
  assert.equal(result.priceCents, 21_000);
  assert.equal(result.band.id, 'FROM_200_TO_1000');
  assert.deepEqual(visited.slice(0, 2), ['UP_TO_200', 'FROM_200_TO_1000']);
  assert.equal(result.iterations, visited.length);
});

test('cruza para baixo e recalcula antes de aceitar', () => {
  const visited = [];
  const result = resolveFinalPrice({ objective: 'target', calculateCandidate: ({ band }) => {
    visited.push(band.id);
    return { UP_TO_200: 19_000, FROM_200_TO_1000: 20_000, ABOVE_1000: 20_000 }[band.id];
  } });
  assert.equal(result.priceCents, 19_000);
  assert.equal(result.band.id, 'UP_TO_200');
  assert.deepEqual(visited.slice(-2), ['ABOVE_1000', 'UP_TO_200']);
});

test('escolhe a menor das soluções estáveis sem usar preço vigente ou performance', () => {
  const result = resolveFinalPrice({ objective: 'target', calculateCandidate: candidatePrices(stablePrices) });
  assert.equal(result.priceCents, 19_000);
  assert.equal('action' in result, false);
  // Observar preço alto só seleciona faixa; não limita a margem nem cria comando de redução.
  assert.equal(getFinalPriceBand(9_000_000).id, 'ABOVE_1000');
  assert.equal('maxMargin' in FINAL_PRICE_POLICY, false);
});

test('ciclo sem solução termina explicitamente dentro do teto técnico', () => {
  let calls = 0;
  const calculate = candidatePrices({ UP_TO_200: 20_001, FROM_200_TO_1000: 100_001, ABOVE_1000: 20_000 });
  const result = resolveFinalPrice({ objective: 'target', calculateCandidate: input => {
    calls++;
    return calculate(input);
  } });
  assert.deepEqual(result, { ok: false, error: 'PRECIFICACAO_NAO_CONVERGIU', iterations: 9 });
  assert.equal(calls, 9);
  assert.equal(FINAL_PRICE_MAX_ITERATIONS, 12);
  assert.ok(calls <= FINAL_PRICE_POLICY.bands.length * FINAL_PRICE_MAX_ITERATIONS);
});

test('ciclo em algumas candidatas não descarta outra solução estável', () => {
  const result = resolveFinalPrice({ objective: 'floor', calculateCandidate: candidatePrices({
    UP_TO_200: 20_001, FROM_200_TO_1000: 20_000, ABOVE_1000: 100_001,
  }) });
  assert.equal(result.ok, true);
  assert.equal(result.priceCents, 100_001);
});

test('falha de cálculo não vira preço alternativo nem reproduz mensagem do chamador', () => {
  assert.deepEqual(resolveFinalPrice({ objective: 'target', calculateCandidate: () => {
    throw new Error('mensagem privada de teste');
  } }), { ok: false, error: 'CALCULO_CANDIDATO_FALHOU', iterations: 1 });
  const result = resolveFinalPrice({ objective: 'target', calculateCandidate: ({ band }) => {
    if (band.id === 'UP_TO_200') return 19_000;
    throw new Error('falha posterior');
  } });
  assert.deepEqual(result, { ok: false, error: 'CALCULO_CANDIDATO_FALHOU', iterations: 2 });
});

test('não aceita candidato inválido posterior a um candidato estável', () => {
  assert.deepEqual(resolveFinalPrice({ objective: 'target', calculateCandidate: candidatePrices({
    ...stablePrices, ABOVE_1000: NaN,
  }) }), { ok: false, error: 'PRECO_CANDIDATO_INVALIDO', iterations: 3 });
});

test('rejeita objetivos e calculadores inválidos sem cálculo', () => {
  for (const objective of [undefined, null, '', 'markup', 'toString']) {
    assert.deepEqual(resolveFinalPrice({ objective, calculateCandidate: () => assert.fail() }),
      { ok: false, error: 'OBJETIVO_PRICING_INVALIDO', iterations: 0 });
  }
  assert.deepEqual(resolveFinalPrice({ objective: 'target', calculateCandidate: null }),
    { ok: false, error: 'CALCULO_CANDIDATO_FALHOU', iterations: 0 });
});

test('entradas idênticas produzem saídas idênticas sem mutar a política', () => {
  const policy = clonePolicy();
  const before = JSON.stringify(policy);
  const input = { policy, objective: 'target', calculateCandidate: candidatePrices(stablePrices) };
  assert.deepEqual(resolveFinalPrice(input), resolveFinalPrice(input));
  assert.equal(JSON.stringify(policy), before);
});

test('snapshot privado impede alteração da política durante resolução', () => {
  const policy = clonePolicy();
  const result = resolveFinalPrice({ policy, objective: 'target', calculateCandidate: ({ band }) => {
    policy.bands[0].maxCents = 1;
    policy.version = 'alterada-pelo-chamador';
    assert.equal(Object.isFrozen(band), true);
    return stablePrices[band.id];
  } });
  assert.equal(result.ok, true);
  assert.equal(result.priceCents, 19_000);
  assert.equal(result.policyVersion, FINAL_PRICE_POLICY.version);
});

test('módulo puro só importa tipos e não depende de banco/rede/publicação', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/pricing-policy.ts'), 'utf8');
  const ast = ts.createSourceFile('pricing-policy.ts', source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    assert.equal(statement.importClause.isTypeOnly, true);
  }
  assert.doesNotMatch(source, /\b(?:fetch|fetchML|createClient|process|require|setTimeout)\s*[.(]/);
});
