const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadPaymentModeDomain() {
  const source = read('src/lib/produto-fornecedor.ts');
  const start = source.indexOf('export type SupplierPaymentMode');
  const end = source.indexOf('export function normalizeProductMatchText');
  assert.ok(start >= 0 && end > start, 'bloco de domínio do modo de pagamento não encontrado');

  const output = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const paymentModule = { exports: {} };
  Function('module', 'exports', output)(paymentModule, paymentModule.exports);
  return paymentModule.exports;
}

const { resolveSupplierPaymentMode } = loadPaymentModeDomain();

test('modo persistido da oferta prevalece e inferência é somente fallback', () => {
  const fixtures = [
    { persisted: 'postpaid', expected: 'postpaid' },
    { persisted: 'prepaid_pix', expected: 'prepaid_pix' },
    { persisted: null, expected: 'prepaid_pix' },
    { persisted: 'invalid', expected: 'prepaid_pix' },
  ];

  for (const fixture of fixtures) {
    assert.equal(resolveSupplierPaymentMode(fixture.persisted, '108'), fixture.expected);
  }
});

test('balance_account permanece somente para retomada histórica explícita', () => {
  assert.equal(resolveSupplierPaymentMode('balance_account', '2'), 'prepaid_pix');
  assert.equal(resolveSupplierPaymentMode('balance_account', '2', true), 'balance_account');
});

test('preview e execução usam o mesmo resolvedor e a mesma oferta como fonte', () => {
  const previewSource = read('src/app/api/pedidos/route.ts');
  const executionSource = read('src/app/api/dslite/pedido/route.ts');

  assert.match(previewSource, /prioridade,payment_mode/);
  assert.match(previewSource, /paymentMode: preferredOffer\?\.payment_mode \|\| null/);
  assert.match(previewSource, /resolveSupplierPaymentMode\(first\.paymentMode, first\.fornecedorId\)/);
  assert.doesNotMatch(previewSource, /inferSupplierPaymentMode/);

  assert.doesNotMatch(executionSource, /function normalizeSupplierPaymentMode/);
  assert.match(
    executionSource,
    /resolveSupplierPaymentMode\(\s*selectedOffer\.offer\.payment_mode,\s*fornecedorId,?\s*\)/,
  );
  assert.match(
    executionSource,
    /resolveSupplierPaymentMode\(\s*existingCompra\?\.supplier_payment_mode,\s*fornecedorId,\s*true,?\s*\)/,
  );

  const offer = { payment_mode: 'postpaid', dslite_fornecedor_id: '108' };
  assert.equal(
    resolveSupplierPaymentMode(offer.payment_mode, offer.dslite_fornecedor_id),
    resolveSupplierPaymentMode(offer.payment_mode, offer.dslite_fornecedor_id),
  );
});

test('preview não cria expectativa de pagamento sem fornecedor único', () => {
  const previewSource = read('src/app/api/pedidos/route.ts');

  assert.match(previewSource, /const paymentMode = singleSupplier && first\.fornecedorId/);
  assert.match(previewSource, /supplier_payment_mode: paymentMode/);
  assert.match(previewSource, /supplier_payment_status: paymentMode === 'prepaid_pix' \? 'pending' : null/);
  assert.match(
    previewSource,
    /fornecedor_nome: 'Estoque Interno',[\s\S]*?supplier_payment_mode: null,[\s\S]*?supplier_payment_status: null/,
  );
});

test('syncs preservam payment_mode existente e inferem apenas para nova oferta', () => {
  for (const relativePath of [
    'src/app/api/sync/catalogo/route.ts',
    'src/app/api/sync/preco-estoque/route.ts',
  ]) {
    const source = read(relativePath);
    assert.match(source, /dslite_produto_id,payment_mode,product:/);
    assert.match(source, /payment_mode:\s*existingOffer\?\.payment_mode \|\|\s*inferSupplierPaymentMode/);
  }
});
