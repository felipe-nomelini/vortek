const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const id = '00000000-0000-4000-8000-000000000006';
const pricing = { costCents: 10000, current: { status: 'inconclusive', memory: null, reasons: [] }, target: {}, floor: {}, breakEven: {} };
const domain = load('src/services/pricing-clearances.ts', { 'server-only': {}, zod: require('zod'),
  './pricing-context': { loadProductPricing: async () => new Map([[id, pricing]]) }, './pricing-overrides': { loadPricingOverrides: async () => ({ groups: [] }) } });
const permissions = load('src/lib/permissions.ts');
const command = { commandId: id, action: 'activate', groupId: id, groupVersion: 1, reason: 'TEST', quantity: 5, maxLossCents: 200,
  acceptLoss: true, endsAt: null, stockFingerprint: 'a'.repeat(64) };
test('alçada: admin e gerente; leitura para os demais', () => {
  for (const role of ['admin', 'gerente']) assert.equal(permissions.hasPermission(role, 'pricing.clearance.manage'), true);
  for (const role of ['operador', 'visualizador']) assert.equal(permissions.hasPermission(role, 'pricing.clearance.manage'), false);
});
test('contrato exige prejuízo explícito, quantidade, vigência e rejeita autoria ou preço', () => {
  assert.equal(domain.pricingClearanceCommandSchema.safeParse(command).success, true);
  for (const input of [{ ...command, acceptLoss: false }, { ...command, quantity: 0 }, { ...command, quantity: 1.5 },
    { ...command, maxLossCents: -1 }, { ...command, endsAt: undefined }, { ...command, stockFingerprint: '' },
    { ...command, actorId: id }, { ...command, newPrice: 10 }, { ...command, maxLossCents: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(domain.pricingClearanceCommandSchema.safeParse(input).success, false);
  }
  assert.equal(domain.pricingClearanceCommandSchema.safeParse({ ...command, maxLossCents: 0, acceptLoss: false }).success, true);
  assert.equal(domain.pricingClearanceCommandSchema.safeParse({ ...command, endsAt: '2030-01-01T00:00:00Z' }).success, true);
});
for (const [result, max, expected] of [[1, 0, 'within_limit'], [0, 0, 'within_limit'], [-1, 0, 'loss_exceeded'], [-200, 200, 'within_limit'], [-201, 200, 'loss_exceeded']]) {
  test(`limite econômico: resultado ${result}, perda máxima ${max}`, () => {
    assert.equal(domain.clearanceEconomicDecision({ status: 'available', memory: { resultCents: result } }, max), expected);
    assert.equal(domain.clearanceEconomicDecision({ status: 'estimated', memory: { resultCents: result } }, max), expected);
  });
}
test('ausência de evidência não é confirmação de prejuízo', () => {
  assert.equal(domain.clearanceEconomicDecision(pricing.current, 200), 'inconclusive');
});
test('registro usa backend/RPC atômica, nunca recebe memória ou autoria do browser', async () => {
  let captured;
  const client = { rpc: async (...args) => { captured = args; return { data: id }; } };
  assert.equal(await domain.managePricingClearance(client, { id }, 'trusted-actor', command), id);
  assert.equal(captured[0], 'manage_internal_stock_clearance');
  assert.equal(captured[1].p_actor_id, 'trusted-actor');
  assert.equal(captured[1].p_evaluation.current.status, 'inconclusive');
  assert.deepEqual(captured[1].p_command, command);
});
test('revogação não depende de economia disponível', async () => {
  let captured;
  await domain.managePricingClearance({ rpc: async (...a) => { captured = a; return { data: id }; } }, { id }, id,
    { commandId: id, action: 'revoke', groupId: id, groupVersion: 1, clearanceId: id, reason: 'Encerramento' });
  assert.equal(captured[1].p_evaluation, undefined);
});
test('falhas sanitizadas sem inventar sucesso', async () => {
  await assert.rejects(domain.managePricingClearance({ rpc: async () => ({ error: { message: 'private-value-test' } }) }, { id }, id, command), /^Error: clearance_write_failed$/);
  await assert.rejects(domain.managePricingClearance({ rpc: async () => ({ error: { message: 'clearance_stock_changed' } }) }, { id }, id, command), /clearance_stock_changed/);
});
function harness(options = {}) {
  let writes = 0;
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id, cargo: 'admin' } }),
    then: resolve => Promise.resolve({ data: [], error: options.readError ? {} : null }).then(resolve) };
  const routes = load('src/app/api/produtos/[id]/pricing-clearances/route.ts', { zod: require('zod'),
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id } } }) }, from: () => query }), createServiceClient: () => ({ from: () => query }) },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => options.denied ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, userId: id } },
    '@/lib/permissions': permissions,
    '@/lib/products/bnt-d07-visual-review': { loadBntD07VisualReview: async () => options.fixture ? { items: [{ product: { id } }] } : null },
    '@/services/pricing-clearances': { ...domain, loadPricingClearances: async () => ({ status: 'available' }),
      managePricingClearance: async () => { writes++; if (options.conflict) throw Error('clearance_group_changed'); return id; } },
  });
  return { writes: () => writes, get: () => routes.GET(new Request('http://test/'), { params: Promise.resolve({ id }) }),
    post: (body = command) => routes.POST(new Request('http://test/', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }) };
}
test('API autentica GET e usa no-store', async () => {
  assert.equal((await harness({ noUser: true }).get()).status, 401);
  const result = await harness().get(); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('API impede fixture, falha de leitura, permissão e payload adulterado antes da escrita', async () => {
  for (const [options, status] of [[{ denied: true }, 403], [{ fixture: true }, 409], [{ readError: true }, 503]]) {
    const h = harness(options); assert.equal((await h.post()).status, status); assert.equal(h.writes(), 0);
  }
  const h = harness(); assert.equal((await h.post({ ...command, actorId: id })).status, 422); assert.equal(h.writes(), 0);
});
test('API reporta registro sem afirmar alteração de preço; conflitos não são sucesso', async () => {
  const result = await harness().post(); assert.equal(result.status, 200); assert.equal((await result.json()).priceChanged, false);
  assert.equal((await harness({ conflict: true }).post()).status, 409);
});
function render(state, disabled = false) {
  const React = require('react'); let index = 0;
  const Component = load('src/components/products/PricingClearanceControl.tsx', {
    react: { ...React, useState: initial => [index++ === 0 ? state : initial, () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: initial => ({ current: initial }) },
    'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'),
    '@/lib/user-feedback': require('../src/lib/user-feedback.ts'),
  }).default;
  return require('react-dom/server').renderToStaticMarkup(React.createElement(Component, { productId: id, disabled }));
}
const state = { canManage: true, stock: { capacity: 0 }, pricing, groups: [], clearances: [{ id, state: 'active', reason: 'TEST campaign', startsAt: '2026-09-07T12:00:00Z', endsAt: null,
  maxLossCents: 200, quantity: 5, available: 2, actorName: 'Gestor', closedAt: null, closeReason: null, groups: [{ id, version: 1, state: 'verified', conflict: false }] }] };
test('reader agrega estado e decisão econômica sem autorizar execução', async () => {
  const client = { rpc: async name => ({ data: name === 'get_internal_clearance_stock' ? { capacity: 0, fingerprint: 'a'.repeat(64) } : state.clearances }) };
  const result = await domain.loadPricingClearances(client, { id });
  assert.equal(result.executionBlocked, true); assert.equal(result.clearances[0].economicDecision, 'inconclusive');
  await assert.rejects(domain.loadPricingClearances({ rpc: async () => ({ error: {} }) }, { id }), /clearance_read_failed/);
});
test('preparação exige contrato completo de liquidação e preserva chamada antiga', async () => {
  const audit = load('src/services/pricing-audit.ts', { zod: require('zod') });
  const base = { id, evaluationId: id, groupId: id, groupVersion: 1, itemId: 'MLB1', priceCents: 10000, source: 'manual', actorId: id, reason: 'TEST' };
  let captured; const client = { rpc: async (...a) => { captured = a; return { data: id }; } };
  for (const extra of [{ clearanceId: id }, { fulfillmentSource: 'internal' }, { clearanceId: id, fulfillmentSource: 'supplier', clearanceQuantity: 1 },
    { clearanceId: id, fulfillmentSource: 'internal', clearanceQuantity: 1, source: 'scheduled_job' }]) await assert.rejects(audit.preparePricingOperation(client, { ...base, ...extra }));
  await audit.preparePricingOperation(client, { ...base, clearanceId: id, fulfillmentSource: 'internal', clearanceQuantity: 2 });
  assert.equal(captured[1].p_quantity, 2); assert.equal(captured[1].p_clearance_id, id);
});
test('renderização Ant Design real mostra limite, quantidade compartilhada e inconclusivo', () => {
  const html = render(state);
  for (const label of ['Liquidação de estoque interno', '2/5', 'Perda máxima', 'quantidade compartilhada', 'Impacto econômico inconclusivo', 'Revogar liquidação', 'Encerrar liquidação', 'Ver histórico']) assert.ok(html.includes(label), label);
});
test('operador consulta sem gerir; fixture não ativa', () => {
  const html = render({ ...state, canManage: false }); assert.doesNotMatch(html, /Revogar liquidação|Encerrar liquidação/);
  assert.match(render(null, true), /gerenciamento indisponível/);
});
test('nenhuma automação, polling ou escritor ML é habilitado', () => {
  for (const path of ['src/components/products/PricingClearanceControl.tsx', 'src/services/pricing-clearances.ts']) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /setInterval|setTimeout|fetchML|enqueueMlPublishOutbox/);
  assert.equal(require('../src/lib/ml/pricing-execution.js').getPricingExecutionBlock().code, 'pricing_execution_not_ready');
});
