const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const registry = require('../src/lib/sync/registry.ts');

function loadDispatchRequestModule() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/lib/sync/dispatch-request.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === './registry') return registry;
    throw new Error(`Dependência inesperada no contrato puro de dispatch: ${specifier}`);
  };
  new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const dispatchRequest = loadDispatchRequestModule();
const runRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/app/api/sync/run/route.ts'),
  'utf8',
);
const manualRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/app/api/sync/disparar/route.ts'),
  'utf8',
);
const dispatchServiceSource = fs.readFileSync(
  path.join(__dirname, '../src/services/sync-dispatch.ts'),
  'utf8',
);

test('resolve tasks diretas, legadas e todos sem duplicar chaves', () => {
  assert.deepEqual(dispatchRequest.resolveSyncTaskKeys({
    taskKeys: ['sync_ml_orders_ingest', 'inválida', 'sync_ml_orders_ingest'],
  }), ['sync_ml_orders_ingest']);
  assert.deepEqual(dispatchRequest.resolveSyncTaskKeys({ tipo: 'pedidos' }), ['sync_ml_orders_ingest']);
  assert.deepEqual(
    dispatchRequest.resolveSyncTaskKeys({ tipo: 'todos' }),
    registry.SYNC_TASKS.filter((task) => task.schedule).map((task) => task.key),
  );
  assert.deepEqual(dispatchRequest.resolveSyncTaskKeys({ taskKey: 'inválida' }), []);
  assert.deepEqual(dispatchRequest.resolveSyncTaskKeys({ taskKeys: ['inválida'] }), []);
  assert.deepEqual(dispatchRequest.resolveSyncTaskKeys({ tipo: 'inválida' }), []);
});

test('monta query com limites e ignora valores genéricos não escalares', () => {
  assert.deepEqual(dispatchRequest.buildSyncTaskQuery('sync_reconcile_fiscal', {
    query: { keep: true, ignore: { nested: true } },
    limit: 900,
    mlOrderId: ' 123 ',
    pedidoId: ' pedido-1 ',
  }), {
    keep: true,
    limit: 500,
    mlOrderId: '123',
    pedidoId: 'pedido-1',
  });
  assert.deepEqual(dispatchRequest.buildSyncTaskQuery('sync_pack_id_backfill', { limit: 999 }), { limit: 200 });
});

test('publish ML compartilha limit, seed e outboxId nas duas fronteiras', () => {
  const task = registry.getSyncTaskByKey('sync_ml_listings_publish');
  assert.ok(task);
  assert.deepEqual(dispatchRequest.buildSyncTaskBody(task, {
    limit: 99,
    seedFromProducts: true,
    outboxId: ' outbox-1 ',
  }), {
    limit: 20,
    seedFromProducts: true,
    outboxId: 'outbox-1',
  });
});

test('rotas mantêm autenticação e origem próprias e delegam o lifecycle', () => {
  assert.match(runRouteSource, /request\.headers\.get\('x-api-key'\)/);
  assert.match(runRouteSource, /kind: 'system', source: 'api\/sync\/run'/);
  assert.match(manualRouteSource, /supabase\.auth\.getUser\(\)/);
  assert.match(manualRouteSource, /kind: 'manual_ui'/);
  assert.match(manualRouteSource, /actorUserId: user\.id/);

  for (const source of [runRouteSource, manualRouteSource]) {
    assert.match(source, /dispatchSyncTasks\(/);
    assert.doesNotMatch(source, /\.from\('jobs'\)/);
    assert.doesNotMatch(source, /runMlSingleStageJob/);
    assert.doesNotMatch(source, /setTimeout/);
  }
});

test('serviço único usa after e diferencia auditoria de sistema, realtime e UI', () => {
  assert.match(dispatchServiceSource, /import \{ after \} from 'next\/server'/);
  assert.match(dispatchServiceSource, /after\(async \(\) =>/);
  assert.match(dispatchServiceSource, /'manual_dispatch'/);
  assert.match(dispatchServiceSource, /'realtime_dispatch'/);
  assert.match(dispatchServiceSource, /'system_dispatch'/);
  assert.match(dispatchServiceSource, /if \(Boolean\(payload\.seedFromProducts\)\) return \{ pending: true \}/);
  assert.doesNotMatch(dispatchServiceSource, /setTimeout/);
});
