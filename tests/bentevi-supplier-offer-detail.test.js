const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/ofertas/[id]/page.tsx');
const styles = read('src/app/(app)/produtos/ofertas/[id]/oferta.module.css');
const route = read('src/app/api/produtos/ofertas/[id]/route.ts');
const domain = read('src/lib/products/supplier-offers.ts');

test('BNT-D10 organiza o detalhe por domínio e origem dos dados', () => {
  for (const label of [
    'Oferta',
    'Fornecedor',
    'Produto e Mercado Livre',
    'Fiscal',
    'Descrição',
    'Ofertas relacionadas',
  ]) assert.match(page, new RegExp(label));

  assert.match(route, /DSLite · sincronizado/);
  assert.match(route, /Bentevi · configuração/);
  assert.match(route, /Bentevi · calculado/);
  assert.match(route, /Bentevi · cadastro mestre/);
  assert.match(styles, /var\(--bentevi-primary/);
});

test('BNT-D10 usa DTO explícito e regras canônicas no backend', () => {
  assert.match(route, /classifySupplierOffer/);
  assert.match(route, /loadProductMlListings/);
  assert.match(route, /lowestEligibleCost/);
  assert.match(route, /preferenceMode/);
  assert.match(route, /relatedOffers/);
  assert.doesNotMatch(page, /classifySupplierOffer|Math\.min\(.*cost/);
  assert.doesNotMatch(route, /\.select\('\*'\)/);
});

test('BNT-D10 abre a amostra protegida sem permitir mutação', () => {
  assert.match(domain, /findBntD09VisualReviewOffer/);
  assert.match(route, /findBntD09VisualReviewOffer/);
  assert.match(route, /listBntD09VisualReview/);
  assert.match(route, /fixture: true/);
  assert.match(route, /readOnly: params\.fixture \|\| historical/);
  assert.match(page, /Amostra real protegida para homologação/);
  assert.match(page, /alterações e links externos continuam bloqueados/);
  assert.match(page, /row\.permalink && !isFixture/);
});

test('BNT-D10 edita apenas configurações existentes com confirmação explícita', () => {
  assert.match(page, /Nenhuma alteração é salva automaticamente/);
  assert.match(page, /payload\.ativo = draft\.active/);
  assert.match(page, /payload\.prioridade = draft\.priority/);
  assert.match(page, /payload\.payment_mode = draft\.paymentMode/);
  assert.match(page, /Salvar configurações da oferta\?/);
  assert.match(page, /response\.status === 207 \|\| pricingErrors > 0/);
  assert.doesNotMatch(page, /onBlur=|void persistChanges/);
});

test('BNT-D10 preserva históricos aposentados somente para leitura', () => {
  assert.match(route, /currentRow\.status === 'historical'/);
  assert.match(route, /Fornecedor ou modalidade de pagamento mantidos somente para histórico/);
  assert.match(page, /Histórico somente leitura/);
  assert.match(page, /Conta-saldo aposentada/);
});
