const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const domain = load('src/services/pricing-overrides.ts', { 'server-only': {}, zod: require('zod') });
const permissions = load('src/lib/permissions.ts');
const id = '00000000-0000-4000-8000-000000000001';
const group = { id, version: 1, state: 'verified', members: [{ itemId: 'MLB1', variationId: '', catalog: false }], protection: null, inFlight: false };
const command = { commandId: id, groupId: id, groupVersion: 1, action: 'activate', reason: 'Decisão comercial' };

test('gestão administra override; demais perfis consultam', () => {
  for (const role of ['admin', 'gerente']) assert.equal(permissions.hasPermission(role, 'pricing.override.manage'), true);
  for (const role of ['operador', 'visualizador']) assert.equal(permissions.hasPermission(role, 'pricing.override.manage'), false);
});
test('contrato distingue ativação/revogação e rejeita campos comerciais ou autoria enviada', () => {
  assert.equal(domain.pricingOverrideCommandSchema.safeParse(command).success, true);
  assert.equal(domain.pricingOverrideCommandSchema.safeParse({ ...command, action: 'revoke', overrideId: id }).success, true);
  for (const input of [{ ...command, reason: ' ' }, { ...command, action: 'revoke' }, { ...command, overrideId: id }, { ...command, price: 100 }, { ...command, actorId: id }, { ...command, expiresAt: '2026-10-01' }]) {
    assert.equal(domain.pricingOverrideCommandSchema.safeParse(input).success, false);
  }
});
test('comando usa apenas RPC de governança e autor do backend', async () => {
  let captured;
  const result = await domain.managePricingOverride({ rpc: async (...args) => { captured = args; return { data: id }; } }, id, 'trusted-user', command);
  assert.equal(result, id); assert.equal(captured[0], 'manage_manual_pricing_override');
  assert.equal(captured[1].p_actor_id, 'trusted-user');
  assert.equal(captured[1].p_command_id, id);
  assert.equal(captured[1].p_override_id, undefined);
});
test('erro de storage sanitizado; conflito conhecido preservado', async () => {
  await assert.rejects(domain.managePricingOverride({ rpc: async () => ({ error: { message: 'not-a-real-secret' } }) }, id, id, command), /^Error: pricing_override_write_failed$/);
  await assert.rejects(domain.managePricingOverride({ rpc: async () => ({ error: { message: 'override_group_changed' } }) }, id, id, command), /override_group_changed/);
});
function readerClient(failingTable) {
  const fixtures = { ml_pricing_groups: [{ id, current_version: 2, state: 'verified' }],
    ml_pricing_group_members: [{ group_id: id, version: 2, ml_item_id: 'MLB1', variation_id: '', catalog_listing: false }],
    manual_pricing_overrides: [{ id, group_id: id, origin: 'manual', created_at: '2026-09-07T12:00:00Z', actor_id: id, reason: 'Teste' }],
    pricing_operations: [{ group_id: id }], profiles: [{ id, nome: 'Gestor' }] };
  return { from(table) { return { select() { return this; }, eq() { return this; }, in() { return this; },
    then(resolve) { return Promise.resolve({ data: fixtures[table], error: table === failingTable ? {} : null }).then(resolve); } }; } };
}
test('leitura separa proteção, membros e operação em andamento', async () => {
  const result = await domain.loadPricingOverrides(readerClient(), id);
  assert.equal(result.status, 'available'); assert.equal(result.groups[0].protection.actorName, 'Gestor');
  assert.equal(result.groups[0].members[0].itemId, 'MLB1'); assert.equal(result.groups[0].inFlight, true);
  assert.equal('price' in result.groups[0], false);
});
test('falha em qualquer fonte de proteção não vira desprotegido', async () => {
  for (const table of ['ml_pricing_groups', 'ml_pricing_group_members', 'manual_pricing_overrides', 'pricing_operations', 'profiles']) {
    await assert.rejects(domain.loadPricingOverrides(readerClient(table), id), /pricing_override_read_failed/);
  }
});
function routeHarness(options = {}) {
  let writes = 0;
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: options.noGroup && !options.archivedRetry ? null : { id, cargo: options.role || 'admin' } }) };
  const routes = load('src/app/api/produtos/[id]/pricing-overrides/route.ts', {
    'next/server': next, zod: require('zod'), '@/lib/permissions': permissions,
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id } } }) }, from: () => query }), createServiceClient: () => ({ from: () => query }) },
    '@/lib/api-request-auth': { authorizeApiRequest: async (_req, permission) => {
      assert.equal(permission, 'pricing.override.manage');
      return options.denied ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, userId: id };
    } },
    '@/lib/products/bnt-d07-visual-review': { loadBntD07VisualReview: async () => options.fixture ? { items: [{ product: { id: 'fixture' }, mlListings: [{ itemId: 'MLB1' }] }] } : null },
    '@/services/pricing-overrides': { ...domain,
      loadPricingOverrides: async () => { if (options.readError) throw Error('unavailable'); return { status: 'available', groups: options.noGroup ? [] : [group] }; },
      managePricingOverride: async (_client, productId, actorId, body) => { assert.equal(productId, id); assert.equal(actorId, id); assert.deepEqual(body, command); writes++; if (options.conflict) throw Error('override_group_changed'); return id; },
    },
  });
  const context = { params: Promise.resolve({ id }) };
  return { get: () => routes.GET(new Request('http://local/'), context),
    post: (body = command) => routes.POST(new Request('http://local/', { method: 'POST', body: JSON.stringify(body) }), context), writes: () => writes };
}
test('GET autenticado, consulta para operador e gerenciamento só gestão', async () => {
  assert.equal((await routeHarness({ anonymous: true }).get()).status, 401);
  const read = await routeHarness({ role: 'operador' }).get();
  assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal((await read.json()).canManage, false);
  assert.equal((await (await routeHarness().get()).json()).canManage, true);
  assert.equal((await routeHarness({ readError: true }).get()).status, 503);
});
test('POST rejeita permissão, referência incompatível, fixture e payload inválido antes da escrita', async () => {
  for (const [options, expected] of [[{ denied: true }, 403], [{ fixture: true }, 409], [{ noGroup: true }, 409], [{ readError: true }, 503]]) {
    const h = routeHarness(options); assert.equal((await h.post()).status, expected); assert.equal(h.writes(), 0);
  }
  const h = routeHarness(); assert.equal((await h.post({ ...command, actorId: id })).status, 422); assert.equal(h.writes(), 0);
});
test('POST aplica comando explícito; conflito pede atualização sem retry automático', async () => {
  const h = routeHarness(); assert.equal((await h.post()).status, 200); assert.equal(h.writes(), 1);
  const conflict = await routeHarness({ conflict: true }).post(); assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'override_group_changed');
});
test('retry de grupo arquivado removido da leitura ainda chega ao contrato idempotente', async () => {
  const h = routeHarness({ noGroup: true, archivedRetry: true });
  assert.equal((await h.post()).status, 200); assert.equal(h.writes(), 1);
});
test('interface conserva confirmação, idempotência, estados explícitos e histórico', () => {
  const ui = fs.readFileSync('src/components/products/PricingOverrideControl.tsx', 'utf8');
  for (const label of ['Proteger contra alterações automáticas', 'Remover proteção', 'Motivo obrigatório', 'Ver histórico', 'Propagada automaticamente']) assert.ok(ui.includes(label));
  assert.match(ui, /command \?\?/); assert.match(ui, /crypto\.randomUUID/); assert.match(ui, /state\.canManage/);
  assert.match(ui, /Estado desconhecido/); assert.match(ui, /grupo arquivado/);
  assert.doesNotMatch(ui, /setInterval|setTimeout|atualizar-preco|enqueueMlPublishOutbox/);
  assert.equal(require('../src/lib/ml/pricing-execution.js').getPricingExecutionBlock().code, 'pricing_execution_not_ready');
});

function renderControl(state, props = {}) {
  const React = require('react'); let index = 0;
  const Component = load('src/components/products/PricingOverrideControl.tsx', {
    react: { ...React, useState: initial => [index++ === 0 ? state : initial, () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: initial => ({ current: initial }) },
    'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'),
  }).default;
  return require('react-dom/server').renderToStaticMarkup(React.createElement(Component, { productId: id, ...props }));
}
test('renderização real Ant Design: proteção propagada, membros e operação em andamento', () => {
  const html = renderControl({ canManage: true, groups: [{ ...group, inFlight: true, protection: { id, origin: 'propagated', createdAt: '2026-09-07T12:00:00Z', reason: 'Propagação teste', actorId: null, actorName: null } }] });
  assert.match(html, /Remover proteção/); assert.match(html, /Propagada automaticamente/);
  assert.match(html, /MLB1/); assert.match(html, /operação já solicitada/);
});
test('renderização de operador não oferece gestão e fixture permanece bloqueada', () => {
  const html = renderControl({ canManage: false, groups: [group] });
  assert.doesNotMatch(html, /Proteger contra alterações automáticas|Remover proteção/);
  assert.match(html, /Sem proteção manual/); assert.match(html, /Ver histórico/);
  const fixture = renderControl(null, { disabled: true });
  assert.match(fixture, /gerenciamento indisponível/);
});
