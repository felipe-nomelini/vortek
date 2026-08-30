const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const integrationSource = fs.readFileSync(
  path.join(root, 'src/services/integration.ts'),
  'utf8',
);
const functionStart = integrationSource.indexOf(
  'export async function upsertInvoiceDataMLByShipment',
);
const functionEnd = integrationSource.indexOf(
  'export type MlLabelResponseType',
  functionStart,
);

assert.notEqual(functionStart, -1);
assert.notEqual(functionEnd, -1);

const uploadSource = integrationSource.slice(functionStart, functionEnd);

test('invoice nova usa POST XML direto sem tentativas JSON', () => {
  assert.doesNotMatch(uploadSource, /application\/json/);
  assert.doesNotMatch(uploadSource, /payloadJson|created_json|unsupportedJson/);
  assert.match(
    uploadSource,
    /createEndpoint = `\/shipments\/\$\{encodeURIComponent\(shipmentId\)\}\/invoice_data\/\?siteId=/,
  );
  assert.match(uploadSource, /tryUpload\("POST", createEndpoint\)/);
  assert.match(uploadSource, /"Content-Type": "application\/xml"/);
});

test('invoice existente usa PUT XML somente quando possui invoice_id', () => {
  assert.match(uploadSource, /const invoiceId = String\(currentInvoiceData\.data\.id/);
  assert.match(
    uploadSource,
    /updateEndpoint = `\/shipment_invoice\/\$\{encodeURIComponent\(invoiceId\)\}\/\?siteId=/,
  );
  assert.match(uploadSource, /tryUpload\("PUT", updateEndpoint\)/);
  assert.match(uploadSource, /reason: "invoice_id_missing"/);
});

test('GET decide a operação e falha de consulta não cria invoice', () => {
  const lookupFailure = uploadSource.indexOf(
    'if (currentInvoiceData.statusCode !== 404)',
  );
  const createCall = uploadSource.indexOf('tryUpload("POST", createEndpoint)');
  assert.ok(lookupFailure > -1 && createCall > lookupFailure);
  assert.match(uploadSource, /reason: "invoice_lookup_failed"/);
  assert.match(uploadSource, /currentKey === fiscalKey/);
  assert.match(uploadSource, /reason: "already_linked"/);
});

test('POST e PUT só concluem após GET confirmar a chave fiscal', () => {
  assert.match(
    uploadSource,
    /const verifyFinalInvoice = async[\s\S]*consultarInvoiceDataPorShipmentML\([\s\S]*verifiedKey === fiscalKey/,
  );
  assert.match(uploadSource, /reason: "invoice_verification_failed"/);
  assert.match(
    uploadSource,
    /return verifyFinalInvoice\(\{[\s\S]*method: "PUT"/,
  );
  assert.match(
    uploadSource,
    /return verifyFinalInvoice\(\{[\s\S]*method: "POST"/,
  );
});

test('callers usam o read-back centralizado retornado pelo helper', () => {
  for (const relativePath of [
    'src/app/api/dslite/pedido/route.ts',
    'src/app/api/dslite/etiqueta-auto/route.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /uploadRes\.data\?\.fiscal_key/);
  }
});
