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
  assert.doesNotMatch(page, /styles\.skuText/);
  assert.match(page, /className=\{styles\.productName\}/);
  assert.match(styles, /\.productName[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/);
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
  assert.match(listRoute, /select\('dslite_id,apelido,supplier_pix_key'\)/);
  assert.match(listRoute, /fornecedor_apelido:/);
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
  assert.match(drawer, /purchase\.fornecedor_apelido \|\| purchase\.fornecedor_nome/);
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

test('exporta relatório detalhado com a semântica atual de Compras', () => {
  for (const field of ['compraDslite', 'packMl', 'vendaMl', 'skuBentevi', 'skuFornecedor', 'valorFornecedor', 'valorVenda', 'valorFrete', 'nfDslite', 'rastreio']) {
    assert.match(exportRoute, new RegExp(field));
  }
  for (const column of ['Data', 'Compra DSLite', 'Venda ML', 'Produto e SKUs', 'Fornecedor', 'Valores', 'Andamento', 'Fiscal e envio']) {
    assert.match(exportRoute, new RegExp(`label: '${column}'`));
  }
  assert.match(exportRoute, /resolvePurchaseProgress\(row\)/);
  assert.match(exportRoute, /row\.fornecedor_apelido \|\| row\.fornecedor_nome/);
  assert.doesNotMatch(exportRoute, /row\.pedido_vendas_numero \?/);
  assert.doesNotMatch(exportRoute, /label: 'Ação'/);
});

test('aplica identidade dark Bentevi em todas as páginas do relatório', () => {
  assert.match(exportRoute, /import \{ benteviColors \} from '@\/theme\/bentevi'/);
  assert.match(exportRoute, /public', 'branding', 'bentevi', 'bentevi-wordmark\.png'/);
  assert.match(exportRoute, /document\.embedPng\(logoBytes\)/);
  assert.match(exportRoute, /width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors\.background/);
  assert.match(exportRoute, /Relatório de compras/);
  assert.match(exportRoute, /Bentevi · Documento operacional interno/);
  assert.match(exportRoute, /document\.setAuthor\('Bentevi'\)/);
  assert.doesNotMatch(exportRoute, /Lista de compras DSLite/);
  assert.doesNotMatch(exportRoute, /rgb\(0\.08, 0\.35, 0\.68\)/);
});

test('resume os filtros e indicadores sem criar nova consulta', () => {
  for (const label of ['COMPRAS', 'PIX A CONFIRMAR', 'EM REVISÃO', 'FATURADAS', 'VALOR PIX PENDENTE']) {
    assert.match(exportRoute, new RegExp(label));
  }
  assert.match(exportRoute, /row\.supplierPaymentMode === 'prepaid_pix'/);
  assert.match(exportRoute, /row\.supplierPaymentStatus === 'pending'/);
  assert.match(exportRoute, /sem valor informado/);
  assert.match(exportRoute, /Nenhum filtro — todas as compras/);
  assert.doesNotMatch(exportRoute, /from\('compras'\)/);
});

test('quebra conteúdo, repete cabeçalho e preserva o contrato de download', () => {
  assert.match(exportRoute, /function wrapText\(/);
  assert.match(exportRoute, /height: Math\.max\(MIN_ROW_HEIGHT, standardCellHeight, progressHeight\)/);
  assert.match(exportRoute, /if \(current\.cursor - prepared\.height < TABLE_BOTTOM\)/);
  assert.match(exportRoute, /current = addPage\(false\)/);
  assert.match(exportRoute, /drawTableHeader\(page, tableTop, fonts\)/);
  assert.match(exportRoute, /Nenhuma compra encontrada/);
  assert.match(exportRoute, /'Content-Type': 'application\/pdf'/);
  assert.match(exportRoute, /filename="compras-\$\{date\}\.pdf"/);
});

test('simplifica fornecedor e valores somente na tabela', () => {
  assert.match(page, /purchase\.fornecedor_apelido \|\| purchase\.fornecedor_nome/);
  assert.doesNotMatch(page, />Fornecedor \{formatCurrency\(purchase\.supplier_payment_amount\)\}/);
  assert.doesNotMatch(page, />Fornecedor: a definir</);
  assert.match(page, /<span className=\{styles\.supplierAmount\}>\{formatCurrency\(purchase\.supplier_payment_amount\)\}<\/span>/);
  assert.match(page, /<span className=\{styles\.missingAmount\}>A definir<\/span>/);
  assert.match(drawer, /SKU Bentevi/);
  assert.match(drawer, /SKU do fornecedor/);
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
