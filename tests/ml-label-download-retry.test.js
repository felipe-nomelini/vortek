const assert = require('node:assert/strict');
const test = require('node:test');

const {
  retryMlLabelDownload,
} = require('../src/lib/ml/label-download-retry.ts');

function retryableFailure() {
  return {
    file: null,
    retryable: true,
    reason: 'not_ready',
    statusCode: 400,
  };
}

test('repete invoice_pending até etiqueta ficar disponível', async () => {
  let clock = 0;
  let calls = 0;
  const retries = [];

  const outcome = await retryMlLabelDownload(
    async () => {
      calls += 1;
      return calls < 3
        ? retryableFailure()
        : { file: Buffer.from('label'), retryable: false };
    },
    {
      intervalMs: 5_000,
      timeoutMs: 60_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      onRetry: ({ attempt }) => retries.push(attempt),
    },
  );

  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.result.file.toString(), 'label');
  assert.equal(outcome.timedOut, false);
  assert.deepEqual(retries, [1, 2]);
});

test('não repete erro definitivo do Mercado Livre', async () => {
  let calls = 0;
  const outcome = await retryMlLabelDownload(
    async () => {
      calls += 1;
      return {
        file: null,
        retryable: false,
        reason: 'http_error',
        statusCode: 400,
      };
    },
    {
      intervalMs: 5_000,
      timeoutMs: 60_000,
    },
  );

  assert.equal(calls, 1);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.timedOut, false);
});

test('encerra erro temporário ao atingir limite', async () => {
  let clock = 0;
  let calls = 0;
  const outcome = await retryMlLabelDownload(
    async () => {
      calls += 1;
      return retryableFailure();
    },
    {
      intervalMs: 5_000,
      timeoutMs: 10_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.timedOut, true);
});
