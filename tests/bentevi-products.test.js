const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/page.tsx');
const styles = read('src/app/(app)/produtos/produtos.module.css');
const listRoute = read('src/app/api/produtos/route.ts');

test('BNT-D07 organiza produtos por decisão operacional', () => {
  for (const title of ['Produto', 'Disponibilidade', 'Fornecimento', 'Comercial', 'Rentabilidade', 'Mercado Livre', 'Ação']) {
    assert.match(page, new RegExp(`title: '${title}'`));
  }
  assert.match(page, /record\.product\.images\[0\]/);
  assert.match(page, /SKU \{record\.product\.sku\}/);
  assert.match(page, /record\.isKit/);
  assert.match(page, /record\.product\.mlItemId/);
  assert.doesNotMatch(page, /rowSelection=/);
  assert.doesNotMatch(page, /title: 'Taxa ML'/);
  assert.doesNotMatch(page, /title: 'Frete ML'/);
});

test('BNT-D07 exibe a capacidade canônica sem recalculá-la no browser', () => {
  assert.match(listRoute, /loadProductFulfillmentCapacities\(serviceClient, productIds\)/);
  assert.match(listRoute, /fulfillmentCapacity:/);
  assert.match(listRoute, /isKit: kitProductIds\.has\(productId\)/);
  assert.match(page, /record\.fulfillmentCapacity\.safe/);
  assert.match(page, /record\.fulfillmentCapacity\.internal/);
  assert.match(page, /record\.fulfillmentCapacity\.supplier/);
  assert.doesNotMatch(page, /Math\.max\(record\.fulfillmentCapacity/);
  assert.match(page, /record\.fulfillmentCapacity\.safe > 0/);
});

test('BNT-D07 usa o mesmo custo efetivo na leitura comercial e na rentabilidade', () => {
  assert.match(page, /effectiveCost = Number\(item\.preferredOffer\?\.custo \?\? item\.product\.cost/);
  assert.match(page, /Custo \{formatCurrency\(record\.effectiveCost\)\}/);
  assert.match(page, /record\.profit >= 0 \? styles\.profitPositive : styles\.profitNegative/);
  assert.match(page, /profit \/ displayPrice/);
  assert.doesNotMatch(page, /persistCustomPrice/);
  assert.doesNotMatch(page, /savingCustomPriceById/);
});

test('BNT-D07 oferece filas rápidas e filtros remotos avançados', () => {
  for (const label of ['Ativos', 'Com estoque', 'Sem anúncio', 'Margem em risco', 'Inativos']) {
    assert.match(page, new RegExp(`label: '${label}'`));
  }
  assert.match(page, /setPriceField\(view === 'margem_risco' \? 'profit' : 'cost'\)/);
  assert.match(page, /setPriceMax\(view === 'margem_risco' \? 0 : null\)/);
  assert.match(page, /Buscar por produto, SKU, GTIN ou fornecedor/);
  assert.match(page, /Mais filtros/);
  assert.match(page, /params\.set\('fornecedores'/);
  assert.match(page, /params\.set\('ml_status'/);
});

test('BNT-D07 separa publicação do Mercado Livre da tabela', () => {
  assert.match(page, /title=\{`Publicar no Mercado Livre/);
  assert.match(page, /width="min\(96vw, 960px\)"/);
  for (const step of ['Categoria', 'Atributos', 'Conteúdo e fiscal', 'Revisão']) {
    assert.match(page, new RegExp(`title: '${step}'`));
  }
  assert.match(page, /\/api\/ml\/anuncio\/categorias/);
  assert.match(page, /\/api\/ml\/anuncio\/schema/);
  assert.match(page, /\/api\/ml\/anuncio\/criar/);
  assert.match(page, /useMlPricePublishTracking/);
});

test('BNT-D07 possui lista móvel e identidade Bentevi sem comprimir a tabela', () => {
  assert.match(page, /className=\{styles\.mobileList\}/);
  assert.match(page, /title="Filtros de produtos"/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /\.mobileList[\s\S]*?display: none;/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.desktopTable[\s\S]*?display: none;/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.mobileList[\s\S]*?display: flex;/);
  assert.match(styles, /\.productLink[\s\S]*?overflow-wrap: anywhere;/);
});
