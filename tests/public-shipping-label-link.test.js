const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/app/api/public/etiquetas/[id]/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createRoute({ order, file, dbError = null } = {}) {
  const calls = { db: 0, storage: [] };
  const db = {
    from: () => {
      calls.db += 1;
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: dbError }) }) }) };
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createServiceClient: () => db },
    '@/lib/shipping-label-storage': {
      downloadShippingLabelFromStorage: async (_client, path) => {
        calls.storage.push(path);
        return file;
      },
    },
    '@/lib/public-shipping-label-links': {
      verifyPublicShippingLabelToken: (_id, token) => token === 'valid',
    },
    '@/lib/shipping-label-pdf': {
      normalizeMlShippingLabelPdfForThermalPrint: async () => Buffer.from('%PDF-thermal'),
    },
    '@/lib/dslite/placeholder-label': {
      loadDslitePlaceholderLabel: async () => Buffer.from('%PDF-placeholder'),
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id], module, module.exports);
  return {
    calls,
    get: (query = 'token=valid') => module.exports.GET(
      new Request(`https://app.bentevi.shop/api/public/etiquetas/order-1?${query}`),
      { params: Promise.resolve({ id: 'order-1' }) },
    ),
  };
}

test('link público entrega PDF sem redirecionar ao Storage privado', async () => {
  const route = createRoute({
    order: { id: 'order-1', numero: 123, ml_label_storage_path: '123/456.pdf' },
    file: Buffer.from('%PDF-label'),
  });
  const response = await route.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="etiqueta_ml_123.pdf"');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), '%PDF-label');
  assert.deepEqual(route.calls.storage, ['123/456.pdf']);
});

test('link térmico entrega ZPL como download público', async () => {
  const route = createRoute({
    order: { id: 'order-1', numero: 123, ml_thermal_label_storage_path: '123/456.zpl' },
    file: Buffer.from('^XA^FO0,0^FDlabel^FS^XZ'),
  });
  const response = await route.get('token=valid&format=zpl2');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('content-type'), 'text/plain');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="etiqueta_ml_123.zpl"');
  assert.equal(await response.text(), '^XA^FO0,0^FDlabel^FS^XZ');
  assert.deepEqual(route.calls.storage, ['123/456.zpl']);
});

test('token inválido é recusado antes de consultar o pedido', async () => {
  const route = createRoute();
  const response = await route.get('token=invalid');
  assert.equal(response.status, 403);
  assert.equal(route.calls.db, 0);
  assert.deepEqual(route.calls.storage, []);
});

test('arquivo ausente e falha de leitura retornam erro sem redirecionamento', async () => {
  const missing = createRoute({ order: { id: 'order-1', numero: 123 } });
  const missingResponse = await missing.get();
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(missing.calls.storage, []);

  const unreadable = createRoute({
    order: { id: 'order-1', numero: 123, ml_label_storage_path: '123/456.pdf' },
    file: null,
  });
  const unreadableResponse = await unreadable.get();
  assert.equal(unreadableResponse.status, 404);
  assert.equal(unreadableResponse.headers.get('location'), null);
  assert.deepEqual(unreadable.calls.storage, ['123/456.pdf']);
});

test('PDF térmico mantém a conversão existente', async () => {
  const route = createRoute({
    order: { id: 'order-1', numero: 123, ml_label_storage_path: '123/456.pdf' },
    file: Buffer.from('%PDF-original'),
  });
  const response = await route.get('token=valid&format=thermal_pdf');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="etiqueta_ml_123_100x150.pdf"');
  assert.equal(await response.text(), '%PDF-thermal');
});
