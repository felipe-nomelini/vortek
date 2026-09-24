const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
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

const eligibility = load('src/lib/supplier-oracle-eligibility.ts', {});
const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const supplierId = '133';
const directSaleId = '00000000-0000-4000-8000-000000000011';
const cancelledSaleId = '00000000-0000-4000-8000-000000000012';
const dsliteSaleId = '00000000-0000-4000-8000-000000000013';

function client() {
  const purchases = [
    { id: '00000000-0000-4000-8000-000000000021', dsid: null, evolusom_order_id: 63012231,
      pedido_id: directSaleId, fornecedor_id: supplierId, data_criacao: '2026-09-20',
      supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending', supplier_payment_amount: 29.99,
      status: 'Faturado', status_dslite: '', supplier_settlement_id: null },
    { id: '00000000-0000-4000-8000-000000000022', dsid: null, evolusom_order_id: 63012202,
      pedido_id: cancelledSaleId, fornecedor_id: supplierId, data_criacao: '2026-09-20',
      supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending', supplier_payment_amount: 73.90,
      status: 'Faturado', status_dslite: '', supplier_settlement_id: null },
    { id: '00000000-0000-4000-8000-000000000023', dsid: '411128', evolusom_order_id: null,
      pedido_id: null, fornecedor_id: supplierId, data_criacao: '2026-09-21',
      supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending', supplier_payment_amount: 11.40,
      status: 'Faturado', status_dslite: '', supplier_settlement_id: null },
  ];
  const sales = [
    { id: directSaleId, numero: 1, dslite_id: null, evolusom_order_id: 63012231,
      situacao: 'etiqueta_impressa', snapshot_source: null },
    { id: cancelledSaleId, numero: 2, dslite_id: null, evolusom_order_id: 63012202,
      situacao: 'cancelado', snapshot_source: null },
    { id: dsliteSaleId, numero: 3, dslite_id: '411128', evolusom_order_id: null,
      situacao: 'pendente', snapshot_source: null },
  ];
  const tables = {
    fornecedores: [{ id: '00000000-0000-4000-8000-000000000030', dslite_id: supplierId,
      nome: 'Evolusom', apelido: 'Evolusom', cnpj: '11222333000181', supplier_pix_key: 'pix', ativo: true }],
    compras: purchases, pedidos: sales, supplier_settlement_items: [], supplier_cancellation_cases: [],
  };
  return {
    rpc: async () => ({ data: 0, error: null }),
    from(table) {
      let rows = tables[table] || [];
      const query = {
        select() { return this; },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        gt(field, value) { rows = rows.filter((row) => row[field] > value); return this; },
        in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return this; },
        is(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        or() { return this; },
        order(field) { rows = [...rows].sort((a, b) => String(a[field]).localeCompare(String(b[field]))); return this; },
        limit(count) { rows = rows.slice(0, count); return this; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return query;
    },
  };
}

function route(file) {
  return load(file, {
    'next/server': { NextResponse },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true }) },
    '@/lib/supabase': { createServiceClient: client },
    '@/lib/fiscal/cnpj.js': { normalizeCnpj: (value) => value, isValidCnpj: () => true },
    '@/lib/homologation-fixture': { canUseHomologationFixtures: () => false,
      isHomologationFixtureId: () => false, isHomologationFixtureSource: () => false },
    '@/lib/supplier-oracle-eligibility': eligibility,
    '@/lib/supplier-oracle-settlement': { maskSupplierFinancialValue: () => '••••',
      supplierOracleWritesEnabled: () => false, supplierOracleBatchMode: () => 'disabled',
      supplierOracleBatchAllowed: () => false },
  });
}

test('visão de hoje inclui compra direta vinculada e exclui venda cancelada', async () => {
  const api = route('src/app/api/compras/liquidacoes/hoje/route.ts');
  const response = await api.GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/hoje'));
  assert.equal(response.status, 200);
  const account = response.body.data[0];
  assert.deepEqual(account.included.map((item) => [item.source, item.dsid]),
    [['evolusom', '63012231'], ['dslite', '411128']]);
  assert.equal(account.totalBruto, 41.39);
  assert.equal(account.excluded[0].reasons[0].code, 'sale_cancelled');
  assert.equal(response.body.writesEnabled, false);
});

test('prévia individual mostra os mesmos itens e a origem correta', async () => {
  const api = route('src/app/api/compras/liquidacoes/preview/route.ts');
  const response = await api.GET(new Request(`https://app.bentevi.shop/api/compras/liquidacoes/preview?fornecedorId=${supplierId}`));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.included.map((item) => [item.source, item.dsid]),
    [['evolusom', '63012231'], ['dslite', '411128']]);
  assert.equal(response.body.excluded[0].reasons[0].code, 'sale_cancelled');
  assert.equal(response.body.totalBruto, 41.39);
});

test('cancelamento da venda direta encontra a compra vinculada e classifica sem crédito prematuro', async () => {
  const credits = load('src/lib/supplier-credits.ts', {
    '@/lib/supplier-balance': { HAYAMAX_FORNECEDOR_ID: '2' },
    '@/services/integration': { fetchMLResult: async () => { throw Error('não deve consultar ML antes do pagamento'); } },
    '@/lib/supplier-cancellation-dispatch.js': { classifySupplierDispatchHistory: () => { throw Error('não deve classificar despacho'); } },
  });
  const purchaseId = '00000000-0000-4000-8000-000000000021';
  const calls = [];
  const db = {
    from(table) {
      const query = {
        select() { return this; }, eq(field, value) { calls.push([table, field, value]); return this; },
        async maybeSingle() {
          const data = table === 'pedidos'
            ? { id: directSaleId, dslite_id: null, evolusom_order_id: 63012231, situacao: 'cancelado', ml_shipment_id: null }
            : table === 'compras'
              ? { id: purchaseId, fornecedor_id: supplierId, supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending' }
              : null;
          return { data, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) { calls.push([name, args]); return { data: { classification: 'unpaid', status: 'closed' }, error: null }; },
  };
  const result = await credits.createSupplierCancellationCreditCandidate(db, directSaleId);
  assert.equal(result.classification, 'unpaid');
  assert.equal(result.created, false);
  assert.ok(calls.some((call) => call[0] === 'compras' && call[1] === 'pedido_id' && call[2] === directSaleId));
  assert.ok(calls.some((call) => call[0] === 'compras' && call[1] === 'evolusom_order_id' && call[2] === 63012231));
  assert.equal(calls.at(-1)[0], 'supplier_oracle_record_cancellation');
});

test('confirmação individual direta usa o Oráculo mesmo quando a solicitação pede retomada', async () => {
  const purchaseId = '00000000-0000-4000-8000-000000000021';
  const calls = [];
  const purchase = { id: purchaseId, dsid: null, pedido_id: directSaleId,
    evolusom_order_id: 63012231, fornecedor_id: supplierId, supplier_payment_mode: 'prepaid_pix',
    supplier_payment_status: 'paid', supplier_settlement_id: null };
  const sale = { id: directSaleId, ml_order_id: 'ML-100', numero: 1, evolusom_order_id: 63012231,
    situacao: 'pendente', snapshot_source: null, ml_fiscal_release_at: null };
  const db = { from(table) { return { select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: purchase, error: null }; },
    async limit() { return { data: table === 'pedidos' ? [sale] : [], error: null }; } }; } };
  const api = load('src/app/api/compras/[id]/confirmar-pagamento/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase': { createServiceClient: () => db },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: 'operator' }) },
    '@/services/nf-auditoria': {}, '@/lib/ml/release-window-display': {},
    '@/lib/notifications/templates': {}, '@/lib/public-supplier-receipt-links': {},
    '@/lib/short-links': {}, '@/services/waha': {},
    '@/lib/dslite/placeholder-label': { DSLITE_BKR1_PLACEHOLDER_LABEL_SOURCE: 'placeholder' },
    '@/lib/dslite/label-state': {}, '@/lib/dslite/resume-request': {
      requestDsliteResume: () => { throw Error('Retomada DSLite indevida'); },
    },
    '@/lib/homologation-fixture': { isHomologationFixtureId: () => false,
      isHomologationFixtureSource: () => false },
    '@/lib/supplier-balance': { isBkr1Supplier: () => false },
    zod: require('zod'),
    '@/lib/supplier-oracle-settlement': { supplierOracleWritesEnabled: () => true },
    '@/services/supplier-oracle-individual': { confirmSupplierOracleIndividual: async (input) => {
      calls.push(input); return NextResponse.json({ success: true, oracle: true });
    } },
  });
  const response = await api.POST(new Request(`https://app.bentevi.shop/api/compras/${purchaseId}/confirmar-pagamento`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resume_only: true, resume_dslite_flow: true }),
  }), { params: Promise.resolve({ id: purchaseId }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.oracle, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purchase.id, purchaseId);
});
