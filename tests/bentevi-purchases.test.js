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

test('organiza a tabela de compras por identidade, contexto e andamento', () => {
  for (const title of ['Data', 'Compra DSLite', 'Venda ML', 'Produto', 'Fornecedor', 'Valores', 'Andamento', 'Ação']) {
    assert.match(page, new RegExp(`title: '${title}'`));
  }
  assert.match(page, /purchase\.pedido_ml_pack_id.*<b>Pack<\/b>/s);
  assert.match(page, /purchase\.pedido_ml_order_id.*<b>Venda<\/b>/s);
  assert.match(page, /Bentevi: \{purchase\.produto_sku_bentevi/);
  assert.match(page, /Fornecedor: \{purchase\.produto_sku_fornecedor/);
  assert.match(page, /<Steps type="inline"/);
  assert.match(page, /Próximo: \{progress\.nextLabel\}/);
  assert.match(styles, /\.progressCell/);
  assert.doesNotMatch(page, /title: 'Pagamento'/);
  assert.doesNotMatch(page, /title: 'Fiscal e envio'/);
});

test('corrige o resumo para PIX realmente aguardando confirmação', () => {
  assert.doesNotMatch(page, /Valor comprometido/);
  assert.match(page, /PIX aguardando confirmação/);
  assert.match(page, /Valor aguardando confirmação/);
  assert.match(page, /não é saldo bancário/);
  assert.match(summaryRoute, /row\.supplier_payment_mode === 'prepaid_pix'/);
  assert.match(summaryRoute, /row\.supplier_payment_status === 'pending'/);
  assert.match(summaryRoute, /supplier_payment_pending_count/);
  assert.match(summaryRoute, /supplier_payment_pending_total/);
  assert.match(summaryRoute, /supplier_payment_pending_missing_amount_count/);
  assert.doesNotMatch(summaryRoute, /supplier_payment_total:/);
  assert.doesNotMatch(summaryRoute, /supplier_payment_missing_count:/);
});

test('enriquece a compra sem criar uma segunda fonte de verdade', () => {
  assert.match(listRoute, /from\('produto_fornecedor_ofertas'\)/);
  assert.match(listRoute, /select\('id,produto_id,sku_fornecedor,sku_oferta,dslite_produto_id'\)/);
  assert.match(listRoute, /from\('produtos'\)/);
  assert.match(listRoute, /select\('id,sku'\)/);
  assert.match(listRoute, /from\('pedido_itens'\)/);
  assert.match(listRoute, /select\('pedido_id,titulo,quantidade,seller_sku,ml_item_id'\)/);
  assert.match(listRoute, /produto_sku_bentevi:/);
  assert.match(listRoute, /produto_sku_fornecedor:/);
  assert.match(listRoute, /itens_venda:/);
});

test('separa as fontes e todos os identificadores no detalhe', () => {
  assert.match(drawer, /Pack ML/);
  assert.match(drawer, /Venda \/ Order ML/);
  assert.match(drawer, /Número interno Vortek/);
  assert.match(drawer, /Itens da venda/);
  assert.match(drawer, /SKU Bentevi/);
  assert.match(drawer, /SKU do fornecedor/);
  assert.match(drawer, /ID do produto DSLite/);
  assert.match(drawer, /Fornecedor \/ DSLite/);
  assert.match(drawer, /Venda \/ Vortek-Brasil NFe/);
  assert.match(drawer, /Fiscal e entrega/);
  assert.doesNotMatch(
    drawer.slice(drawer.indexOf('export function getPurchaseSaleReference'), drawer.indexOf('export default function')),
    /pedido_vendas_numero/,
  );
});

test('deixa explícito que registrar PIX não transfere dinheiro', () => {
  assert.match(page, /Registrar PIX/);
  assert.match(page, /Revisar PIX/);
  assert.match(page, /Ver pagamento/);
  assert.match(page, /O Vortek não realiza o pagamento/);
  assert.match(page, /Faça o PIX no banco/);
  assert.match(drawer, /O Vortek não realiza a transferência/);
  assert.doesNotMatch(page, /Confirmar pagamento do fornecedor/);
});

test('exporta as identidades e valores com semântica explícita', () => {
  for (const field of ['compra_dslite', 'pack_ml', 'venda_ml', 'sku_bentevi', 'sku_fornecedor', 'valor_fornecedor', 'valor_venda', 'nf_dslite', 'rastreio']) {
    assert.match(exportRoute, new RegExp(field));
  }
  assert.match(exportRoute, /PIX no Vortek/);
  assert.doesNotMatch(exportRoute, /row\.pedido_vendas_numero \?/);
});

test('preserva filtros, proteção de homologação e permissão financeira', () => {
  for (const source of [listRoute, summaryRoute]) {
    assert.match(source, /searchParams\.get\('fornecedorId'\)/);
    assert.match(source, /\.eq\('fornecedor_id', fornecedorId\)/);
  }
  assert.match(exportRoute, /'fornecedorId'/);
  assert.match(page, /params\.set\('fornecedorId', supplierFilter\)/);
  assert.match(listRoute, /is_homologation_fixture/);
  assert.match(page, /hasPermission\(role, 'purchases\.payment\.confirm'\)/);
  assert.match(page, /purchase\.is_homologation_fixture/);
  assert.match(drawer, /Amostra real protegida para homologação/);
  assert.doesNotMatch(page, /\/api\/fornecedores\/saldo-hayamax/);
  assert.match(drawer, /Conta-saldo aposentada/);
});
