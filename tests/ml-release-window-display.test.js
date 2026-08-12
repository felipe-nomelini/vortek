const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatMlReleaseWindow,
  getMlReleaseComparableDate,
} = require('../src/lib/ml/release-window-display.ts');

test('mantém data civil do Mercado Livre quando janela vem à meia-noite UTC', () => {
  const value = '2026-08-21T00:00:00+00:00';

  assert.equal(formatMlReleaseWindow(value).when, '21/08');
  assert.equal(
    getMlReleaseComparableDate(value)?.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    }),
    '21/08/2026',
  );
});

test('inclui horário local quando Mercado Livre informa hora de liberação', () => {
  assert.equal(
    formatMlReleaseWindow('2026-08-21T15:30:00+00:00').when,
    '21/08 12:30',
  );
});
