const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MANUAL_SUPPLIER_LEDGER_ACTIONS,
  SUPPLIER_LEDGER_MOVEMENT_TYPES,
  isSupplierLedgerMovementType,
  requireSupplierLedgerMovementType,
  resolveManualSupplierLedgerAction,
} = require('../src/lib/supplier-ledger.ts');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('representa exatamente os tipos persistidos aceitos pelo ledger', () => {
  assert.deepEqual(SUPPLIER_LEDGER_MOVEMENT_TYPES, [
    'topup',
    'purchase_debit',
    'adjustment',
    'manual_credit',
    'cancellation_credit',
    'credit_usage',
  ]);

  for (const movementType of SUPPLIER_LEDGER_MOVEMENT_TYPES) {
    assert.equal(isSupplierLedgerMovementType(movementType), true);
    assert.equal(requireSupplierLedgerMovementType(movementType), movementType);
  }
  assert.equal(isSupplierLedgerMovementType('adjustment_credit'), false);
  assert.throws(() => requireSupplierLedgerMovementType('unknown'));
});

test('converte ações manuais em tipo persistido e sinal sem aliases no banco', () => {
  assert.deepEqual(MANUAL_SUPPLIER_LEDGER_ACTIONS, [
    'manual_credit',
    'credit_usage',
    'adjustment_credit',
    'adjustment_debit',
  ]);
  assert.deepEqual(resolveManualSupplierLedgerAction('manual_credit'), {
    movementType: 'manual_credit',
    amountSign: 1,
  });
  assert.deepEqual(resolveManualSupplierLedgerAction('credit_usage'), {
    movementType: 'credit_usage',
    amountSign: -1,
  });
  assert.deepEqual(resolveManualSupplierLedgerAction('adjustment_credit'), {
    movementType: 'adjustment',
    amountSign: 1,
  });
  assert.deepEqual(resolveManualSupplierLedgerAction('adjustment_debit'), {
    movementType: 'adjustment',
    amountSign: -1,
  });
  assert.throws(() => resolveManualSupplierLedgerAction('unknown'));
});

test('mantém movimentos da conta-saldo aposentada somente como histórico', () => {
  const balanceSource = read('src/lib/supplier-balance.ts');
  const creditsPage = read('src/app/(app)/fornecedores/creditos/page.tsx');

  assert.doesNotMatch(balanceSource, /recordSupplierPurchaseDebit|movement_type: 'purchase_debit'/);
  assert.match(creditsPage, /topup: 'Crédito da antiga conta-saldo'/);
  assert.match(creditsPage, /purchase_debit: 'Débito de compra da antiga conta-saldo'/);
  assert.match(creditsPage, /Aposentado · somente leitura/);
});

test('remove o cast e a conversão implícita do fluxo afetado', () => {
  const creditsSource = read('src/lib/supplier-credits.ts');
  const creditsRoute = read('src/app/api/fornecedores/creditos/route.ts');

  assert.doesNotMatch(creditsSource, /filter\(Boolean\) as/);
  assert.doesNotMatch(creditsRoute, /startsWith\('adjustment'\)/);
  assert.match(creditsRoute, /resolveManualSupplierLedgerAction/);
  assert.match(creditsRoute, /requireSupplierLedgerMovementType/);
});
