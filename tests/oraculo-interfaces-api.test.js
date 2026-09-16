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

const id = '00000000-0000-4000-8000-000000000011';
const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const oracle = load('src/lib/supplier-oracle-settlement.ts', {
  'node:crypto': require('node:crypto'), 'next/server': { NextResponse },
});

test('ORC-05 comprovante: permissão precede a flag e writer desligado não acessa Storage', async () => {
  const calls = [];
  const api = load('src/app/api/compras/liquidacoes/[id]/comprovante/route.ts', {
    'node:crypto': require('node:crypto'), 'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/supplier-oracle-receipt': load('src/lib/supplier-oracle-receipt.ts', {}),
    '@/lib/api-request-auth': { authorizeApiRequest: async (_, permission) => {
      calls.push(permission); return { ok: true, userId: id };
    } },
    '@/lib/supabase': { createServiceClient: () => { throw Error('Storage não deve ser acessado'); } },
    '@/lib/supplier-oracle-settlement': { ...oracle, supplierOracleWritesEnabled: () => false },
  });
  const response = await api.POST(new Request('https://app.bentevi.shop/receipt', { method: 'POST' }),
    { params: Promise.resolve({ id }) });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ['purchases.payment.confirm']);
});

test('ORC-05 listagem filtra contato no servidor sem revelar telefone completo', async () => {
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; },
    maybeSingle() { return Promise.resolve({ data: { contact_phone_snapshot: '11999999999' }, error: null }); },
    then(resolve) { resolve({ data: [{ id, fornecedor_dslite_id: '108', fornecedor_nome_snapshot: 'Fornecedor A',
      cnpj_snapshot: '11222333000181', supplier_pix_key_snapshot: 'pix-secret',
      contact_phone_snapshot: '11999999999', status: 'confirmed', gross_amount: 80,
      credit_amount: 20, pix_amount: 60, version: 2, prepared_at: '2026-09-16T00:00:00Z', confirmed_at: '2026-09-16T00:01:00Z' }],
      count: 1, error: null }); },
  };
  const api = load('src/app/api/compras/liquidacoes/route.ts', {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: id }) },
    '@/lib/supabase': { createServiceClient: () => ({ from: () => query }) },
    '@/lib/supplier-oracle-settlement': oracle,
  });
  const response = await api.GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes?contactOf=' + id));
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(JSON.stringify(response.body).includes('11999999999'), false);
  assert.equal(JSON.stringify(response.body).includes('pix-secret'), false);
  assert.equal(JSON.stringify(response.body).includes('11222333000181'), false);
});

test('ORC-05 consolida por conta, explica exclusões e não mistura créditos', async () => {
  const suppliers = [
    { id, dslite_id: '108', nome: 'A', apelido: 'A', cnpj: '11222333000181', supplier_pix_key: 'pix-a', ativo: true },
    { id: '00000000-0000-4000-8000-000000000012', dslite_id: '109', nome: 'B', apelido: 'B', cnpj: '11444777000161', supplier_pix_key: 'pix-b', ativo: true },
  ];
  const purchases = [
    { id: '00000000-0000-4000-8000-000000000021', dsid: '101', fornecedor_id: '108', supplier_payment_amount: 50, supply_status: 'ready', data_criacao: '2026-09-01' },
    { id: '00000000-0000-4000-8000-000000000022', dsid: '102', fornecedor_id: '108', supplier_payment_amount: 20, supply_status: 'unknown', data_criacao: '2026-09-02' },
    { id: '00000000-0000-4000-8000-000000000023', dsid: '103', fornecedor_id: '109', supplier_payment_amount: 70, supply_status: 'ready', data_criacao: '2026-09-03' },
  ];
  const sales = purchases.map((purchase, i) => ({ id: `sale-${i}`, numero: 201 + i, dslite_id: purchase.dsid, label_type: 'real', snapshot_source: null }));
  const fakeClient = {
    rpc: async (_, args) => ({ data: args.p_supplier_id === '108' ? 30 : 10, error: null }),
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        gt() { return this; }, in() { return this; }, or() { return this; }, is() { return this; },
        then(resolve) { resolve({ data: table === 'fornecedores' ? suppliers : table === 'compras' ? purchases
          : table === 'pedidos' ? sales : [], error: null }); },
      };
      return query;
    },
  };
  const api = load('src/app/api/compras/liquidacoes/hoje/route.ts', {
    'next/server': { NextResponse },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: id }) },
    '@/lib/supabase': { createServiceClient: () => fakeClient },
    '@/lib/fiscal/cnpj.js': { normalizeCnpj: (value) => value, isValidCnpj: () => true },
    '@/lib/homologation-fixture': { canUseHomologationFixtures: () => false,
      isHomologationFixtureId: () => false, isHomologationFixtureSource: () => false },
    '@/lib/supplier-oracle-eligibility': { evaluateSupplierOracleEligibility: ({ purchase }) => purchase.supply_status === 'ready' ? [] : ['supply_unknown'],
      oracleExclusionLabels: (codes) => codes.map(() => 'Abastecimento não verificado') },
    '@/lib/supplier-oracle-settlement': { ...oracle, supplierOracleWritesEnabled: () => false },
  });
  const response = await api.GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/hoje'));
  assert.equal(response.status, 200);
  assert.equal(response.body.writesEnabled, false);
  assert.deepEqual(response.body.data.map((group) => [group.fornecedorId, group.totalBruto, group.creditoSugerido, group.excluded.length]),
    [['108', 50, 30, 1], ['109', 70, 10, 0]]);
});
