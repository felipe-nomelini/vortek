const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getMercadoPagoReportFileName,
  getMercadoPagoReportResumeState,
  isMercadoPagoReportReady,
  parseMercadoPagoAccountMoneyCsv,
  resolveMercadoPagoReportTaskId,
} = require('../src/lib/mercadopago-account-money.ts');

test('relatório aceita o contrato oficial e o formato observado na conta TEST', () => {
  assert.equal(isMercadoPagoReportReady('processed'), true);
  assert.equal(isMercadoPagoReportReady('available'), true);
  assert.equal(isMercadoPagoReportReady('processing'), false);
  assert.equal(getMercadoPagoReportFileName({
    file_name: 'official.csv',
    files: [{ type: 'csv', name: 'fallback.csv' }],
  }), 'official.csv');
  assert.equal(getMercadoPagoReportFileName({
    files: [
      { type: 'json', name: 'report.json' },
      { type: 'CSV', name: 'report.csv' },
    ],
  }), 'report.csv');
});

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

test('parser usa os campos oficiais e o valor líquido em vez do bruto', () => {
  const row = parseRow([
    'mp-source-1',
    'supplier-1',
    'Pagamento de fornecedor',
    'PAYOUT',
    '-1250.00',
    'BRL',
    '-1200.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);

  assert.equal(row.raw.source_id, 'mp-source-1');
  assert.match(row.externalId, /^[a-f0-9]{64}$/);
  assert.equal(row.transactionAmount, -1250);
  assert.equal(row.amount, -1200);
  assert.equal(row.movementType, 'PAYOUT');
  assert.equal(row.currency, 'BRL');
  assert.deepEqual(row.validationErrors, []);
});

test('linha sem campos financeiros oficiais é rejeitada para importação', () => {
  const csv = [
    'EXTERNAL_REFERENCE,DESCRIPTION,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY',
    'supplier-3,Pagamento de fornecedor,-1200.00,BRL',
  ].join('\n');
  const row = parseMercadoPagoAccountMoneyCsv(csv)[0];

  assert.deepEqual(row.validationErrors.sort(), [
    'invalid_settlement_net_amount',
    'missing_settlement_currency',
    'missing_source_id',
    'missing_transaction_type',
  ]);
});

test('parser mantém identidade estável para reimportação idempotente', () => {
  const values = [
    'mp-source-4',
    'supplier-4',
    'Pagamento de fornecedor',
    'WITHDRAWAL',
    '-1500.00',
    'BRL',
    '-1500.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ];

  assert.equal(parseRow(values).externalId, parseRow(values).externalId);
});

test('movimentos financeiros distintos da mesma transação não são consolidados', () => {
  const settlement = parseRow([
    'mp-source-5',
    'order-5',
    'Pagamento',
    'SETTLEMENT',
    '1500.00',
    'BRL',
    '1350.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);
  const dispute = parseRow([
    'mp-source-5',
    'order-5',
    'Contestação',
    'DISPUTE',
    '-1500.00',
    'BRL',
    '-1350.00',
    'BRL',
    '2026-08-31T12:00:00Z',
  ]);

  assert.notEqual(settlement.externalId, dispute.externalId);
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
