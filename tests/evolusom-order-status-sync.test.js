const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const { readEvolusomMerchantOrderStatus } = require('../src/lib/evolusom/order-status.ts');
const { EvolusomApiError } = require('../src/services/evolusom.ts');

const routeSource = fs.readFileSync(require.resolve('../src/app/api/sync/evolusom-pedidos/route.ts'), 'utf8');
const compiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(remoteStatusByOrder) {
  const purchases = [
    { id: 'direct-1', fornecedor_id: '133', evolusom_request_state: 'created', evolusom_order_id: 63012091, status: 'Bloqueado', updated_at: '2026-09-21T10:00:00Z' },
    { id: 'direct-2', fornecedor_id: '133', evolusom_request_state: 'created', evolusom_order_id: 63012095, status: 'Bloqueado', updated_at: '2026-09-21T10:01:00Z' },
    { id: 'dslite-old', fornecedor_id: '133', evolusom_request_state: null, evolusom_order_id: null, status: 'Confirmado', updated_at: '2026-09-20T10:00:00Z' },
  ];
  const requests = [];
  const client = {
    from(table) {
      assert.equal(table, 'compras');
      let operation = 'read';
      let update = null;
      let limit = 20;
      const filters = {};
      const query = {
        select() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        not() { return query; },
        is(column, value) { filters[column] = value; return query; },
        order() { return query; },
        limit(value) { limit = value; return query; },
        update(value) { operation = 'update'; update = value; return query; },
        maybeSingle() { return Promise.resolve(run()); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      function run() {
        if (operation === 'read') {
          return {
            data: purchases.filter((row) => row.fornecedor_id === filters.fornecedor_id
              && row.evolusom_request_state === filters.evolusom_request_state
              && row.evolusom_order_id !== null).slice(0, limit),
            error: null,
          };
        }
        const row = purchases.find((item) => item.id === filters.id);
        if (!row || row.evolusom_order_id !== filters.evolusom_order_id || row.status !== filters.status) {
          return { data: null, error: null };
        }
        Object.assign(row, update, { updated_at: new Date().toISOString() });
        return { data: { id: row.id }, error: null };
      }
      return query;
    },
  };
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ status: init.status || 200, body }) } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/lib/sync/domain-lock': { acquireDomainLock: async () => ({ acquired: true, ownerToken: 'test' }), releaseDomainLock: async () => true },
    '@/lib/evolusom/order-status': { readEvolusomMerchantOrderStatus },
    '@/services/evolusom-purchase': { getEvolusomOrderStatus: async (orderId) => {
      requests.push(orderId);
      const status = remoteStatusByOrder[orderId];
      if (status instanceof Error) throw status;
      return { status: 200, data: { pedido_lojista: { numero: orderId, status } } };
    } },
    '@/services/evolusom': { isEvolusomAccessError: (error) => error instanceof EvolusomApiError && [401, 403].includes(error.status) },
  };
  new Function('require', 'module', 'exports', compiled)((name) => mocks[name], module, module.exports);
  return {
    purchases,
    requests,
    run: () => module.exports.POST({ headers: { get: () => 'test-key' }, json: async () => ({ limit: 20 }) }),
  };
}

test('sincroniza só compras diretas, grava mudança e não repete a mudança no ciclo seguinte', async (t) => {
  const previous = { key: process.env.API_SECRET_KEY, enabled: process.env.EVOLUSOM_DIRECT_ENABLED };
  process.env.API_SECRET_KEY = 'test-key';
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous.key === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = previous.key;
    if (previous.enabled === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous.enabled;
  });
  const sync = harness({ 63012091: 'Processando', 63012095: 'Bloqueado' });
  const first = await sync.run();
  assert.equal(first.status, 200);
  assert.equal(first.body.checked, 2);
  assert.equal(first.body.changed, 1);
  assert.deepEqual(sync.requests, [63012091, 63012095]);
  assert.equal(sync.purchases[0].status, 'Processando');
  assert.equal(sync.purchases[2].status, 'Confirmado');
  const second = await sync.run();
  assert.equal(second.body.changed, 0);
});

test('erro de acesso preserva o status local e interrompe o ciclo', async (t) => {
  const previous = { key: process.env.API_SECRET_KEY, enabled: process.env.EVOLUSOM_DIRECT_ENABLED };
  process.env.API_SECRET_KEY = 'test-key';
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous.key === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = previous.key;
    if (previous.enabled === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous.enabled;
  });
  const sync = harness({ 63012091: new EvolusomApiError('negado', 403), 63012095: 'Processando' });
  const result = await sync.run();
  assert.equal(result.status, 401);
  assert.deepEqual(sync.requests, [63012091]);
  assert.equal(sync.purchases[0].status, 'Bloqueado');
});
