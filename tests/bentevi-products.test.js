const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/page.tsx');
const styles = read('src/app/(app)/produtos/produtos.module.css');
const listRoute = read('src/app/api/produtos/route.ts');
const summaryRoute = read('src/app/api/produtos/resumo/route.ts');
const visualReview = read('src/lib/products/bnt-d07-visual-review.ts');
const priceRoute = read('src/app/api/ml/anuncio/atualizar-preco/route.ts');

test('BNT-D07 organiza produtos por decisão operacional', () => {
  for (const title of ['Produto', 'Disponibilidade', 'Fornecimento', 'Comercial', 'Rentabilidade', 'Mercado Livre', 'Ações']) {
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

test('BNT-D07 usa amostra real temporária sem criar produtos operacionais', () => {
  assert.match(visualReview, /bnt_d07_visual_review_enabled/);
  assert.match(visualReview, /bnt_d07_visual_review_products/);
  assert.match(visualReview, /EXPECTED_SOURCE = 'production-read-only'/);
  assert.match(visualReview, /Date\.parse\(payload\.expiresAt\) <= Date\.now\(\)/);
  assert.match(visualReview, /startsWith\('bnt-d07-review-'\)/);
  assert.match(listRoute, /loadBntD07VisualReview\(\)/);
  assert.match(listRoute, /listBntD07VisualReview/);
  assert.match(summaryRoute, /summarizeBntD07VisualReview/);
  assert.doesNotMatch(visualReview, /\.from\('produtos'\)/);
  assert.doesNotMatch(visualReview, /\.insert\(/);
  assert.doesNotMatch(visualReview, /\.upsert\(/);
});

test('BNT-D07 bloqueia ações e navegação durante a revisão protegida', () => {
  assert.match(page, /Amostra real de produção, somente leitura/);
  assert.match(page, /Ações, navegação e exportação estão desabilitadas/);
  assert.match(page, /disabled=\{Boolean\(visualReview\)\}/);
  assert.match(page, /if \(visualReview\) \{[\s\S]*?primary\.label/);
  assert.match(page, /Ação desabilitada na amostra protegida/);
  assert.match(page, /visualReview \? \([\s\S]*?productNameReadonly/);
  assert.match(page, /visualReview \? \([\s\S]*?mobileProductNameReadonly/);
  assert.match(page, /if \(visualReview\) \{[\s\S]*?amostra de homologação é somente leitura/);
});

test('BNT-D07 representa anúncios padrão e catálogo sem multiplicar tags', () => {
  assert.match(listRoute, /from\('anuncios_ml'\)/);
  assert.match(listRoute, /from\('catalogo_ml_snapshot'\)/);
  assert.match(listRoute, /mlListings: mlListingsByProductId\.get\(productId\) \|\| \[\]/);
  assert.match(page, /listing\.type === 'catalog' \? 'Catálogo' : 'Padrão'/);
  assert.match(page, /listing\.catalogStatus === 'ganhando'/);
  assert.match(styles, /\.mlOverallStatus[\s\S]*?width: fit-content/);
  assert.match(styles, /\.mlListingLine/);
});

test('BNT-D07 permite definir um preço único para todos os anúncios vinculados', () => {
  assert.match(page, /Novo preço de venda/);
  assert.match(page, /scope: 'linked'/);
  assert.match(page, /Este preço gera prejuízo/);
  assert.match(page, /Aplicar nos anúncios/);
  assert.match(priceRoute, /body\?\.scope === 'linked'/);
  assert.match(priceRoute, /\.in\('status', \['ativo', 'pausado'\]\)/);
  assert.match(priceRoute, /JSON\.stringify\(\{ price: basePrice \}\)/);
  assert.match(priceRoute, /custom_price: basePrice/);
  assert.match(priceRoute, /results\.map/);
});

test('BNT-D07 bloqueia preço automatizado antes de persistir o valor desejado', () => {
  assert.match(priceRoute, /dynamic_standard_price/);
  assert.match(priceRoute, /const targets = await resolveTargets/);
  assert.match(priceRoute, /const \{ error: persistError \}/);
  assert.ok(
    priceRoute.indexOf('const targets = await resolveTargets') < priceRoute.indexOf('const { error: persistError }'),
    'preflight dos anúncios deve ocorrer antes da persistência local',
  );
  assert.match(priceRoute, /if \(!user\).*status: 401/);
});

test('BNT-D07 filtra a amostra por capacidade segura e preserva filtros remotos', () => {
  assert.match(visualReview, /item\.fulfillmentCapacity\.safe <= 0/);
  assert.match(visualReview, /item\.fulfillmentCapacity\.safe !== 0/);
  assert.match(visualReview, /filters\.supplierDsliteIds/);
  assert.match(visualReview, /filters\.productActiveStatus/);
  assert.match(visualReview, /filters\.mlStatus/);
  assert.match(visualReview, /filters\.priceField/);
  assert.match(visualReview, /localeCompare/);
});
