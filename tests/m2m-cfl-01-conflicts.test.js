const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyCommercialConflicts: classify } = require('../src/services/commercial-conflicts.ts');

const dimensions = ['identity', 'packaging_quantity', 'listing_link', 'economy'];
const precedence = ['CONFLITO_CONFIRMADO', 'INCONCLUSIVO', 'PENDENCIA_VALIDACAO', 'SEM_CONFLITO'];
const evidence = () => ({ source: 'product', reference: 'fixture-product-1', collectedAt: '2026-09-07T10:00:00.000Z', condition: 'valid' });
const assessment = (status = 'SEM_CONFLITO') => ({
  status, coverage: 'complete', reasons: [{ code: 'VERIFICACAO_FIXTURE', ruleId: 'fixture-rule' }], evidence: [evidence()],
});
const fixture = () => Object.fromEntries(dimensions.map(dimension => [dimension, assessment()]));
const byDimension = (result, dimension) => result.dimensions.find(item => item.dimension === dimension);
const hasReason = (result, code) => result.reasons.some(item => item.code === code);

test('quatro dimensões completas produzem SEM_CONFLITO sem conceder escrita', () => {
  const result = classify(fixture());
  assert.equal(result.status, 'SEM_CONFLITO');
  assert.equal(result.version, 'M2M-CFL-01-v1');
  assert.deepEqual(Object.keys(result), ['version', 'status', 'dimensions', 'reasons']);
  assert.deepEqual(result.dimensions.map(item => item.dimension), dimensions);
  assert.equal(result.reasons.length, 4);
});

test('entrada vazia e cada dimensão ausente nunca aprovam implicitamente', () => {
  const empty = classify({});
  assert.equal(empty.status, 'PENDENCIA_VALIDACAO');
  assert.equal(empty.reasons.length, 4);
  for (const dimension of dimensions) {
    const input = fixture(); delete input[dimension];
    const result = classify(input);
    assert.equal(result.status, 'PENDENCIA_VALIDACAO');
    assert.equal(byDimension(result, dimension).reportedStatus, null);
    assert.ok(hasReason(result, 'DIMENSAO_NAO_AVALIADA'));
  }
});

test('validação parcial não aprova, mas conflito material comprovado continua confirmado', () => {
  const input = fixture(); input.identity.coverage = 'partial';
  assert.equal(classify(input).status, 'PENDENCIA_VALIDACAO');
  input.identity.status = 'CONFLITO_CONFIRMADO';
  const result = classify(input);
  assert.equal(result.status, 'CONFLITO_CONFIRMADO');
  assert.ok(hasReason(result, 'VALIDACAO_INCOMPLETA'));
});

test('as 256 combinações respeitam precedência sem perder estados ou motivos', () => {
  for (let combination = 0; combination < 256; combination++) {
    const statuses = dimensions.map((_, index) => precedence[(combination >> (index * 2)) & 3]);
    const input = Object.fromEntries(dimensions.map((dimension, index) => [dimension, assessment(statuses[index])]));
    const result = classify(input);
    assert.equal(result.status, precedence.find(status => statuses.includes(status)));
    assert.deepEqual(result.dimensions.map(item => item.status), statuses);
    assert.equal(result.reasons.length, 4);
  }
});

test('conflito confirmado preserva pendência de vínculo e fonte econômica indisponível', () => {
  const input = fixture();
  input.packaging_quantity.status = 'CONFLITO_CONFIRMADO';
  input.packaging_quantity.reasons = [{ code: 'CONFLITO_EMBALAGEM_QUANTIDADE', ruleId: 'fixture-packaging' }];
  delete input.listing_link;
  input.economy.status = 'INCONCLUSIVO';
  input.economy.reasons = [{ code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL', ruleId: 'fixture-economy' }];
  input.economy.evidence[0].condition = 'unavailable';
  const result = classify(input);
  assert.equal(result.status, 'CONFLITO_CONFIRMADO');
  assert.equal(byDimension(result, 'listing_link').status, 'PENDENCIA_VALIDACAO');
  assert.ok(hasReason(result, 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL'));
});

for (const condition of ['stale', 'invalid', 'unavailable', 'inconsistent']) {
  test(`evidência ${condition} não sustenta aprovação nem conflito confirmado`, () => {
    for (const status of ['SEM_CONFLITO', 'CONFLITO_CONFIRMADO']) {
      const input = fixture(); input.identity.status = status;
      input.identity.evidence[0].condition = condition;
      const result = classify(input);
      assert.equal(result.status, 'INCONCLUSIVO');
      assert.equal(byDimension(result, 'identity').reportedStatus, status);
      assert.equal(byDimension(result, 'identity').evidence[0].condition, condition);
      assert.ok(hasReason(result, 'EVIDENCIA_NAO_CONCLUSIVA'));
    }
  });
}

test('ausência de evidência é pendência, não confirmação de divergência', () => {
  const input = fixture(); input.identity.evidence = [];
  assert.equal(classify(input).status, 'PENDENCIA_VALIDACAO');
  input.identity.status = 'CONFLITO_CONFIRMADO';
  const result = classify(input);
  assert.equal(result.status, 'INCONCLUSIVO');
  assert.ok(hasReason(result, 'EVIDENCIA_AUSENTE'));
});

test('contrato rejeita entradas e avaliações malformadas explicitamente', () => {
  for (const input of [null, undefined, [], 1, 'invalid']) {
    assert.equal(classify(input).status, 'INCONCLUSIVO');
  }
  for (const invalid of [null, {}, { ...assessment(), status: 'APPROVED' },
    { ...assessment(), coverage: undefined }, { ...assessment(), reasons: [] },
    { ...assessment(), reasons: [null] }, { ...assessment(), reasons: new Array(1) },
    { ...assessment(), evidence: null }]) {
    const input = fixture(); input.identity = invalid;
    const result = classify(input);
    assert.equal(result.status, 'INCONCLUSIVO');
    assert.ok(hasReason(result, 'AVALIACAO_INVALIDA'));
  }
});

test('metadados de evidência inválidos ficam explícitos e não contaminam a saída', () => {
  for (const invalid of [null, {}, { ...evidence(), source: 'unknown' },
    { ...evidence(), reference: '' }, { ...evidence(), condition: 'unknown' },
    { ...evidence(), collectedAt: 'ontem' }, { ...evidence(), collectedAt: '2026-02-30T00:00:00Z' },
    { ...evidence(), collectedAt: '2026-09-07T10:00:00' }]) {
    const input = fixture(); input.identity.evidence = [invalid];
    const result = classify(input);
    assert.equal(result.status, 'INCONCLUSIVO');
    assert.ok(hasReason(result, 'EVIDENCIA_INVALIDA'));
    assert.deepEqual(byDimension(result, 'identity').evidence, []);
  }
});

test('não inventa TTL e aceita instantes UTC normalizados com precisão de milissegundos', () => {
  for (const collectedAt of ['2020-01-01T00:00:00Z', '2026-09-07T10:00:00.1Z', '2026-09-07T10:00:00.01Z']) {
    const input = fixture(); input.identity.evidence[0].collectedAt = collectedAt;
    assert.equal(classify(input).status, 'SEM_CONFLITO');
  }
});

test('GTIN coincidente não apaga motivo material informado de marca ou embalagem', () => {
  for (const code of ['MARCA_DIVERGENTE', 'CONFLITO_EMBALAGEM_QUANTIDADE']) {
    const input = fixture();
    input.identity = assessment('CONFLITO_CONFIRMADO');
    input.identity.reasons = [{ code: 'GTIN_COINCIDENTE', ruleId: 'fixture-identity' }, { code, ruleId: 'fixture-identity' }];
    assert.equal(classify(input).status, 'CONFLITO_CONFIRMADO');
    assert.ok(hasReason(classify(input), code));
  }
});

test('score alto, demanda ausente e ranking 404 não mudam classificação', () => {
  for (const status of precedence) {
    const input = fixture(); input.identity.status = status;
    assert.deepEqual(classify({ ...input, score: 100, demand: 'SEM_EVIDENCIA_DE_DEMANDA', ranking: 404 }), classify(input));
  }
});

test('determinístico, independente da ordem das dimensões e sem mutar entradas congeladas', () => {
  const input = fixture();
  for (const item of Object.values(input)) {
    item.evidence.forEach(Object.freeze); Object.freeze(item.evidence);
    item.reasons.forEach(Object.freeze); Object.freeze(item.reasons); Object.freeze(item);
  }
  Object.freeze(input);
  const result = classify(input);
  assert.deepEqual(classify(input), result);
  assert.deepEqual(classify(Object.fromEntries(Object.entries(input).reverse())), result);
  assert.notEqual(result.dimensions[0].reasons[0], input.identity.reasons[0]);
  assert.notEqual(result.dimensions[0].evidence[0], input.identity.evidence[0]);
});

test('copia apenas o contrato, sem propagar payloads extras de provedores', () => {
  const input = fixture();
  input.identity.payload = { arbitrary: 'not-part-of-contract' };
  input.identity.evidence[0].raw = { arbitrary: 'not-part-of-contract' };
  input.identity.reasons[0].raw = { arbitrary: 'not-part-of-contract' };
  const result = classify(input);
  assert.deepEqual(result, classify(fixture()));
});

test('avaliação de identidade vazia não implica cobertura canônica completa', () => {
  const { assessMlListingIdentity } = require('../src/lib/ml-listing-identity.ts');
  const result = assessMlListingIdentity({}, {}, { categoryAttributes: null, remoteEvidence: null });
  const input = fixture(); input.identity = result.identity;
  assert.notEqual(classify(input).status, 'SEM_CONFLITO');
});
