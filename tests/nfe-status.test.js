const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isBrasilNfeAutomaticReconciliationEligible,
  isNfeAuthorizedStatus,
  isNfeCancelledStatus,
  isNfeCancelRejectedDeadlineStatus,
  isNfeFinalPersistedStatus,
  mapBrasilNfeSearchStatusToPersistedStatus,
  nfePersistedStatusesForTechnicalStatus,
  normalizeNfePersistedStatus,
  normalizeNfeTechnicalStatus,
  resolveReconciledNfePersistedStatus,
} = require('../src/lib/fiscal/nfe-status.ts');

test('normaliza aliases antigos para o status fiscal persistido canônico', () => {
  assert.equal(normalizeNfePersistedStatus('autorizada'), 'authorized');
  assert.equal(normalizeNfePersistedStatus('cancelada'), 'cancelled');
  assert.equal(normalizeNfePersistedStatus('canceled'), 'cancelled');
  assert.equal(normalizeNfePersistedStatus('pendente'), 'pending');
  assert.equal(normalizeNfePersistedStatus('interrompida'), 'interrupted');
  assert.equal(normalizeNfePersistedStatus('rejeitada'), 'rejected');
  assert.equal(normalizeNfePersistedStatus('denegada'), 'denied');
  assert.equal(normalizeNfePersistedStatus('processando'), 'processing');
  assert.equal(normalizeNfePersistedStatus('outro'), 'other');
  assert.equal(normalizeNfePersistedStatus(null), null);
  assert.equal(normalizeNfePersistedStatus('status-desconhecido'), 'other');
});

test('preserva os marcadores operacionais antes da tradução técnica', () => {
  assert.equal(
    normalizeNfePersistedStatus('cancel_rejected_deadline'),
    'cancel_rejected_deadline',
  );
  assert.equal(normalizeNfeTechnicalStatus('cancel_rejected_deadline'), 'autorizada');
  assert.equal(normalizeNfeTechnicalStatus('not_found'), 'outro');
  assert.equal(isNfeAuthorizedStatus('cancel_rejected_deadline'), true);
  assert.equal(isNfeCancelRejectedDeadlineStatus('cancel_rejected_deadline'), true);
  assert.equal(isNfeCancelledStatus('cancel_rejected_deadline'), false);
  assert.equal(isNfeFinalPersistedStatus('cancel_rejected_deadline'), true);
});

test('converte o status bruto documentado da Brasil NFe sem perder denegação', () => {
  assert.equal(mapBrasilNfeSearchStatusToPersistedStatus(1), 'authorized');
  assert.equal(mapBrasilNfeSearchStatusToPersistedStatus(2), 'cancelled');
  assert.equal(mapBrasilNfeSearchStatusToPersistedStatus(3), 'denied');
  assert.equal(mapBrasilNfeSearchStatusToPersistedStatus(4), null);
});

test('mantém tradução técnica e filtros separados da persistência', () => {
  assert.equal(normalizeNfeTechnicalStatus('authorized'), 'autorizada');
  assert.equal(normalizeNfeTechnicalStatus('cancelled'), 'cancelada');
  assert.equal(normalizeNfeTechnicalStatus('denied'), 'rejeitada');
  assert.equal(normalizeNfeTechnicalStatus(null), 'pendente');
  assert.deepEqual(
    nfePersistedStatusesForTechnicalStatus('autorizada'),
    ['authorized', 'cancel_rejected_deadline'],
  );
  assert.deepEqual(
    nfePersistedStatusesForTechnicalStatus('rejeitada'),
    ['rejected', 'denied'],
  );
  assert.deepEqual(
    nfePersistedStatusesForTechnicalStatus('outro'),
    ['not_found', 'other'],
  );
});

test('classifica somente estados fiscais finais como protegidos pela reconciliação', () => {
  for (const openStatus of ['pending', 'not_found', 'processing', 'other', null]) {
    assert.equal(isNfeFinalPersistedStatus(openStatus), false);
  }
  for (const finalStatus of [
    'cancelled',
    'rejected',
    'denied',
    'cancel_rejected_deadline',
  ]) {
    assert.equal(isNfeFinalPersistedStatus(finalStatus), true);
  }
});

test('reconciliação preserva a rejeição terminal de cancelamento', () => {
  assert.equal(
    resolveReconciledNfePersistedStatus('cancel_rejected_deadline', 'authorized'),
    'cancel_rejected_deadline',
  );
  assert.equal(
    resolveReconciledNfePersistedStatus('cancel_rejected_deadline', 'other'),
    'cancel_rejected_deadline',
  );
  assert.equal(
    resolveReconciledNfePersistedStatus('cancel_rejected_deadline', 'cancelled'),
    'cancelled',
  );
  assert.equal(resolveReconciledNfePersistedStatus('not_found', 'authorized'), 'authorized');
});

test('not_found continua sendo o único bloqueio automático da FIS-03', () => {
  assert.equal(isBrasilNfeAutomaticReconciliationEligible('not_found'), false);
  assert.equal(isBrasilNfeAutomaticReconciliationEligible('other'), true);
  assert.equal(isBrasilNfeAutomaticReconciliationEligible(null), true);
});

test('consumidores gravam e consultam apenas status persistidos canônicos', () => {
  const read = (relativePath) => fs.readFileSync(
    path.resolve(__dirname, '..', relativePath),
    'utf8',
  );
  const manualCancellation = read('src/app/api/notas-fiscais/[id]/cancelar/route.ts');
  const automaticCancellation = read('src/app/api/sync/pedidos/cancelamentos-pos-nfe/route.ts');
  const invoiceRoute = read('src/app/api/notas-fiscais/route.ts');
  const ensureInvoice = read('src/lib/fiscal/ensure-brasilnfe-invoice.ts');
  const localReconciliation = read('src/lib/fiscal/nfe-local-reconciliation.ts');
  const legacyReconciliationScript = read('scripts/reconcile-nf-status.js');
  const legacyBackfillScript = read('scripts/backfill-nfe-status.js');

  assert.match(manualCancellation, /nfe_status: "cancelled"/);
  assert.doesNotMatch(manualCancellation, /nfe_status: "cancelada"/);
  assert.match(manualCancellation, /isNfeCancelRejectedDeadlineStatus/);
  assert.match(automaticCancellation, /isNfeCancelledStatus/);
  assert.doesNotMatch(automaticCancellation, /function normalizeNfeStatus/);
  assert.match(invoiceRoute, /nfePersistedStatusesForTechnicalStatus/);
  assert.doesNotMatch(invoiceRoute, /nfe_status\.eq\.autorizada/);
  assert.match(ensureInvoice, /status_externo: found\.nota\.status/);
  assert.match(ensureInvoice, /status_persistido: persistedStatus/);
  assert.doesNotMatch(ensureInvoice, /function normalizeLocalNfeStatus/);
  assert.match(localReconciliation, /isNfeFinalPersistedStatus/);
  assert.doesNotMatch(localReconciliation, /function isFinalExternalStatus/);
  assert.match(legacyReconciliationScript, /normalizeNfePersistedStatus/);
  assert.match(legacyReconciliationScript, /nfe_status: 'pending'/);
  assert.doesNotMatch(legacyReconciliationScript, /function normalizeNfeStatus/);
  assert.match(legacyBackfillScript, /normalizeNfePersistedStatus/);
  assert.doesNotMatch(legacyBackfillScript, /function normalizeNfeStatus/);
});
