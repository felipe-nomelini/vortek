const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/page.tsx');
const route = read('src/app/api/produtos/exportar-pdf/route.ts');

test('BNT-D07-PDF usa a identidade dark Bentevi e metadados atuais', () => {
  assert.match(route, /import \{ benteviColors \} from '@\/theme\/bentevi'/);
  assert.match(route, /public', 'branding', 'bentevi', 'bentevi-wordmark\.png'/);
  assert.match(route, /document\.embedPng\(logoBytes\)/);
  assert.match(route, /width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors\.background/);
  assert.match(route, /Relatório de produtos/);
  assert.match(route, /Bentevi · Documento operacional interno/);
  assert.match(route, /document\.setAuthor\('Bentevi'\)/);
  assert.doesNotMatch(route, /Lista de produtos/);
  assert.doesNotMatch(route, /rgb\(0\.08, 0\.35, 0\.68\)/);
});

test('BNT-D07-PDF espelha a hierarquia operacional aprovada de Produtos', () => {
  for (const column of ['Produto', 'Disponibilidade', 'Fornecimento', 'Comercial', 'Rentabilidade', 'Mercado Livre']) {
    assert.match(route, new RegExp(`label: '${column}'`));
  }
  for (const field of [
    'safeQuantity', 'internalQuantity', 'supplierQuantity', 'offersCount',
    'preferredSupplierManual', 'displayPrice', 'profit', 'margin', 'mlListings',
  ]) {
    assert.match(route, new RegExp(field));
  }
  assert.match(route, /Q segura \$\{row\.safeQuantity\} un\./);
  assert.match(route, /listing\.type === 'catalog' \? 'Catálogo' : 'Padrão'/);
  assert.match(route, /catalogStatusLabel\(listing\.catalogStatus\)/);
  assert.doesNotMatch(route, /label: 'Ações'/);
  assert.doesNotMatch(route, /label: 'Taxa ML'/);
});

test('BNT-D07-PDF reutiliza a listagem canônica sem consulta paralela de produtos', () => {
  assert.match(route, /import \{ GET as getProducts \} from '@\/app\/api\/produtos\/route'/);
  assert.match(route, /await getProducts\(new Request\(listUrl, \{ headers \}\)\)/);
  assert.match(route, /headers\.set\('x-vortek-read-only', '1'\)/);
  assert.match(route, /while \(items\.length < total\)/);
  assert.match(route, /calculateSuggestedPrice/);
  assert.match(route, /calculateNetProfitAtPrice/);
  assert.doesNotMatch(route, /search_produtos_paginated/);
  assert.doesNotMatch(route, /createServiceClient/);
  assert.doesNotMatch(route, /\.from\('produtos'\)/);
});

test('BNT-D07-PDF resume o mesmo conjunto exportado', () => {
  for (const label of ['PRODUTOS', 'COM Q SEGURA', 'SEM ANÚNCIO', 'RECEITA POTENCIAL', 'LUCRO MÉDIO']) {
    assert.match(route, new RegExp(label));
  }
  assert.match(route, /row\.displayPrice \* row\.safeQuantity/);
  assert.match(route, /row\.profit === null/);
  assert.match(route, /Nenhum filtro — todos os produtos/);
  assert.match(route, /FILTROS E ORDENAÇÃO/);
});

test('BNT-D07-PDF preserva filtros, conteúdo longo, continuação e download', () => {
  for (const filter of [
    'search', 'fornecedores', 'ativo', 'ml_status', 'estoque',
    'priceMin', 'priceMax', 'priceField', 'sortBy', 'sortOrder',
  ]) {
    assert.match(route, new RegExp(`'${filter}'`));
  }
  assert.match(route, /function wrapText\(/);
  assert.match(route, /MARKETPLACE_LINES_PER_FRAGMENT/);
  assert.match(route, /function prepareRowFragments\(/);
  assert.match(route, /fragmentIndex > 0 \? 'Continuação'/);
  assert.match(route, /if \(current\.cursor - prepared\.height < TABLE_BOTTOM\)/);
  assert.match(route, /Nenhum produto encontrado/);
  assert.match(route, /'Content-Type': 'application\/pdf'/);
  assert.match(route, /filename=\"produtos-\$\{date\}\.pdf\"/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});

test('BNT-D07-PDF permite somente o relatório da amostra protegida', () => {
  assert.match(page, /O detalhe e o relatório PDF estão disponíveis somente para leitura/);
  assert.match(page, /onClick=\{\(\) => void handleExportPdf\(\)\}/);
  const pdfButtonStart = page.indexOf('icon={<FilePdfOutlined />}');
  const pdfButtonEnd = page.indexOf('</Button>', pdfButtonStart);
  assert.ok(pdfButtonStart >= 0 && pdfButtonEnd > pdfButtonStart);
  assert.doesNotMatch(
    page.slice(pdfButtonStart, pdfButtonEnd),
    /disabled=/,
  );
  assert.match(page, /Demais ações desabilitadas na amostra protegida/);
});
