const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/anuncios/page.tsx');
const route = read('src/app/api/anuncios/exportar-pdf/route.ts');

test('BNT-D11-PDF usa identidade dark Bentevi e metadados atuais', () => {
  assert.match(route, /import \{ benteviColors \} from '@\/theme\/bentevi'/);
  assert.match(route, /public', 'branding', 'bentevi', 'bentevi-wordmark\.png'/);
  assert.match(route, /document\.embedPng\(logoBytes\)/);
  assert.match(route, /width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors\.background/);
  assert.match(route, /Relatório de anúncios/);
  assert.match(route, /Bentevi · Documento operacional interno/);
  assert.match(route, /document\.setAuthor\('Bentevi'\)/);
  assert.doesNotMatch(route, /Lista de anúncios - Mercado Livre/);
  assert.doesNotMatch(route, /rgb\(0\.08, 0\.35, 0\.68\)/);
});

test('BNT-D11-PDF espelha a hierarquia operacional aprovada de Anúncios', () => {
  for (const column of ['Anúncio', 'Produto', 'Preço e resultado', 'Desempenho', 'Qualidade', 'Estado', 'Catálogo']) {
    assert.match(route, new RegExp(`label: '${column}'`));
  }
  for (const field of [
    'listingType', 'catalogProductId', 'relatedItemId', 'price', 'profit', 'marginPercent',
    'sold', 'visits', 'qualityScore', 'qualityPrimaryIssue', 'observedStatus', 'blockReason',
    'lastError', 'catalogStatus', 'priceToWin', 'isOperational', 'latestPublish',
  ]) {
    assert.match(route, new RegExp(field));
  }
  assert.match(route, /Anúncio de catálogo/);
  assert.match(route, /Anúncio padrão/);
  assert.match(route, /Preço para ganhar/);
  assert.match(route, /SKU Bentevi/);
  assert.doesNotMatch(route, /label: 'Ações'/);
});

test('BNT-D11-PDF reutiliza a listagem canônica sem consulta paralela nem recálculo', () => {
  assert.match(route, /import \{ GET as getListings \} from '@\/app\/api\/anuncios\/route'/);
  assert.match(route, /await getListings\(new Request\(listUrl, \{ headers \}\)\)/);
  assert.match(route, /headers\.set\('x-vortek-read-only', '1'\)/);
  assert.match(route, /while \(rows\.length < total\)/);
  assert.doesNotMatch(route, /createClient|createServiceClient/);
  assert.doesNotMatch(route, /calculateNetProfitAtPrice|calculateSuggestedPrice/);
  assert.doesNotMatch(route, /\.from\('anuncios_ml'\)/);
});

test('BNT-D11-PDF resume exatamente o conjunto exportado', () => {
  for (const label of ['ANÚNCIOS', 'ATIVOS', 'PAUSADOS', 'QUALIDADE EM RISCO', 'PREÇO EM REVISÃO']) {
    assert.match(route, new RegExp(label));
  }
  assert.match(route, /row\.qualityAvailable && row\.qualityScore !== null && row\.qualityScore < 80/);
  assert.match(route, /row\.listingType === 'catalog'/);
  assert.match(route, /row\.catalogStatus !== 'ganhando'/);
  assert.match(route, /Nenhum filtro — todos os anúncios/);
  assert.match(route, /FILTROS E ORDENAÇÃO/);
});

test('BNT-D11-PDF preserva todos os filtros e a ordenação da página', () => {
  for (const filter of ['search', 'focus', 'quality', 'catalog', 'profitability', 'priceMin', 'priceMax', 'sortBy', 'sortOrder']) {
    assert.match(route, new RegExp(`'${filter}'`));
  }
  assert.match(page, /new URLSearchParams\(\{ focus, quality, catalog, profitability \}\)/);
  assert.match(page, /appendRemoteSortParams\(params, sort\)/);
  assert.match(page, /params\.set\('priceMin'/);
  assert.match(page, /params\.set\('priceMax'/);
  assert.match(page, /Exportar o conjunto filtrado em PDF/);
});

test('BNT-D11-PDF trata conteúdo longo, paginação, vazio e download', () => {
  assert.match(route, /function wrapText\(/);
  assert.match(route, /function prepareRowFragments\(/);
  assert.match(route, /LINES_PER_FRAGMENT/);
  assert.match(route, /'Continuação'/);
  assert.match(route, /if \(current\.cursor - prepared\.height < TABLE_BOTTOM\) current = addPage\(false\)/);
  assert.match(route, /drawTableHeader\(page, first \? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP/);
  assert.match(route, /Nenhum anúncio encontrado/);
  assert.match(route, /'Content-Type': 'application\/pdf'/);
  assert.match(route, /filename=\"anuncios-mercado-livre-\$\{date\}\.pdf\"/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});
