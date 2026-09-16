const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, {
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
const request = (body) => new Request('https://app.bentevi.shop/api/fornecedores/creditos/divergencias/' + id + '/resolver', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id }) };

test('ORC-06: decisão exige admin, versão e justificativa antes de chamar RPC', async () => {
  const calls = [];
  const api = load('src/app/api/fornecedores/creditos/divergencias/[id]/resolver/route.ts', {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => ({ rpc: async (...args) => {
      calls.push(args); return { data: { status: 'closed' }, error: null };
    } }) },
    '@/lib/auth/admin': { requireAdminUser: async () => ({ ok: true, user: { id } }) },
    '@/lib/supplier-credits-visual-review': { loadSupplierCreditsVisualReview: async () => null },
    '@/lib/supplier-oracle-settlement': { supplierOracleRpcError: () => { throw Error('RPC falhou'); } },
  });
  assert.equal((await api.POST(request({ versaoEsperada: 1, decisao: 'pending_credit', justificativa: 'curta' }), params)).status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await api.POST(request({ versaoEsperada: 1, decisao: 'pending_credit', justificativa: 'Confirmado pelo fornecedor' }), params)).status, 200);
  assert.equal(calls[0][0], 'supplier_oracle_resolve_cancellation');
  assert.equal(calls[0][1].p_actor, id);
});

test('ORC-06: usuário sem autorização não alcança serviço privilegiado', async () => {
  const api = load('src/app/api/fornecedores/creditos/divergencias/[id]/resolver/route.ts', {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => { throw Error('não deve ser acessado'); } },
    '@/lib/auth/admin': { requireAdminUser: async () => ({ ok: false, response: { status: 403 } }) },
    '@/lib/supplier-credits-visual-review': { loadSupplierCreditsVisualReview: async () => null },
    '@/lib/supplier-oracle-settlement': { supplierOracleRpcError: () => { throw Error('não deve ser chamado'); } },
  });
  assert.equal((await api.POST(request({}), params)).status, 403);
});
