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
const second = '00000000-0000-4000-8000-000000000012';
const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const oracle = load('src/lib/supplier-oracle-settlement.ts', {
  'node:crypto': require('node:crypto'), 'next/server': { NextResponse },
});
const communication = load('src/lib/supplier-oracle-communication.ts', {
  'node:crypto': require('node:crypto'),
});
const settlements = [id, second].map((value, index) => ({
  id: value, status: 'confirmed', contact_phone_snapshot: '11999999999',
  fornecedor_nome_snapshot: index ? 'Fornecedor B' : 'Fornecedor A',
  cnpj_snapshot: index ? '11444777000161' : '11222333000181',
  gross_amount: 50, credit_amount: index ? 50 : 0, pix_amount: index ? 0 : 50,
  payment_reference: index ? null : 'PIX-A',
}));
const items = [id, second].map((value, index) => ({
  settlement_id: value, sale_number_snapshot: index + 1,
  product_description_snapshot: 'Produto', quantity_snapshot: 1,
}));

function fakeClient(calls) {
  return {
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: { id, status: 'draft', version: 1 }, error: null }; },
    from(name) {
      calls.push(['from', name]);
      return {
        select() { return this; }, in() { return this; },
        then(resolve) { resolve({ data: name === 'supplier_settlements' ? settlements : items, error: null }); },
      };
    },
  };
}

function route(file, enabled, calls, auth = { ok: true, userId: '00000000-0000-4000-8000-000000000001' }) {
  return load(file, {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async (_, permission) => { calls.push(['permission', permission]); return auth; } },
    '@/lib/supabase': { createServiceClient: () => fakeClient(calls) },
    '@/lib/supplier-oracle-settlement': { ...oracle, supplierOracleWritesEnabled: () => enabled },
    '@/lib/supplier-oracle-communication': communication,
  });
}

const post = (body) => new Request('https://app.bentevi.shop/api/compras/liquidacoes', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('ORC-04 monta blocos por CNPJ e distingue PIX zero', () => {
  const body = communication.buildSupplierOracleMessage(settlements, items);
  assert.match(body, /11222333000181/);
  assert.match(body, /11444777000161/);
  assert.match(body, /Quitação integral por crédito/);
  assert.match(body, /PIX-A/);
  assert.equal(body.includes('pix-b'), false);
  assert.equal(communication.supplierOracleSelectionKey([id, second]),
    communication.supplierOracleSelectionKey([second, id]));
});

test('ORC-04 writer desligado não consulta banco e autorização precede a flag', async () => {
  for (const file of [
    'src/app/api/compras/liquidacoes/[id]/comunicar/route.ts',
    'src/app/api/compras/liquidacoes/comunicacoes/[id]/aprovar/route.ts',
    'src/app/api/compras/liquidacoes/comunicacoes/[id]/resolver/route.ts',
  ]) {
    const calls = [];
    const api = route(file, false, calls);
    const response = await api.POST(post({ liquidacaoIds: [id] }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 503);
    assert.deepEqual(calls.map(([kind]) => kind), ['permission']);
  }
  const calls = [];
  const api = route('src/app/api/compras/liquidacoes/[id]/comunicar/route.ts', true, calls,
    { ok: false, response: { status: 403 } });
  assert.equal((await api.POST(post({ liquidacaoIds: [id] }), { params: Promise.resolve({ id }) })).status, 403);
  assert.deepEqual(calls.map(([kind]) => kind), ['permission']);
});

test('ORC-04 exige seleção explícita e aprovação por versão', async () => {
  const calls = [];
  const api = route('src/app/api/compras/liquidacoes/[id]/comunicar/route.ts', true, calls);
  assert.equal((await api.POST(post({ liquidacaoIds: [second] }), { params: Promise.resolve({ id }) })).status, 422);
  assert.equal((await api.POST(post({ liquidacaoIds: [id, second] }), { params: Promise.resolve({ id }) })).status, 201);
  assert.equal(calls.find((entry) => entry[0] === 'rpc')[1], 'supplier_oracle_communication_draft');
  const approvalCalls = [];
  const approval = route('src/app/api/compras/liquidacoes/comunicacoes/[id]/aprovar/route.ts', true, approvalCalls);
  assert.equal((await approval.POST(post({ versaoEsperada: 1 }), { params: Promise.resolve({ id }) })).status, 200);
  assert.equal(approvalCalls.find((entry) => entry[0] === 'rpc')[2].p_expected_version, 1);
});
