const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const settlementId = '00000000-0000-4000-8000-000000000021';
const purchaseId = '00000000-0000-4000-8000-000000000011';
const saleId = '00000000-0000-4000-8000-000000000031';
const basePurchase = { id: purchaseId, fornecedor_id: '108', supplier_payment_status: 'pending',
  supplier_payment_receipt_path: null, supplier_settlement_id: null };
const sale = { id: saleId, ml_order_id: 'ML-101' };
const receipt = new File([Buffer.from('%PDF-1.7\nTeste')], 'pix.pdf', { type: 'application/pdf' });
const oracle = load('src/lib/supplier-oracle-settlement.ts', {
  'node:crypto': require('node:crypto'), 'next/server': { NextResponse },
});
const receipts = load('src/lib/supplier-oracle-receipt.ts', {});
const individual = load('src/services/supplier-oracle-individual.ts', {
  'node:crypto': require('node:crypto'), 'next/server': { NextResponse },
  '@/lib/supplier-oracle-settlement': oracle,
  '@/lib/supplier-oracle-receipt': receipts,
});

function client(options = {}) {
  const calls = [];
  const db = {
    from: (table) => ({ select: () => ({ eq: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      is: async () => ({ data: options.items || [], error: null }),
      maybeSingle: async () => ({ data: table === 'jobs'
        ? { id: '00000000-0000-4000-8000-000000000041' }
        : options.prior || { status: 'prepared', version: 1, receipt_path: null }, error: null }),
    }) }) }),
    storage: { from: () => ({
      upload: async (path) => { calls.push(['upload', path]); return { error: null }; },
      download: async () => ({ data: null, error: { message: 'not_found' } }),
    }) },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'supplier_oracle_prepare') return { data: { id: settlementId, status: 'prepared', version: 1 }, error: null };
      if (name === 'supplier_oracle_attach_receipt') return { data: { id: settlementId, version: 2 }, error: null };
      return { data: { id: settlementId, status: 'confirmed', version: 3 }, error: null };
    },
  };
  return { db, calls };
}

test('confirmação individual usa um único núcleo e não despacha efeitos externos na requisição', async () => {
  const { db, calls } = client();
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: basePurchase, sale, actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: receipt, reference: 'PIX-REAL', notes: null, resumeDsliteFlow: true, resumeOnly: false },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.supplierSettlementId, settlementId);
  assert.equal(response.body.jobId, '00000000-0000-4000-8000-000000000041');
  assert.equal(response.body.whatsapp.sent, false);
  assert.equal(response.body.resume.pending, true);
  assert.deepEqual(calls.map(([name]) => name), ['supplier_oracle_prepare', 'upload',
    'supplier_oracle_attach_receipt', 'supplier_oracle_confirm']);
  assert.match(calls[0][1].p_idempotency_key, /^single:[0-9a-f-]{36}$/);
  assert.equal(calls[3][1].p_expected_version, 2);
});

test('repetição retoma preparo unitário já vinculado sem nova preparação', async () => {
  const { db, calls } = client({ prior: { id: settlementId, status: 'prepared', version: 1,
    fornecedor_dslite_id: '108', idempotency_key: 'single:unit-test', credit_amount: 0,
    receipt_path: null }, items: [{ compra_id: purchaseId }] });
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: { ...basePurchase, supplier_settlement_id: settlementId }, sale,
    actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: receipt, reference: 'PIX-REAL', notes: null,
      resumeDsliteFlow: false, resumeOnly: false },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.some(([name]) => name === 'supplier_oracle_prepare'), false);
  assert.equal(calls.some(([name]) => name === 'supplier_oracle_confirm'), true);
});

test('adaptador individual não confirma compra reservada em lote', async () => {
  const { db, calls } = client({ prior: { id: settlementId, status: 'prepared', version: 1,
    fornecedor_dslite_id: '108', idempotency_key: 'oracle:batch', credit_amount: 0,
    receipt_path: null }, items: [{ compra_id: purchaseId }, { compra_id: saleId }] });
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: { ...basePurchase, supplier_settlement_id: settlementId }, sale,
    actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: receipt, reference: 'PIX-REAL', notes: null,
      resumeDsliteFlow: false, resumeOnly: false },
  });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
});

test('comprovante inválido não prepara liquidação', async () => {
  const { db, calls } = client();
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: basePurchase, sale, actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: new File(['texto'], 'falso.pdf'), reference: null, notes: null,
      resumeDsliteFlow: false, resumeOnly: false },
  });
  assert.equal(response.status, 422);
  assert.equal(calls.length, 0);
});

test('referência longa é rejeitada antes de reservar a compra', async () => {
  const { db, calls } = client();
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: basePurchase, sale, actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: receipt, reference: 'x'.repeat(201), notes: null,
      resumeDsliteFlow: false, resumeOnly: false },
  });
  assert.equal(response.status, 422);
  assert.equal(calls.length, 0);
});

test('compra já paga pelo núcleo não gera segunda liquidação nem novo job', async () => {
  const { db, calls } = client();
  const response = await individual.confirmSupplierOracleIndividual({ client: db,
    purchase: { ...basePurchase, supplier_payment_status: 'paid', supplier_settlement_id: settlementId,
      supplier_payment_receipt_path: 'liquidacoes/receipt.pdf', supplier_payment_reference: 'PIX-REAL' }, sale,
    actor: '00000000-0000-4000-8000-000000000001',
    payment: { receiptFile: null, reference: 'PIX-REAL', notes: null, resumeDsliteFlow: true, resumeOnly: false },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.supplierSettlementId, settlementId);
  assert.equal(calls.length, 0);
});
