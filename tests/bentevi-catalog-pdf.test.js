const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const view = read('src/components/catalogo/CatalogoView.tsx');
const route = read('src/app/api/catalogo/no-catalogo/exportar-pdf/route.ts');

test('BNT-D12-PDF usa identidade dark Bentevi e metadados atuais', () => {
  assert.match(route, /import \{ benteviColors \} from '@\/theme\/bentevi'/);
  assert.match(route, /public', 'branding', 'bentevi', 'bentevi-wordmark\.png'/);
  assert.match(route, /document\.embedPng\(logoBytes\)/);
  assert.match(route, /width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors\.background/);
  assert.match(route, /Relatório de catálogo/);
  assert.match(route, /Bentevi · Documento operacional interno/);
  assert.match(route, /document\.setAuthor\('Bentevi'\)/);
  assert.doesNotMatch(route, /Anúncios no catálogo/);
  assert.doesNotMatch(route, /rgb\(0\.08, 0\.35, 0\.68\)/);
});

test('BNT-D12-PDF torna explícita a relação aprovada do catálogo', () => {
  for (const column of ['Anúncio de catálogo', 'Produto Bentevi', 'Relação no catálogo', 'Competição', 'Preço e resultado']) {
    assert.match(route, new RegExp(`label: '${column}'`));
  }
  for (const field of ['relatedItemId', 'relatedStatus', 'catalogProductId', 'competitionStatus', 'priceToWin']) {
    assert.match(route, new RegExp(field));
  }
  assert.match(route, /COMO O CATÁLOGO SE RELACIONA/);
  assert.match(route, /Anúncio padrão/);
  assert.match(route, /Produto de catálogo/);
  assert.match(route, /Anúncio de catálogo/);
  assert.doesNotMatch(route, /label: 'Ação'/);
});

test('BNT-D12-PDF reutiliza a listagem canônica e inclui a amostra protegida sem consulta paralela', () => {
  assert.match(route, /import \{ GET as getCatalogListings \} from '@\/app\/api\/catalogo\/no-catalogo\/route'/);
  assert.match(route, /await getCatalogListings\(new Request\(listUrl, \{ headers \}\)\)/);
  assert.match(route, /headers\.set\('x-vortek-read-only', '1'\)/);
  assert.match(route, /while \(rows\.length < total\)/);
  assert.doesNotMatch(route, /createClient|createServiceClient/);
  assert.doesNotMatch(route, /\.from\('catalogo_ml_snapshot'\)/);
  assert.doesNotMatch(route, /api\.mercadolibre\.com/);
});

test('BNT-D12-PDF preserva filtros, ordenação e a visão temporária de oportunidades', () => {
  for (const filter of ['search', 'statusMl', 'buyBox', 'priceMin', 'priceMax', 'sortBy', 'sortOrder', 'sellerId']) {
    assert.match(route, new RegExp(`'${filter}'`));
  }
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /normalizeOpportunityIds\(body\?\.opportunityIds\)/);
  assert.match(route, /rows\.filter\(\(row\) => opportunityIds\.has\(row\.itemId\.toUpperCase\(\)\)\)/);
  assert.match(view, /method: 'POST'/);
  assert.match(view, /opportunityIds: opportunityIds \? Array\.from\(opportunityIds\) : undefined/);
  assert.match(view, /params\.delete\('page'\)/);
  assert.match(view, /params\.delete\('pageSize'\)/);
});

test('BNT-D12-PDF mantém estados de competição e resume o conjunto exportado', () => {
  for (const state of ['winning', 'sharing_first_place', 'competing', 'outside', 'not_listed']) {
    assert.match(route, new RegExp(state));
  }
  for (const label of ['ANÚNCIOS', 'GANHANDO', 'DIVIDINDO 1º LUGAR', 'COMPETINDO', 'FORA DA COMPETIÇÃO']) {
    assert.match(route, new RegExp(label));
  }
  assert.match(route, /not_listed · legado observado/);
  assert.match(route, /Preço para ganhar não informado/);
  assert.match(route, /Diferença/);
});

test('BNT-D12-PDF trata conteúdo longo, paginação, vazio e download', () => {
  assert.match(route, /function wrapText\(/);
  assert.match(route, /function prepareRowFragments\(/);
  assert.match(route, /LINES_PER_FRAGMENT/);
  assert.match(route, /'Continuação'/);
  assert.match(route, /if \(current\.cursor - prepared\.height < TABLE_BOTTOM\) current = addPage\(false\)/);
  assert.match(route, /drawTableHeader\(page, first \? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP/);
  assert.match(route, /Nenhum anúncio de catálogo encontrado/);
  assert.match(route, /'Content-Type': 'application\/pdf'/);
  assert.match(route, /filename=\"catalogo-mercado-livre-\$\{date\}\.pdf\"/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(view, /response\.headers\.get\('Content-Disposition'\)/);
});

test('BNT-D12-PDF permanece exclusivo da visão de anúncios de catálogo', () => {
  const button = "mode === 'no_catalogo' && <Button icon={<FilePdfOutlined />}";
  assert.match(view, new RegExp(button.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((view.match(/<FilePdfOutlined \/>/g) || []).length, 1);
  assert.doesNotMatch(route, /getEligible|catalogo\/elegiveis/);
});
