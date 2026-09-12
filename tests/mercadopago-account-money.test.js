const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deduplicateMercadoPagoMovementRows,
  getMercadoPagoReportFileName,
  getMercadoPagoReportResumeState,
  getMercadoPagoCompletedWindowEnd,
  getNextMercadoPagoWindow,
  isMercadoPagoReportForRange,
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

test('parser aceita o formato histórico configurado na conta brasileira', () => {
  const csv = [
    [
      'SOURCE_ID',
      'PAYMENT_METHOD_TYPE',
      'TRANSACTION_TYPE',
      'TRANSACTION_AMOUNT',
      'TRANSACTION_DATE',
      'FEE_AMOUNT',
      'SETTLEMENT_DATE',
      'REAL_AMOUNT',
      'TAXES_AMOUNT',
      'MONEY_RELEASE_DATE',
      'BUSINESS_UNIT',
      'SUB_UNIT',
    ].join(';'),
    [
      'historical-source-1',
      'account_money',
      'SETTLEMENT',
      '100.00',
      '2026-06-01T12:00:00Z',
      '-12.00',
      '2026-06-01T12:00:00Z',
      '88.00',
      '0.00',
      '2026-06-02T12:00:00Z',
      'mercadolibre',
      'marketplace',
    ].join(';'),
  ].join('\n');

  const row = parseMercadoPagoAccountMoneyCsv(csv, { defaultCurrency: 'BRL' })[0];

  assert.equal(row.amount, 88);
  assert.equal(row.currency, 'BRL');
  assert.equal(row.transactionCurrency, null);
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
  ]);
});

test('movimento financeiro do provedor é preservado quando o tipo vem em branco', () => {
  const row = parseRow([
    'mp-source-without-type',
    'provider-fee',
    '',
    '',
    '0.00',
    'BRL',
    '-175.38',
    'BRL',
    '2026-08-13T22:44:46Z',
  ]);

  assert.equal(row.amount, -175.38);
  assert.equal(row.movementType, null);
  assert.deepEqual(row.validationErrors, []);
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

test('duplicata literal do relatório é ignorada sem consolidar movimentos distintos', () => {
  const settlement = parseRow([
    'mp-source-duplicate',
    'order-duplicate',
    'Pagamento',
    'SETTLEMENT',
    '100.00',
    'BRL',
    '88.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);
  const literalDuplicate = parseRow([
    'mp-source-duplicate',
    'order-duplicate',
    'Pagamento',
    'SETTLEMENT',
    '100.00',
    'BRL',
    '88.00',
    'BRL',
    '2026-08-30T12:00:00Z',
  ]);
  const distinctMovement = parseRow([
    'mp-source-duplicate',
    'order-duplicate',
    'Estorno',
    'REFUND',
    '-100.00',
    'BRL',
    '-88.00',
    'BRL',
    '2026-08-31T12:00:00Z',
  ]);

  const result = deduplicateMercadoPagoMovementRows([
    settlement,
    literalDuplicate,
    distinctMovement,
  ]);

  assert.equal(result.rows.length, 2);
  assert.equal(result.ignoredExactDuplicates, 1);
  assert.equal(result.conflictingDuplicates, 0);
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

test('retomada avança janelas com sobreposição sem depender da data dos movimentos', () => {
  const next = getNextMercadoPagoWindow({
    currentEndDate: '2026-06-08T00:00:00.000Z',
    targetEndDate: '2026-06-30T00:00:00.000Z',
    windowDays: 7,
    overlapDays: 1,
  });
  assert.deepEqual(next, {
    beginDate: '2026-06-07T00:00:00.000Z',
    endDate: '2026-06-14T00:00:00.000Z',
  });
  assert.equal(getNextMercadoPagoWindow({ currentEndDate: '2026-06-30T00:00:00.000Z', targetEndDate: '2026-06-30T00:00:00.000Z' }), null);
});

test('reconhece o intervalo normalizado pelo fechamento diário do Mercado Pago', () => {
  assert.equal(isMercadoPagoReportForRange({
    begin_date: '2026-06-05T03:00:00Z',
    end_date: '2026-06-13T02:59:59Z',
  }, '2026-06-06T02:02:00.000Z', '2026-06-13T02:02:00.000Z'), true);
  assert.equal(isMercadoPagoReportForRange({
    begin_date: '2026-06-01T03:00:00Z',
    end_date: '2026-06-13T02:59:59Z',
  }, '2026-06-06T02:02:00.000Z', '2026-06-13T02:02:00.000Z'), false);
});

test('checkpoint considera somente janela concluída', () => {
  const log = [
    { lifecycle: { state: 'processing', endDate: '2026-06-08T00:00:00.000Z' } },
    { lifecycle: { state: 'complete', endDate: '2026-06-15T00:00:00.000Z' } },
  ];
  assert.equal(getMercadoPagoCompletedWindowEnd(log), '2026-06-15T00:00:00.000Z');
});

test('retomada reconhece a próxima janela sem reutilizar a tarefa processada', () => {
  assert.deepEqual(getMercadoPagoReportResumeState([{ lifecycle: {
    state: 'next_window',
    beginDate: '2026-06-07T00:00:00.000Z',
    endDate: '2026-06-14T00:00:00.000Z',
    targetEndDate: '2026-06-30T00:00:00.000Z',
  } }]), {
    taskId: null,
    beginDate: '2026-06-07T00:00:00.000Z',
    endDate: '2026-06-14T00:00:00.000Z',
    targetEndDate: '2026-06-30T00:00:00.000Z',
  });
});
