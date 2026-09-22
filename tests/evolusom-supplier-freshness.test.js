const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/lib/sync/supplier-freshness.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRef = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) => name === './registry' ? require('../src/lib/sync/registry.ts') : null,
  moduleRef,
  moduleRef.exports,
);
const { resolveSupplierSync, applySupplierSyncView } = moduleRef.exports;

const nowMs = Date.parse('2026-09-22T12:00:00Z');

test('Evolusom usa o job mais antigo entre catálogo e preço/estoque para indicar saúde', () => {
  const sync = resolveSupplierSync({
    supplierId: '133',
    dsliteLastSyncAt: '2026-09-21T12:00:00Z',
    evolusomTimes: {
      catalogAt: '2026-09-22T11:56:00Z',
      priceStockAt: '2026-09-22T11:58:00Z',
    },
    dsliteIntervalMinutes: 30,
    evolusomIntervalMinutes: 2,
    nowMs,
  });
  assert.deepEqual(sync, {
    lastSyncAt: '2026-09-22T11:56:00Z',
    source: 'evolusom',
    health: 'healthy',
  });
});

test('Evolusom sem um dos dois jobs concluídos exige atenção e não usa data antiga da DSLite', () => {
  const sync = resolveSupplierSync({
    supplierId: '133',
    dsliteLastSyncAt: '2026-09-22T11:59:00Z',
    evolusomTimes: { catalogAt: '2026-09-22T11:58:00Z', priceStockAt: null },
    dsliteIntervalMinutes: 30,
    evolusomIntervalMinutes: 2,
    nowMs,
  });
  assert.deepEqual(sync, { lastSyncAt: null, source: 'evolusom', health: 'attention' });
});

test('outros fornecedores preservam o tempo da DSLite e filtros/ordem usam tempo efetivo', () => {
  const dslite = resolveSupplierSync({
    supplierId: '108',
    dsliteLastSyncAt: '2026-09-22T11:45:00Z',
    evolusomTimes: { catalogAt: '2026-09-22T11:59:00Z', priceStockAt: '2026-09-22T11:59:00Z' },
    dsliteIntervalMinutes: 30,
    evolusomIntervalMinutes: 2,
    nowMs,
  });
  assert.deepEqual(dslite, { lastSyncAt: '2026-09-22T11:45:00Z', source: 'dslite', health: 'healthy' });

  const rows = [
    { id: 'stale', sync_last_at: '2026-09-22T10:00:00Z', sync_health: 'attention' },
    { id: 'dslite', sync_last_at: dslite.lastSyncAt, sync_health: dslite.health },
    { id: 'evolusom', sync_last_at: '2026-09-22T11:58:00Z', sync_health: 'healthy' },
  ];
  assert.deepEqual(
    applySupplierSyncView(rows, 'healthy', 'dslite_ultima_sync', 'desc').map((row) => row.id),
    ['evolusom', 'dslite'],
  );
  assert.deepEqual(
    applySupplierSyncView(rows, 'attention', 'dslite_ultima_sync', 'asc').map((row) => row.id),
    ['stale'],
  );
});
