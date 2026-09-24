const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const communicationId = '00000000-0000-4000-8000-000000000021';
const jobId = '00000000-0000-4000-8000-000000000022';

function fakeDb() {
  const tables = {
    jobs: [{ id: jobId, tipo: 'supplier_settlement_communication', status: 'pendente',
      dedupe_key: `supplier_settlement_communication:${communicationId}`, log: [], total: 1 }],
    supplier_settlement_communications: [{ id: communicationId, status: 'approved', contact_phone: '11999999999',
      body: 'Mensagem aprovada', attempts: 0, message_id: null }],
    supplier_settlement_communication_members: [],
  };
  const client = {
    rpc: async (_, args) => {
      const job = tables.jobs.find((row) => row.tipo === args.p_type && row.status === 'pendente');
      if (!job) return { data: null, error: null };
      job.status = 'rodando';
      return { data: { id: job.id, dedupe_key: job.dedupe_key }, error: null };
    },
    from(name) {
      let filters = [];
      let change = null;
      let upsert = null;
      let selected = false;
      const query = {
        select() { selected = true; return this; },
        update(data) { change = data; return this; },
        upsert(data) { upsert = data; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        limit() { return this; },
        order() { return this; },
        async single() { const result = await this; return { data: result.data?.[0] || null, error: null }; },
        async maybeSingle() {
          const result = await this;
          return { data: result.data?.[0] || null, error: null };
        },
        then(resolve) {
          if (upsert) {
            const keys = ['settlement_id', 'pedido_id'];
            const exists = (tables[name] || []).some((row) => keys.every((key) => row[key] === upsert[key]));
            if (!exists) tables[name].push({ status: 'pending', attempts: 0, child_job_id: null, ...upsert });
          }
          const rows = (tables[name] || []).filter((row) => filters.every(([key, value]) => row[key] === value));
          if (change) rows.forEach((row) => Object.assign(row, change));
          resolve({ data: selected ? rows.map((row) => ({ ...row })) : null, error: null });
        },
      };
      return query;
    },
  };
  return { client, tables };
}

function service(enabled, sent, resumed = async () => ({ json: null, error: 'timeout' })) {
  return load('src/services/supplier-oracle-jobs.ts', {
    '@/lib/supabase': {},
    '@/lib/supplier-oracle-settlement': { supplierOracleWritesEnabled: () => enabled },
    '@/lib/dslite/resume-request': { requestDsliteResume: resumed },
    '@/services/waha': {
      getWahaNewMessageId: async () => 'WAHA-ID-1',
      normalizeWhatsappChatId: (phone) => `${phone}@c.us`,
      sendWahaText: sent,
    },
    '@/services/nf-auditoria': { registrarEventoNfAuditoria: async () => {} },
    '@/lib/dslite/label-state': { isDslitePlaceholderLabelSource: () => false },
    '@/lib/sync/stale-jobs': { isJobStale: () => true, DEFAULT_STALE_JOB_THRESHOLD_MINUTES: 10 },
  });
}

function fakePostprocessDb(sentLabel) {
  const db = fakeDb();
  const settlementId = '00000000-0000-4000-8000-000000000031';
  const pedidoId = '00000000-0000-4000-8000-000000000032';
  db.tables.jobs = [{ id: jobId, tipo: 'supplier_settlement_postprocess', status: 'pendente',
    dedupe_key: `supplier_settlement_postprocess:${settlementId}`, log: [], total: 1 }];
  db.tables.supplier_settlements = [{ id: settlementId, status: 'confirmed' }];
  db.tables.supplier_settlement_items = [{ settlement_id: settlementId, pedido_id: pedidoId,
    ml_order_id_snapshot: 'ML-123' }];
  db.tables.supplier_settlement_resume_effects = [];
  db.tables.pedidos = [{ id: pedidoId, ml_order_id: 'ML-123', situacao: 'pendente',
    dslite_etiqueta_enviada: sentLabel, dslite_label_source: null }];
  return db;
}

test('fila da ORC-04 fica inerte com flag desligada', async () => {
  const { client, tables } = fakeDb();
  const worker = service(false, async () => { throw Error('não deve enviar'); });
  assert.deepEqual(await worker.processSupplierOracleQueue(client), { processed: 0, disabled: true });
  assert.equal(tables.jobs[0].status, 'pendente');
});

test('mensagem aprovada é enviada uma vez e checkpoint conclui o job', async () => {
  const { client, tables } = fakeDb();
  let sends = 0;
  const worker = service(true, async ({ messageId }) => { sends++; assert.equal(messageId, 'WAHA-ID-1'); });
  assert.equal((await worker.processSupplierOracleQueue(client)).processed, 1);
  assert.equal(tables.supplier_settlement_communications[0].status, 'sent');
  assert.equal(tables.jobs[0].status, 'completo');
  await worker.processSupplierOracleQueue(client);
  assert.equal(sends, 1);
});

test('timeout WAHA não dispara reenvio automático', async () => {
  const { client, tables } = fakeDb();
  let sends = 0;
  const worker = service(true, async () => { sends++; throw Error('timeout'); });
  await worker.processSupplierOracleQueue(client);
  assert.equal(tables.supplier_settlement_communications[0].status, 'uncertain');
  assert.equal(tables.jobs[0].status, 'on_hold');
  await worker.processSupplierOracleQueue(client);
  assert.equal(sends, 1);
});

test('retomada DSLite já satisfeita é registrada como dispensada sem chamada externa', async () => {
  const { client, tables } = fakePostprocessDb(true);
  let calls = 0;
  const worker = service(true, async () => {}, async () => { calls++; return { json: null, error: null }; });
  await worker.processSupplierOracleQueue(client);
  assert.equal(calls, 0);
  assert.equal(tables.supplier_settlement_resume_effects[0].status, 'skipped');
  assert.equal(tables.jobs[0].status, 'completo');
});

test('compra direta Evolusom não inicia outra criação de pedido após o PIX', async () => {
  const { client, tables } = fakePostprocessDb(false);
  tables.pedidos[0].evolusom_order_id = 63012231;
  let calls = 0;
  const worker = service(true, async () => {}, async () => { calls++; return { json: null, error: null }; });
  await worker.processSupplierOracleQueue(client);
  assert.equal(calls, 0);
  assert.equal(tables.supplier_settlement_resume_effects[0].status, 'skipped');
  assert.equal(tables.jobs[0].status, 'completo');
});

test('timeout DSLite fica incerto e não repete retomada', async () => {
  const previous = process.env.API_SECRET_KEY;
  process.env.API_SECRET_KEY = 'synthetic-test-key';
  try {
    const { client, tables } = fakePostprocessDb(false);
    let calls = 0;
    const worker = service(true, async () => {}, async () => { calls++; return { json: null, error: 'timeout' }; });
    await worker.processSupplierOracleQueue(client);
    assert.equal(calls, 1);
    assert.equal(tables.supplier_settlement_resume_effects[0].status, 'uncertain');
    assert.equal(tables.jobs[0].status, 'on_hold');
    await worker.processSupplierOracleQueue(client);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = previous;
  }
});
