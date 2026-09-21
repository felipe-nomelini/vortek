const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MODEL, buildState, callJev, eligibleAttribute, loadBaseline,
  makeQuestion, parseChoice, selectCases,
} = require('../scripts/jev-attribute-pilot-lib');

const attribute = {
  id: 'CALCULATOR_TYPE', name: 'Tipo de calculadora', value_type: 'list',
  tags: {}, values: [
    { id: '1', name: 'Científica' }, { id: '2', name: 'Financeira' },
  ],
};

test('a referência executa a regra atual do formulário, sem copiá-la no piloto', () => {
  const baseline = loadBaseline(async () => []);
  const product = { nome: 'Calculadora científica ClassWiz', marca: 'Casio', descricao: '' };
  const facts = baseline.extractMlProductFacts(product);
  const filled = baseline.fillAttribute(attribute, facts, new Map(), product);
  assert.equal(filled.value_id, '1');
  assert.equal(filled.source, 'obvious_product_inference');
  assert.equal(baseline.isMlCriticalAttributeId('BRAND'), true);
  assert.equal(baseline.isMlCriticalAttributeId('CALCULATOR_TYPE'), false);
});

test('só atributos de lista oficial não críticos entram na comparação', () => {
  const baseline = loadBaseline(async () => []);
  assert.equal(eligibleAttribute(attribute, baseline.isMlCriticalAttributeId), true);
  assert.equal(eligibleAttribute({ ...attribute, id: 'BRAND' }, baseline.isMlCriticalAttributeId), false);
  assert.equal(eligibleAttribute({ ...attribute, value_type: 'string' }, baseline.isMlCriticalAttributeId), false);
  assert.equal(eligibleAttribute({ ...attribute, values: [{ id: '1', name: 'Científica' }] }, baseline.isMlCriticalAttributeId), false);
  assert.equal(eligibleAttribute({ ...attribute, tags: { hidden: true } }, baseline.isMlCriticalAttributeId), false);
});

test('o estado enviado exclui campos operacionais e remove dados pessoais', () => {
  const state = buildState({ nome: 'Calculadora', marca: 'Casio', descricao: 'Veja https://exemplo.test e escreva a contato@exemplo.test. Preço R$ 123,45.', custo: 999, cliente: 'Pessoa' }, 'Ligue (11) 91234-5678');
  const text = JSON.stringify(state);
  assert.deepEqual(Object.keys(state.product), ['name', 'brand', 'description']);
  assert.doesNotMatch(text, /exemplo\.test|contato@|123,45|91234|999|Pessoa/);
  assert.throws(() => buildState({ nome: 'Produto', descricao: 'secret: valor' }), /possível credencial/);
});

test('resposta válida fica vinculada aos ids oficiais e baixa confiança fica inconclusiva', () => {
  const prepared = makeQuestion(attribute);
  assert.equal(prepared.question.criteria.no_evidence.includes('não comprovam'), true);
  const payload = { answers: { q0: { type: 'choice', choice: 'value_0', confidence: 0.9,
    probabilities: { no_evidence: 0.02, value_0: 0.96, value_1: 0.02 } } } };
  assert.deepEqual(parseChoice(payload, 'q0', prepared.values).choice, { id: '1', name: 'Científica' });
  payload.answers.q0.confidence = 0.3;
  assert.equal(parseChoice(payload, 'q0', prepared.values).status, 'inconclusive');
  payload.answers.q0.choice = 'inventado';
  assert.throws(() => parseChoice(payload, 'q0', prepared.values), /fora das opções/);
});

test('erro e resposta inválida da API não viram sugestão', async () => {
  const state = buildState({ nome: 'Calculadora' });
  const questions = { q0: makeQuestion(attribute).question };
  const calls = [];
  const good = await callJev(state, questions, 'test-only', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ model: MODEL, answers: {}, usage: { input_tokens: 1000, output_tokens: 2 } }) };
  });
  assert.ok(Math.abs(good.estimatedUsd - 0.000042) < 1e-12);
  assert.equal(JSON.parse(calls[0].options.body).state.product.name, 'Calculadora');
  assert.equal(calls[0].options.method, 'POST');
  await assert.rejects(callJev(state, questions, 'test-only', async () => ({ ok: false, status: 429 })), /HTTP 429/);
  await assert.rejects(callJev(state, questions, 'test-only', async () => ({ ok: true, json: async () => ({ answers: {} }) })), /inválida/);
});

test('amostra limita casos por produto e distribui categorias', () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, i) => ({ categoryId: 'MLB1', productId: 'p1', id: i })),
    { categoryId: 'MLB2', productId: 'p2', id: 6 },
  ];
  assert.deepEqual(selectCases(candidates, 5).map((row) => row.id), [0, 6, 1, 2]);
});
