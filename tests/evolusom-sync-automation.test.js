const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getSyncTaskByKey, isSyncTaskEnabled } = require('../src/lib/sync/registry.ts');
const { shouldFinalizeEvolusomCycle } = require('../src/lib/sync/evolusom-cycle.ts');
const { EvolusomApiError, isEvolusomAccessError } = require('../src/services/evolusom.ts');
const { readEvolusomMerchantOrderStatus } = require('../src/lib/evolusom/order-status.ts');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Evolusom possui ciclos exclusivos de catálogo e preço/estoque', () => {
  const catalog = getSyncTaskByKey('sync_evolusom_catalogo');
  const stock = getSyncTaskByKey('sync_evolusom_preco_estoque');

  for (const task of [catalog, stock]) {
    assert.ok(task);
    assert.equal(task.kind, 'evolusom');
    assert.equal(task.usesCursor, true);
    assert.equal(task.runMode, 'inline');
    assert.deepEqual(task.schedule, { businessMinutes: 2, offHoursMinutes: 2 });
    assert.equal(task.defaultBody.source, 'evolusom_direct');
    assert.deepEqual(task.defaultBody.fornecedorIds, ['133']);
    assert.equal(task.defaultBody.pageSize, 100);
    assert.equal(task.defaultBody.maxPagesPerRun, 5);
    assert.equal(isSyncTaskEnabled(task, { EVOLUSOM_DIRECT_ENABLED: 'false' }), false);
    assert.equal(isSyncTaskEnabled(task, { EVOLUSOM_DIRECT_ENABLED: 'true' }), true);
  }
});

test('consulta de pedidos Evolusom usa o agendador existente e cobre todos os horários', () => {
  const task = getSyncTaskByKey('sync_evolusom_pedidos_compra');
  assert.ok(task);
  assert.equal(task.path, '/api/sync/evolusom-pedidos');
  assert.equal(task.domain, 'compras:evolusom');
  assert.equal(task.kind, 'evolusom');
  assert.equal(task.dispatchMode, 'scheduled');
  assert.deepEqual(task.schedule, { businessMinutes: 2, offHoursMinutes: 2 });
  assert.equal(task.defaultBody.limit, 20);
  assert.equal(isSyncTaskEnabled(task, { EVOLUSOM_DIRECT_ENABLED: 'false' }), false);
  assert.equal(isSyncTaskEnabled(task, { EVOLUSOM_DIRECT_ENABLED: 'true' }), true);
});

test('status do pedido do lojista só é aceito com resposta e número correspondentes', () => {
  const response = {
    status: 200,
    data: {
      pedido_lojista: { numero: 63012091, status: 'Processando' },
      pedido_cliente: { numero: 63012092, status: 'Bloqueado' },
    },
  };
  assert.equal(readEvolusomMerchantOrderStatus(response, 63012091), 'Processando');
  for (const invalid of [
    { ...response, status: 500 },
    { ...response, data: { pedido_lojista: { numero: 63012093, status: 'Processando' } } },
    { ...response, data: { pedido_lojista: { numero: 63012091, status: 'Desconhecido' } } },
    { ...response, data: { pedido_lojista: null } },
  ]) {
    assert.throws(() => readEvolusomMerchantOrderStatus(invalid, 63012091));
  }
});

test('fornecedor 133 sai das fontes DSLite e XML quando integração direta está ativa', () => {
  const catalog = read('src/app/api/sync/catalogo/route.ts');
  const stock = read('src/app/api/sync/preco-estoque/route.ts');
  const xml = read('src/app/api/sync/preco-estoque-xml/route.ts');

  assert.match(catalog, /directEvolusomEnabled && id === "133"/);
  assert.match(stock, /directEvolusomEnabled && id === '133'/);
  assert.match(xml, /EVOLUSOM_DIRECT_ENABLED === 'true' && supplierId === '133'/);
  assert.match(catalog, /directEvolusomSync[\s\S]*Evolusom/);
  assert.match(stock, /directEvolusomSync[\s\S]*Evolusom/);
});

test('ciclo direto preserva cursor e só inativa ausentes após varredura estável', () => {
  const route = read('src/app/api/sync/preco-estoque/route.ts');
  const cron = read('src/app/api/sync/cron-dispatch/route.ts');
  const runner = read('src/services/sync-ml-job.ts');

  assert.match(route, /cycleStartedFromPageOne/);
  assert.match(route, /expectedTotal: cycleExpectedTotal/);
  assert.match(route, /cycleTotalStable/);
  assert.match(route, /last_sync_at\.lt\.\$\{cycleStartedAt\}/);
  assert.match(route, /offers_inactivated_missing/);
  assert.match(route, /evolusom_stock_automation/);
  assert.match(cron, /normalizeFornecedorCursor/);
  assert.match(runner, /normalizeFornecedorCursor/);
});

test('limpeza de ausentes exige ciclo completo, estável e sem erros', () => {
  const complete = {
    directSync: true,
    supplierId: '133',
    hasMore: false,
    isLastSupplier: true,
    startedFromPageOne: true,
    totalStable: true,
    expectedTotal: 7416,
    observedTotal: 7416,
    errorCount: 0,
  };
  assert.equal(shouldFinalizeEvolusomCycle(complete), true);
  for (const unsafe of [
    { hasMore: true },
    { startedFromPageOne: false },
    { totalStable: false },
    { observedTotal: 7415 },
    { errorCount: 1 },
  ]) {
    assert.equal(shouldFinalizeEvolusomCycle({ ...complete, ...unsafe }), false);
  }
});

test('negação de acesso da Evolusom encerra o job sem retry contínuo', () => {
  assert.equal(isEvolusomAccessError(new EvolusomApiError('negado', 401)), true);
  assert.equal(isEvolusomAccessError(new EvolusomApiError('negado', 403)), true);
  assert.equal(isEvolusomAccessError(new EvolusomApiError('limite', 429)), false);

  for (const routePath of [
    'src/app/api/sync/catalogo/route.ts',
    'src/app/api/sync/preco-estoque/route.ts',
  ]) {
    const route = read(routePath);
    assert.match(route, /isEvolusomAccessError/);
    assert.match(route, /failure_reason:\s*["']auth_fatal["']/);
    assert.match(route, /auth_state:\s*["']reauth_required["']/);
    assert.match(route, /status:\s*evolusomAccessFailure \? 401 : 500/);
  }
});
