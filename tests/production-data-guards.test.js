const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { canUseHomologationFixtures } = require('../src/lib/homologation-fixture.ts');
const {
  parseOrderReconciliationMode,
  shouldDispatchExternalOrderAlerts,
  shouldPersistCalculatedOrderProfit,
} = require('../src/lib/sync/order-reconciliation.ts');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('fixtures só podem ser usadas no runtime local e nunca nos domínios produtivos', () => {
  assert.equal(canUseHomologationFixtures({
    VORTEK_RUNTIME_ENVIRONMENT: 'local_dev',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  }), true);
  assert.equal(canUseHomologationFixtures({
    VORTEK_RUNTIME_ENVIRONMENT: 'production',
    NEXT_PUBLIC_APP_URL: 'https://app.bentevi.shop',
  }), false);
  assert.equal(canUseHomologationFixtures({
    VORTEK_RUNTIME_ENVIRONMENT: 'local_dev',
    NEXT_PUBLIC_APP_URL: 'https://app.bentevi.shop',
  }), false);
  assert.equal(canUseHomologationFixtures({
    VORTEK_RUNTIME_ENVIRONMENT: 'local_dev',
    NEXT_PUBLIC_APP_URL: 'not-a-url',
  }), false);
  assert.equal(canUseHomologationFixtures({}), false);
});

test('todos os loaders de amostra consultam o bloqueio de runtime antes do banco', () => {
  for (const relativePath of [
    'src/lib/products/bnt-d07-visual-review.ts',
    'src/lib/ml/questions-visual-review.ts',
    'src/lib/ml/reputation-visual-review.ts',
    'src/lib/ml/claims-visual-review.ts',
    'src/lib/supplier-credits-visual-review.ts',
  ]) {
    const source = read(relativePath);
    const guardIndex = source.indexOf('if (!canUseHomologationFixtures()) return null;');
    const databaseIndex = source.indexOf('getSyncRuntimeConfigValue(ENABLED_KEY)', guardIndex);
    assert.ok(guardIndex >= 0, `${relativePath} não contém o bloqueio de runtime`);
    assert.ok(databaseIndex > guardIndex, `${relativePath} consulta o banco antes do bloqueio`);
  }
});

test('Compras limita todos os filtros in a lotes de cem identificadores', () => {
  const source = read('src/app/api/compras/route.ts');
  assert.match(source, /SUPABASE_IN_FILTER_CHUNK_SIZE = 100/);
  assert.doesNotMatch(source, /slice\(index, index \+ 500\)/);
  assert.equal((source.match(/index \+= SUPABASE_IN_FILTER_CHUNK_SIZE/g) || []).length, 5);
  assert.equal((source.match(/slice\(index, index \+ SUPABASE_IN_FILTER_CHUNK_SIZE\)/g) || []).length, 5);
});

test('rotas persistidas também removem fixtures das respostas de produção', () => {
  const purchases = read('src/app/api/compras/route.ts');
  const purchaseSummary = read('src/app/api/compras/resumo/route.ts');
  const inventory = read('src/app/api/estoque/route.ts');
  const incomingInvoices = read('src/app/api/notas-fiscais/entradas/route.ts');

  assert.match(purchases, /canUseHomologationFixtures\(\)[\s\S]*filter\(\(item: any\) => item\.is_homologation_fixture !== true\)/);
  assert.match(purchaseSummary, /canUseHomologationFixtures\(\)[\s\S]*!isHomologationFixtureId\(row\.id\)/);
  assert.match(inventory, /includeHomologationFixtures \|\| row\.snapshot_source !== BNT_D05_INVENTORY_FIXTURE_SOURCE/);
  assert.match(incomingInvoices, /canUseHomologationFixtures\(\)[\s\S]*receipt\.snapshot_source !== BNT_D05_INVENTORY_FIXTURE_SOURCE/);
});

test('modo cutover é explícito e desabilita somente alertas externos', () => {
  assert.deepEqual(parseOrderReconciliationMode(undefined), { ok: true, mode: 'standard' });
  assert.deepEqual(parseOrderReconciliationMode('cutover'), { ok: true, mode: 'cutover' });
  assert.deepEqual(parseOrderReconciliationMode('other'), { ok: false, mode: null });
  assert.equal(shouldDispatchExternalOrderAlerts('standard'), true);
  assert.equal(shouldDispatchExternalOrderAlerts('cutover'), false);

  const source = read('src/app/api/sync/pedidos/route.ts');
  assert.match(source, /request\.headers\.get\('x-api-key'\)[\s\S]*parseOrderReconciliationMode/);
  assert.match(source, /code: 'invalid_reconciliation_mode'/);
  assert.match(source, /params\.dispatchExternalAlerts[\s\S]*alertNewSale/);
  assert.match(source, /params\.dispatchExternalAlerts[\s\S]*alertClaimOpened/);
  assert.match(source, /if \(params\.dispatchExternalAlerts\) \{[\s\S]*alertMlLabelReleased/);
});

test('lucro provisório por falta de produto é substituído somente após cálculo completo', () => {
  assert.equal(shouldPersistCalculatedOrderProfit({
    existingProfit: 0,
    existingSnapshotPendencias: ['lucro_pendente_produto'],
    calculatedProfit: 123.45,
    profitPending: false,
  }), true);
  assert.equal(shouldPersistCalculatedOrderProfit({
    existingProfit: 0,
    existingSnapshotPendencias: ['lucro_pendente_produto'],
    calculatedProfit: 123.45,
    profitPending: true,
  }), false);
  assert.equal(shouldPersistCalculatedOrderProfit({
    existingProfit: 87.65,
    existingSnapshotPendencias: [],
    calculatedProfit: 123.45,
    profitPending: false,
  }), false);
  assert.equal(shouldPersistCalculatedOrderProfit({
    existingProfit: null,
    existingSnapshotPendencias: [],
    calculatedProfit: 123.45,
    profitPending: false,
  }), true);
});
