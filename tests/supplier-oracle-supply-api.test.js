const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/app/api/compras/[id]/abastecimento/route.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function route(input = {}) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'compras');
      return {
        select(fields) {
          if (fields.startsWith('id,supplier_payment_mode')) return this;
          return Promise.resolve({ data: input.conflict ? [] : [{ id: input.id, supply_status: 'ready' }], error: null });
        },
        eq(...args) { calls.push(['eq', ...args]); return this; },
        is(...args) { calls.push(['is', ...args]); return this; },
        maybeSingle: async () => ({ data: input.purchase || { id: input.id, supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending' }, error: null }),
        update(values) { calls.push(['update', values]); return this; },
      };
    },
  };
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)((name) => {
    const dependencies = {
      'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
      zod: require('zod'),
      '@/lib/api-request-auth': { authorizeApiRequest: async () => input.auth || { ok: true, userId: 'manager-id' } },
      '@/lib/supabase': { createServiceClient: () => client },
      '@/lib/homologation-fixture': { isHomologationFixtureId: () => false },
    };
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return { handler: module.exports.PATCH, calls };
}

const id = '00000000-0000-0000-0000-000000000001';
const request = (body) => new Request('https://app.bentevi.shop/api/compras/' + id + '/abastecimento', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id }) };

test('altera estado com ator e comparação da versão lida', async () => {
  const { handler, calls } = route({ id });
  const response = await handler(request({ status: 'ready', note: 'Confirmado pelo fornecedor', expectedStatus: 'unknown', expectedChangedAt: null }), params);
  assert.equal(response.status, 200);
  assert.ok(calls.some(([kind, values]) => kind === 'update' && values.supply_status_changed_by === 'manager-id' && values.supply_status_note === 'Confirmado pelo fornecedor'));
  assert.ok(calls.some((entry) => entry[0] === 'eq' && entry[1] === 'supply_status' && entry[2] === 'unknown'));
  assert.ok(calls.some((entry) => entry[0] === 'is' && entry[1] === 'supply_status_changed_at' && entry[2] === null));
});

test('rejeita justificativa fraca, compra paga e edição concorrente', async () => {
  const valid = { status: 'ready', note: 'Confirmado pelo fornecedor', expectedStatus: 'unknown', expectedChangedAt: null };
  assert.equal((await route({ id }).handler(request({ ...valid, note: 'teste' }), params)).status, 422);
  assert.equal((await route({ id, purchase: { supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'paid' } }).handler(request(valid), params)).status, 409);
  assert.equal((await route({ id, conflict: true }).handler(request(valid), params)).status, 409);
});

test('nega acesso antes de qualquer leitura privilegiada', async () => {
  const denied = { ok: false, response: { status: 403 } };
  const { handler, calls } = route({ id, auth: denied });
  assert.equal((await handler(request({}), params)).status, 403);
  assert.deepEqual(calls, []);
});
