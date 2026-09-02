const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/[id]/page.tsx');
const styles = read('src/app/(app)/produtos/[id]/produto-detalhe.module.css');
const detailRoute = read('src/app/api/produtos/[id]/route.ts');
const suppliersRoute = read('src/app/api/produtos/[id]/fornecedores/route.ts');
const listRoute = read('src/app/api/produtos/route.ts');
const visualReview = read('src/lib/products/bnt-d07-visual-review.ts');
const listingLoader = read('src/lib/ml/product-listings.ts');

test('BNT-D08 organiza o detalhe por resumo e domínios operacionais', () => {
  for (const label of ['Cadastro', 'Fornecimento', 'Comercial e estoque', 'Logística e fiscal', 'Mercado Livre', 'Descrição']) {
    assert.match(page, new RegExp(label));
  }
  for (const summary of ['Q segura', 'Fornecedor atual', 'Custo', 'Preço', 'Lucro']) {
    assert.match(page, new RegExp(summary));
  }
  assert.match(page, /className=\{styles\.stickyHeader\}/);
  assert.match(page, /Image\.PreviewGroup/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.doesNotMatch(page, /const cardStyle/);
  assert.doesNotMatch(page, /#1677ff/);
});

test('BNT-D08 abre em consulta e habilita edição contextual com descarte seguro', () => {
  assert.match(page, /disabled=\{Boolean\(visualReview\) \|\| isEditing\}/);
  assert.match(page, /onClick=\{\(\) => setIsEditing\(true\)\}/);
  assert.match(page, /Descartar alterações\?/);
  assert.match(page, /beforeunload/);
  assert.match(page, /Alterações pendentes/);
  assert.match(page, /Salvar alterações/);
  assert.match(page, /setProduct\(original \? \{ \.\.\.original \} : original\)/);
});

test('BNT-D08 informa efeitos externos e respeita o retorno real do PATCH', () => {
  assert.match(page, /pausar o anúncio operacional vinculado/);
  assert.match(page, /recalcular e publicar a quantidade segura/);
  assert.match(page, /json\.queued_publish/);
  assert.match(page, /json\.warning/);
  assert.match(page, /origem_fiscal: product\.originFiscal/);
  assert.match(page, /csosn: product\.csosn/);
});

test('BNT-D08 recebe Q segura e anúncios do backend sem recalcular no browser', () => {
  assert.match(detailRoute, /loadProductFulfillmentCapacity\(supabase/);
  assert.match(detailRoute, /loadProductMlListings\(supabase/);
  assert.match(detailRoute, /fulfillmentCapacity: capacity/);
  assert.match(detailRoute, /mlListings: listings/);
  assert.match(page, /productJson\?\.fulfillmentCapacity\?\.safe/);
  assert.doesNotMatch(page, /Math\.max\([^\n]*capacity/);
});

test('BNT-D08 reutiliza a mesma leitura de anúncios da lista de Produtos', () => {
  assert.match(listRoute, /import \{ loadProductMlListings \} from '@\/lib\/ml\/product-listings'/);
  assert.match(detailRoute, /import \{ loadProductMlListings \} from '@\/lib\/ml\/product-listings'/);
  assert.match(listingLoader, /from\('anuncios_ml'\)/);
  assert.match(listingLoader, /from\('catalogo_ml_snapshot'\)/);
  assert.match(listingLoader, /listing\.type === 'catalog'/);
  assert.match(page, /Anúncio de catálogo/);
  assert.match(page, /Anúncio padrão/);
});

test('BNT-D08 preserva ofertas, preferência e composição de kit', () => {
  assert.match(page, /Automático · menor custo/);
  assert.match(page, /Alterar fornecedor preferencial\?/);
  for (const column of ['SKU externo', 'Estoque', 'Custo', 'Prazo', 'Pagamento', 'Última sincronização']) {
    assert.match(page, new RegExp(column));
  }
  assert.match(page, /Composição do kit/);
  assert.match(page, /kitSupplierOffer\.kit_components/);
  assert.match(suppliersRoute, /syncPreferredProductSnapshot/);
});

test('BNT-D08 usa a amostra real sem liberar mutações ou links externos', () => {
  assert.match(visualReview, /supplierOffers\?: Array/);
  assert.match(visualReview, /findBntD07VisualReviewItem/);
  assert.match(detailRoute, /findBntD07VisualReviewItem/);
  assert.match(suppliersRoute, /findBntD07VisualReviewItem/);
  assert.match(detailRoute, /homologation_fixture_read_only/);
  assert.match(suppliersRoute, /homologation_fixture_read_only/);
  assert.match(page, /Edição, troca de fornecedor e links externos estão desabilitados/);
  assert.match(page, /listing\.permalink && !visualReview/);
});

test('BNT-D08 prioriza resumo antes da galeria no web celular', () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.heroSummary \{ order: -1; \}/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /\.editBar[\s\S]*?position: fixed/);
});
