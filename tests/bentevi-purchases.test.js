const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/compras/page.tsx');
const styles = read('src/app/(app)/compras/compras.module.css');
const drawer = read('src/components/compras/CompraDetailsDrawer.tsx');
const listRoute = read('src/app/api/compras/route.ts');
const summaryRoute = read('src/app/api/compras/resumo/route.ts');
const exportRoute = read('src/app/api/compras/exportar-pdf/route.ts');

test('entrega o cockpit operacional de compras sem restaurar a Hayamax ativa', () => {
  assert.match(page, /Valor comprometido/);
  assert.match(page, /Compras nos filtros atuais/);
  assert.match(page, /Compra DSLite, cliente, fornecedor, produto ou SKU/);
  assert.match(page, /title: 'Compra'/);
  assert.match(page, /title: 'Venda'/);
  assert.match(page, /title: 'Fornecedor'/);
  assert.match(page, /title: 'Pagamento'/);
  assert.match(page, /title: 'Fiscal e envio'/);
  assert.doesNotMatch(page, /\/api\/fornecedores\/saldo-hayamax/);
  assert.match(drawer, /Conta-saldo aposentada/);
  assert.match(styles, /--bentevi-primary/);
});

test('usa somente o valor devido ao fornecedor no resumo financeiro', () => {
  assert.match(summaryRoute, /supplier_payment_amount/);
  assert.match(summaryRoute, /supplier_payment_total/);
  assert.match(summaryRoute, /supplier_payment_missing_count/);
  assert.doesNotMatch(
    summaryRoute.slice(summaryRoute.indexOf('const supplierPaymentTotal')),
    /valor_total\s*\|\|\s*row\.supplier_payment_amount/,
  );
  assert.match(page, /summary\.supplier_payment_total/);
  assert.match(page, /summary\.supplier_payment_missing_count/);
});

test('filtra lista, resumo e PDF pelo mesmo fornecedor', () => {
  for (const source of [listRoute, summaryRoute]) {
    assert.match(source, /searchParams\.get\('fornecedorId'\)/);
    assert.match(source, /\.eq\('fornecedor_id', fornecedorId\)/);
  }
  assert.match(exportRoute, /'fornecedorId'/);
  assert.match(page, /params\.set\('fornecedorId', supplierFilter\)/);
});

test('protege a amostra de homologação e respeita permissão financeira', () => {
  assert.match(listRoute, /is_homologation_fixture/);
  assert.match(page, /hasPermission\(role, 'purchases\.payment\.confirm'\)/);
  assert.match(page, /purchase\.is_homologation_fixture/);
  assert.match(page, /Amostra real protegida para homologação/);
  assert.match(drawer, /Amostra real protegida para homologação/);
  assert.match(drawer, /disabled=\{purchase\.is_homologation_fixture\}/);
});

test('concentra detalhes sem poluir a tabela', () => {
  assert.match(page, /<CompraDetailsDrawer/);
  assert.match(drawer, /Visão geral/);
  assert.match(drawer, /Pagamento/);
  assert.match(drawer, /Fiscal e envio/);
  assert.match(drawer, /Abrir DANFE/);
  assert.match(drawer, /Código de rastreio/);
  assert.match(page, /Confirmar pagamento/);
  assert.match(page, /Enviar comprovante/);
});
