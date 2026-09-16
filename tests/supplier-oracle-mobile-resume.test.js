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
    throw Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const jobId = '00000000-0000-4000-8000-000000000041';
const settlementId = '00000000-0000-4000-8000-000000000021';
const saleId = '00000000-0000-4000-8000-000000000031';
const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const routeFile = 'src/app/api/mobile/v1/sales/[id]/resume-dslite/route.ts';

function route(owned, status = 'pendente') {
  return load(routeFile, {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/app/api/compras/[id]/confirmar-pagamento/route': { POST: async () => { throw Error('Não deve confirmar pagamento'); } },
    '@/app/api/dslite/pedido/status/route': { GET: async () => { throw Error('Não deve consultar job DSLite legado'); } },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: saleId }) },
    '@/lib/mobile-sale-lookup': { mobileSaleIdSchema: require('zod').z.string().uuid(),
      loadMobileOperationalSale: async () => ({ ok: true, row: { id: saleId } }) },
    '@/lib/orders/operational-view': { isPostDispatchOrder: () => false },
    '@/lib/supabase': { createServiceClient: () => ({ from: (table) => ({ select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: owned ? { pedido_id: saleId } : null, error: null }) }),
        maybeSingle: async () => ({ data: table === 'jobs' ? { id: jobId, tipo: 'supplier_settlement_postprocess',
          dedupe_key: `supplier_settlement_postprocess:${settlementId}`, status } : null, error: null }) }),
    }) }) }) },
    '@/services/job-idempotency': { jobBelongsToPedido: () => false, normalizeIdempotencyKey: () => null },
  });
}

test('API mobile acompanha o job do Oráculo sem disparar uma segunda retomada', async () => {
  const api = route(true, 'on_hold');
  const response = await api.GET(new Request(`https://app.bentevi.shop/api/mobile/v1/sales/${saleId}/resume-dslite?jobId=${jobId}`),
    { params: Promise.resolve({ id: saleId }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.jobId, jobId);
  assert.equal(response.body.data.state, 'on_hold');
  assert.equal(response.body.data.steps[0].status, 'warning');
});

test('API mobile não revela job de liquidação de outra venda', async () => {
  const api = route(false);
  const response = await api.GET(new Request(`https://app.bentevi.shop/api/mobile/v1/sales/${saleId}/resume-dslite?jobId=${jobId}`),
    { params: Promise.resolve({ id: saleId }) });
  assert.equal(response.status, 404);
});
