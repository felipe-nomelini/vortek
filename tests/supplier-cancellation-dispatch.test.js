const { test } = require('node:test');
const assert = require('node:assert/strict');

const classify = async (history) => {
  const { classifySupplierDispatchHistory } = await import('../src/lib/supplier-cancellation-dispatch.js');
  return classifySupplierDispatchHistory(history, 'SHIP-1');
};
const event = (status, substatus = null) => ({ status, substatus, date: '2026-09-16T10:00:00Z' });

test('etiqueta impressa e cancelamento terminal sem coleta permitem crédito pendente', async () => {
  const result = await classify([event('ready_to_ship', 'printed'), event('cancelled')]);
  assert.equal(result.dispatch, 'not_dispatched');
  assert.equal(result.evidence.proof, 'cancelled_history');
});

test('coleta ou envio comprovados prevalecem sobre cancelamento posterior', async () => {
  for (const entry of [event('ready_to_ship', 'picked_up'), event('ready_to_ship', 'in_hub'), event('shipped')]) {
    const result = await classify([entry, event('cancelled')]);
    assert.equal(result.dispatch, 'dispatched');
  }
});

test('histórico incompleto, inválido ou sem cancelamento não presume ausência de despacho', async () => {
  for (const history of [null, [], [event('ready_to_ship', 'printed')], [{ status: 'cancelled' }]]) {
    assert.equal((await classify(history)).dispatch, 'unknown');
  }
});
