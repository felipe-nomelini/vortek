const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ML_OBSERVED_BATCH_SIZE,
  ML_OBSERVED_CYCLE_DEDUPE_KEY,
  ML_OBSERVED_MANIFEST_EVENT,
  ML_OBSERVED_MAX_FAILURES,
  calculateMlObservedProgress,
  hasCompletedMlObservedManifest,
  isMlObservedItemFailureTerminal,
  normalizeMlObservedItemIds,
  resolveMlObservedScrollId,
} = require('../src/lib/ml/observed-scan-batch.ts');

test('ciclo observado usa lotes retomáveis de cem itens e três tentativas', () => {
  assert.equal(ML_OBSERVED_BATCH_SIZE, 100);
  assert.equal(ML_OBSERVED_MAX_FAILURES, 3);
  assert.equal(ML_OBSERVED_CYCLE_DEDUPE_KEY, 'ml_listings_observed_full_cycle');
});

test('manifesto normaliza IDs sem duplicar ou persistir cursor de scan', () => {
  assert.deepEqual(
    normalizeMlObservedItemIds(['MLB1', ' MLB2 ', 'MLB1', '', null]),
    ['MLB1', 'MLB2'],
  );
  assert.equal(JSON.stringify(normalizeMlObservedItemIds(['MLB1'])).includes('scroll'), false);
});

test('somente o marcador completo permite retomar sem novo scan', () => {
  assert.equal(hasCompletedMlObservedManifest([]), false);
  assert.equal(hasCompletedMlObservedManifest([{ event_type: 'ml_observed_scan_started' }]), false);
  assert.equal(hasCompletedMlObservedManifest([{ event_type: ML_OBSERVED_MANIFEST_EVENT, total: 250 }]), true);
});

test('todas as páginas do scan reutilizam o cursor retornado na primeira página', () => {
  const first = resolveMlObservedScrollId(null, 'scroll-inicial');
  const second = resolveMlObservedScrollId(first, 'scroll-diferente');

  assert.equal(first, 'scroll-inicial');
  assert.equal(second, 'scroll-inicial');
});

test('item individual só encerra com erro na terceira tentativa', () => {
  assert.equal(isMlObservedItemFailureTerminal(1), false);
  assert.equal(isMlObservedItemFailureTerminal(2), false);
  assert.equal(isMlObservedItemFailureTerminal(3), true);
});

test('progresso cobre todos os lotes e termina em cem', () => {
  assert.equal(calculateMlObservedProgress(0, 250), 10);
  assert.equal(calculateMlObservedProgress(100, 250), 46);
  assert.equal(calculateMlObservedProgress(200, 250), 82);
  assert.equal(calculateMlObservedProgress(250, 250), 100);
});
