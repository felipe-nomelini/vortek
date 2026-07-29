const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyMlLabelHttpFailure,
} = require('../src/lib/ml/label-http-failure.ts');

test('não repete etiqueta de shipment já entregue', () => {
  const failure = classifyMlLabelHttpFailure(400, JSON.stringify({
    failed_shipments: [{
      shipment_id: '47282222515',
      message: 'Shipment 47282222515 status is delivered',
      error_code: 'SHPLAB0200',
      retry: false,
      cause: 'NOT_PRINTABLE_STATUS',
    }],
  }));

  assert.equal(failure.delivered, true);
  assert.equal(failure.retryable, false);
  assert.equal(failure.reason, 'http_error');
});

test('mantém retry para invoice_pending explicitamente temporário', () => {
  const failure = classifyMlLabelHttpFailure(400, JSON.stringify({
    failed_shipments: [{
      message: 'Shipment invoice_pending',
      error_code: 'SHPLAB0200',
      retry: true,
      cause: 'NOT_PRINTABLE_STATUS',
    }],
  }));

  assert.equal(failure.delivered, false);
  assert.equal(failure.retryable, true);
  assert.equal(failure.reason, 'not_ready');
});

test('respeita retry false mesmo em status HTTP normalmente temporário', () => {
  const failure = classifyMlLabelHttpFailure(500, JSON.stringify({
    failed_shipments: [{
      message: 'Permanent shipment failure',
      retry: false,
    }],
  }));

  assert.equal(failure.retryable, false);
  assert.equal(failure.reason, 'http_error');
});
