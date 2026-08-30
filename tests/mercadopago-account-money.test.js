const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getMercadoPagoReportResumeState,
  isHayamaxTopupCandidate,
  isReviewRequiredCandidate,
  parseMercadoPagoAccountMoneyCsv,
  resolveMercadoPagoReportTaskId,
} = require('../src/lib/mercadopago-account-money.ts');

const headers = [
  'SOURCE_ID',
  'EXTERNAL_REFERENCE',
  'DESCRIPTION',
  'TRANSACTION_TYPE',
  'TRANSACTION_AMOUNT',
  'TRANSACTION_CURRENCY',
  'SETTLEMENT_NET_AMOUNT',
  'SETTLEMENT_CURRENCY',
  'SETTLEMENT_DATE',
].join(',');

function parseRow(values) {
  return parseMercadoPagoAccountMoneyCsv(`${headers}\n${values.join(',')}\n`)[0];
}

test('parser usa SOURCE_ID e valor líquido oficial em vez do bruto', () => {
  const row = parseRow([
    'mp-source-1',
    'hayamax-1',
    'Pagamento Hayamax',
    'PAYOUT',
    '-1250.00',
    'BRL',
    '-1200.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);

  assert.equal(row.externalId, 'mp-source-1');
  assert.equal(row.transactionAmount, -1250);
  assert.equal(row.amount, -1200);
  assert.equal(row.movementType, 'PAYOUT');
  assert.equal(row.currency, 'BRL');
  assert.deepEqual(row.validationErrors, []);
});

test('crédito automático exige saída oficial, BRL, líquido negativo e Hayamax', () => {
  const eligible = parseRow([
    'mp-source-2',
    'hayamax-2',
    'PIX HAYAMAX',
    'PAYOUT',
    '-1200.00',
    'BRL',
    '-1200.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);
  const settlement = { ...eligible, movementType: 'SETTLEMENT' };
  const foreignCurrency = { ...eligible, currency: 'USD' };
  const incoming = { ...eligible, amount: 1200 };

  assert.equal(isHayamaxTopupCandidate(eligible, ['hayamax'], 1000), true);
  assert.equal(isHayamaxTopupCandidate(settlement, ['hayamax'], 1000), false);
  assert.equal(isHayamaxTopupCandidate(foreignCurrency, ['hayamax'], 1000), false);
  assert.equal(isHayamaxTopupCandidate(incoming, ['hayamax'], 1000), false);
  assert.equal(isReviewRequiredCandidate(settlement, 1000), true);
});

test('linha sem campos financeiros oficiais é rejeitada para crédito', () => {
  const csv = [
    'EXTERNAL_REFERENCE,DESCRIPTION,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY',
    'hayamax-3,Pagamento Hayamax,-1200.00,BRL',
  ].join('\n');
  const row = parseMercadoPagoAccountMoneyCsv(csv)[0];

  assert.deepEqual(row.validationErrors.sort(), [
    'invalid_settlement_net_amount',
    'missing_settlement_currency',
    'missing_source_id',
    'missing_transaction_type',
  ]);
  assert.equal(isHayamaxTopupCandidate(row, ['hayamax'], 1000), false);
  assert.equal(isReviewRequiredCandidate(row, 1000), false);
});

test('parser mantém identidade estável para reimportação idempotente', () => {
  const values = [
    'mp-source-4',
    'hayamax-4',
    'Pagamento Hayamax',
    'WITHDRAWAL',
    '-1500.00',
    'BRL',
    '-1500.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ];

  assert.equal(parseRow(values).externalId, parseRow(values).externalId);
});

test('retomada recupera a mesma task e o intervalo congelado do log', () => {
  const log = [
    { event_type: 'cron_dispatch' },
    {
      mode: 'report_requested',
      task: { id: 99336983670, status: 'pending' },
      lifecycle: {
        state: 'requested',
        taskId: '99336983670',
        beginDate: '2026-08-23T12:00:00.000Z',
        endDate: '2026-08-30T12:00:00.000Z',
      },
    },
    { event_type: 'job_deferred' },
  ];

  assert.deepEqual(getMercadoPagoReportResumeState(log), {
    taskId: '99336983670',
    beginDate: '2026-08-23T12:00:00.000Z',
    endDate: '2026-08-30T12:00:00.000Z',
  });
});

test('retomada preserva o taskId inteiro quando o status TEST devolve UUID interno', () => {
  const log = [
    {
      mode: 'report_requested',
      lifecycle: {
        state: 'requested',
        taskId: '102982627',
        beginDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-08-08T00:00:00.000Z',
      },
    },
    {
      mode: 'report_processing',
      task: { id: 'ab9f818d-8208-4d61-a4b0-7565eafd24d9', status: 'pending' },
      lifecycle: {
        state: 'processing',
        taskId: 'ab9f818d-8208-4d61-a4b0-7565eafd24d9',
        beginDate: '2026-08-01T00:00:00.000Z',
        endDate: '2026-08-08T00:00:00.000Z',
      },
    },
  ];

  assert.equal(
    resolveMercadoPagoReportTaskId('102982627', 'ab9f818d-8208-4d61-a4b0-7565eafd24d9'),
    '102982627',
  );
  assert.deepEqual(getMercadoPagoReportResumeState(log), {
    taskId: '102982627',
    beginDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-08T00:00:00.000Z',
  });
});
