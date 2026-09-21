const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/app/api/public/notas-fiscais/[id]/danfe/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ storagePath = '2000018570255102/1482.pdf', downloadError = null } = {}) {
  const calls = [];
  const pedido = { id: 'sale-id', numero: 2000018570255102, nota_fiscal_numero: '1482', nfe_external_id: 'invoice-id', nfe_chave: 'key', ml_order_id: 'ml-id' };
  const client = {
    from(table) {
      assert.equal(table, 'pedidos');
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: pedido, error: null }) };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'danfes');
        return { download: async (path) => {
          calls.push(path);
          return downloadError
            ? { data: null, error: downloadError }
            : { data: new Blob(['%PDF-1.4\nsynthetic']), error: null };
        } };
      },
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init = {}) => Response.json(body, init) } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/lib/fiscal/danfe-storage': {
      DANFE_BUCKET: 'danfes',
      resolveDanfeStoragePath: async () => ({ path: storagePath }),
      ensureDanfeStoredForPedido: async () => ({ ok: false, canonicalPath: null }),
    },
    '@/lib/public-nfe-links': { verifyPublicNfeToken: (_id, _purpose, token) => token === 'valid' },
    '@/services/fiscal-provider': { getFiscalProvider: () => ({}) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => mocks[name], module, module.exports);
  return {
    calls,
    get: (token = 'valid') => module.exports.GET(
      new Request(`https://app.bentevi.shop/api/public/notas-fiscais/sale-id/danfe?token=${token}`),
      { params: Promise.resolve({ id: 'sale-id' }) },
    ),
  };
}

test('link público entrega o PDF diretamente sem redirecionar ao IP interno', async () => {
  const app = harness();
  const response = await app.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('location'), null);
  assert.match(response.headers.get('content-disposition'), /danfe_1482\.pdf/);
  assert.equal(await response.text(), '%PDF-1.4\nsynthetic');
  assert.deepEqual(app.calls, ['2000018570255102/1482.pdf']);
});

test('link inválido não baixa o PDF e falha no storage não expõe URL interna', async () => {
  const app = harness({ downloadError: new Error('storage indisponível') });
  const forbidden = await app.get('invalid');
  assert.equal(forbidden.status, 403);
  assert.deepEqual(app.calls, []);
  const unavailable = await app.get();
  assert.equal(unavailable.status, 404);
  assert.equal(unavailable.headers.get('location'), null);
});
