const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const audit = load('src/services/pricing-audit.ts', { zod: require('zod') });
const id = '00000000-0000-4000-8000-000000000001';
const op = { id, evaluationId: id, groupId: id, groupVersion: 1, itemId: 'MLB1', priceCents: 10000, source: 'manual', actorId: id, reason: 'manual_edit' };
test('oito origens e contrato estrito; manual requer autor', async () => {
  assert.equal(audit.pricingSourceSchema.options.length, 8);
  const client = { rpc: async () => ({ data: id }) };
  for (const source of audit.pricingSourceSchema.options) assert.equal(await audit.preparePricingOperation(client, { ...op, source }), id);
  await assert.rejects(audit.preparePricingOperation(client, { ...op, actorId: null }), /pricing_actor_required/);
  await assert.rejects(audit.preparePricingOperation(client, { ...op, token: 'not-a-real-secret' }));
});
test('persistência é RPC observacional sem transporte ou efeito comercial', async () => {
  let called; const rows = [{ ml_item_id: 'MLB1', preco_ml: 100 }];
  await audit.persistPricingObservations({ rpc: async (...args) => { called = args; return { data: rows }; } }, 'anuncios_ml', rows, '2026-09-07T00:00:00Z');
  assert.equal(called[0], 'persist_ml_pricing_observations'); assert.deepEqual(called[1].p_rows, rows);
  const result = await audit.persistPricingObservations({ rpc: async () => ({ error: { message: 'not-a-real-secret' } }) }, 'anuncios_ml', rows);
  assert.equal(result.error.message, 'pricing_observation_persistence_failed');
});
test('avaliação armazena somente contrato econômico; nenhuma inferência de autoria', async () => {
  let row;
  const client = { from: () => ({ insert(value) { row = value; return this; }, select() { return this; }, single: async () => ({ data: { id } }) }) };
  await audit.recordPricingEvaluation(client, id, id, { current: { memory: null }, target: {}, floor: {}, breakEven: {}, token: 'not-a-real-secret' });
  assert.equal(typeof row.fingerprint, 'string'); assert.equal(JSON.stringify(row).includes('not-a-real-secret'), false);
});
test('falha de armazenamento nunca vira avaliação entregue', async () => {
  const client = { from: () => ({ insert() { return this; }, select() { return this; }, single: async () => ({ error: {} }) }) };
  await assert.rejects(audit.recordPricingEvaluation(client, id, id, { current: { memory: null } }), /pricing_evaluation_persistence_failed/);
});
test('assinatura ignora refresh, mas reconhece alteração econômica', () => {
  assert.equal(audit.pricingMaterialFingerprint({ cost: 100, observedAt: 'A', fingerprint: 'A' }), audit.pricingMaterialFingerprint({ observedAt: 'B', fingerprint: 'B', cost: 100 }));
  assert.notEqual(audit.pricingMaterialFingerprint({ cost: 100 }), audit.pricingMaterialFingerprint({ cost: 101 }));
});
test('preço antigo rejeitado pelo banco não é reportado como aplicado', async () => {
  const result = await audit.persistPricingObservations({ rpc: async () => ({ data: [{ ml_item_id: 'MLB1', preco_ml: 120 }] }) }, 'anuncios_ml', [{ ml_item_id: 'MLB1', preco_ml: 100 }]);
  assert.equal(result.error.message, 'pricing_observation_outdated_or_conflicting');
});
test('evidência rejeita payload arbitrário e URL contendo credencial', async () => {
  const client = { rpc: async () => { throw new Error('should_not_call'); } };
  await assert.rejects(audit.transitionPricingOperation(client, id, 'confirmed', { token: 'not-a-real-secret' }), e => !e.message.includes('should_not_call'));
  await assert.rejects(audit.transitionPricingOperation(client, id, 'confirmed', { reference: 'https://example.test/?token=x' }), e => !e.message.includes('should_not_call'));
});
test('guard permanece incondicional; contrato de trilha não chama ML', () => {
  assert.equal(require('../src/lib/ml/pricing-execution.js').getPricingExecutionBlock().code, 'pricing_execution_not_ready');
  const src = fs.readFileSync('src/services/pricing-audit.ts', 'utf8');
  assert.doesNotMatch(src, /fetchML|enqueueMlPublishOutbox|updateItemPrice/);
});

function historyHarness(user, rows = [], error = null) {
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, lt() { return this; },
    maybeSingle: async () => ({ data: { id } }), then(resolve) { return Promise.resolve({ data: rows, error }).then(resolve); } };
  return load('src/app/api/produtos/[id]/pricing-history/route.ts', { zod: require('zod'), 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }), createServiceClient: () => ({ from: () => query }) } }).GET;
}
test('histórico autentica, valida filtros, pagina e não armazena cache', async () => {
  const req = new Request('http://local/pricing-history?limit=1'); const ctx = { params: Promise.resolve({ id }) };
  assert.equal((await historyHarness(null)(req, ctx)).status, 401);
  assert.equal((await historyHarness({ id })(new Request('http://local/?limit=999'), ctx)).status, 422);
  const response = await historyHarness({ id }, [{ id: 12, kind: 'observed' }])(req, ctx);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).nextCursor, '12');
});
