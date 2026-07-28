const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canReuseExistingOrderSnapshot,
} = require('../src/lib/order-sync-lock-fallback.ts');

const lockConflict = {
  status: 409,
  data: {
    errors: [{ code: 'domain_lock_conflict' }],
  },
};

test('reutiliza snapshot completo durante conflito do sync geral', () => {
  assert.equal(
    canReuseExistingOrderSnapshot({
      syncResult: lockConflict,
      snapshotIncomplete: false,
      itemCount: 1,
    }),
    true,
  );
});

test('não reutiliza snapshot incompleto ou sem itens', () => {
  assert.equal(
    canReuseExistingOrderSnapshot({
      syncResult: lockConflict,
      snapshotIncomplete: true,
      itemCount: 1,
    }),
    false,
  );
  assert.equal(
    canReuseExistingOrderSnapshot({
      syncResult: lockConflict,
      snapshotIncomplete: false,
      itemCount: 0,
    }),
    false,
  );
});

test('não mascara outros erros HTTP 409', () => {
  assert.equal(
    canReuseExistingOrderSnapshot({
      syncResult: { status: 409, data: { error: 'duplicate' } },
      snapshotIncomplete: false,
      itemCount: 1,
    }),
    false,
  );
});
