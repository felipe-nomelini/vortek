const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/app/api/pedidos/exportar-pdf/route.ts'), 'utf8');

test('BNT-D01-PDF usa a identidade dark Bentevi e metadados atuais', () => {
  assert.match(route, /import \{ benteviColors \} from '@\/theme\/bentevi'/);
  assert.match(route, /public', 'branding', 'bentevi', 'bentevi-wordmark\.png'/);
  assert.match(route, /document\.embedPng\(logoBytes\)/);
  assert.match(route, /width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors\.background/);
  assert.match(route, /Relatório de vendas/);
  assert.match(route, /Bentevi · Documento operacional interno/);
  assert.match(route, /document\.setAuthor\('Bentevi'\)/);
  assert.doesNotMatch(route, /Lista de vendas/);
  assert.doesNotMatch(route, /rgb\(0\.08, 0\.35, 0\.68\)/);
});

test('BNT-D01-PDF organiza o relatório pelos dados aprovados da venda', () => {
  for (const column of [
    'Data', 'Venda ML', 'Cliente', 'Produtos e SKUs',
    'Valores', 'Origem', 'Andamento', 'Fiscal e entrega',
  ]) {
    assert.match(route, new RegExp(`label: '${column}'`));
  }
  for (const field of [
    'saleId', 'packId', 'bundleKind', 'fiscalClient', 'products', 'dsliteIds',
    'invoiceNumbers', 'shipmentId', 'tracking', 'labelRelease', 'claimId',
  ]) {
    assert.match(route, new RegExp(field));
  }
  assert.match(route, /Qtd\. \$\{product\.quantity\} · SKU \$\{product\.sku\}/);
  assert.match(route, /Item ML \$\{product\.mlItemId\}/);
  assert.doesNotMatch(route, /label: 'Próxima ação'/);
});

test('BNT-D01-PDF reutiliza andamento e urgência canônicos', () => {
  assert.match(route, /getOrderSalesProgress\(row\)/);
  assert.match(route, /getOperationalUrgencyReasons\(row\)/);
  assert.match(route, /SALES_PROGRESS_STAGES\.length/);
  assert.match(route, /Etapa \$\{prepared\.progress\.currentStep\}/);
  assert.match(route, /Próxima: \$\{row\.progress\.nextLabel\}/);
  assert.doesNotMatch(route, /const SALES_PROGRESS_STAGES/);
});

test('BNT-D01-PDF resume somente o conjunto exportado sem nova fonte', () => {
  for (const label of ['VENDAS', 'VALOR DAS VENDAS', 'LUCRO CONHECIDO', 'URGENTES', 'ENTREGUES']) {
    assert.match(route, new RegExp(label));
  }
  assert.match(route, /normalizeStatus\(row\.statusRaw\) !== 'cancelado'/);
  assert.match(route, /row\.profit == null \|\| row\.profitPending/);
  assert.match(route, /row\.urgencyReasons\.length > 0/);
  assert.doesNotMatch(route, /from\('pedidos'/);
  assert.doesNotMatch(route, /\/api\/pedidos\/resumo/);
});

test('BNT-D01-PDF preserva conteúdo longo, continuação e paginação', () => {
  assert.match(route, /function wrapText\(/);
  assert.match(route, /function splitLongWord\(/);
  assert.match(route, /PRODUCT_LINES_PER_FRAGMENT/);
  assert.match(route, /function prepareRowFragments\(/);
  assert.match(route, /Itens \$\{fragmentIndex \+ 1\}\/\$\{productChunks\.length\}/);
  assert.match(route, /makeLines\('Continuação'/);
  assert.match(route, /if \(current\.cursor - prepared\.height < TABLE_BOTTOM\)/);
  assert.match(route, /drawTableHeader\(page, first \? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP/);
  assert.match(route, /Nenhuma venda encontrada/);
});

test('BNT-D01-PDF preserva autenticação, filtros e download', () => {
  assert.match(route, /authorizeApiRequest\(request, 'sales\.read'\)/);
  for (const filter of [
    'search', 'status', 'dateFrom', 'dateTo', 'priceMin', 'priceMax',
    'fornecedores', 'operationalView', 'sortBy', 'sortOrder',
  ]) {
    assert.match(route, new RegExp(`'${filter}'`));
  }
  assert.match(route, /headers\.set\('x-vortek-read-only', '1'\)/);
  assert.match(route, /'Content-Type': 'application\/pdf'/);
  assert.match(route, /filename="vendas-\$\{date\}\.pdf"/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});
