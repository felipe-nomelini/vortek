const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractMlFiscalReleaseWindow,
  isMlShipmentLabelPrintable,
} = require('../src/lib/ml/fiscal-release.ts');

function futureBufferingDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

test('mantém janela futura quando shipment ainda está buffered', () => {
  const release = extractMlFiscalReleaseWindow({
    shipment: { status: 'pending', substatus: 'buffered' },
    leadTime: { buffering: { date: futureBufferingDate() } },
  });

  assert.equal(release.isBlockedNow, true);
  assert.ok(release.releaseAt);
});

test('ready_to_print prevalece sobre buffering.date futuro', () => {
  const release = extractMlFiscalReleaseWindow({
    shipment: { status: 'ready_to_ship', substatus: 'ready_to_print' },
    leadTime: { buffering: { date: futureBufferingDate() } },
  });

  assert.equal(isMlShipmentLabelPrintable({
    status: 'ready_to_ship',
    substatus: 'ready_to_print',
  }), true);
  assert.equal(release.isBlockedNow, false);
  assert.equal(release.releaseAt, null);
  assert.equal(release.sourcePath, 'shipment.status/substatus');
});

test('printed permite reimpressão mesmo com buffering.date futuro', () => {
  const release = extractMlFiscalReleaseWindow({
    shipment: { status: 'ready_to_ship', substatus: 'printed' },
    leadTime: { buffering: { date: futureBufferingDate() } },
  });

  assert.equal(release.isBlockedNow, false);
  assert.equal(release.releaseAt, null);
});

test('invoice_pending não é tratado como etiqueta disponível', () => {
  const release = extractMlFiscalReleaseWindow({
    shipment: { status: 'ready_to_ship', substatus: 'invoice_pending' },
    leadTime: { buffering: { date: futureBufferingDate() } },
  });

  assert.equal(isMlShipmentLabelPrintable({
    status: 'ready_to_ship',
    substatus: 'invoice_pending',
  }), false);
  assert.equal(release.isBlockedNow, true);
  assert.ok(release.releaseAt);
});
