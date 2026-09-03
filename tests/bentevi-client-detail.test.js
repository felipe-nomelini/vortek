const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/clientes/[id]/page.tsx');
const styles = read('src/app/(app)/clientes/[id]/cliente-detalhe.module.css');
const route = read('src/app/api/clientes/[id]/route.ts');
const syncRoute = read('src/app/api/sync/pedidos/route.ts');
const ordersPage = read('src/app/(app)/pedidos/page.tsx');
const operationalView = read('src/lib/orders/operational-view.ts');
const { hasPermission } = require('../src/lib/permissions.ts');

test('BNT-D14 organiza identidade, contato, endereço e resumo do cliente', () => {
  for (const content of ['Identidade', 'Contato', 'Endereço', 'Pedidos', 'Última compra', 'Cliente desde']) {
    assert.match(page, new RegExp(content));
  }
  assert.match(page, /Mercado Livre/);
  assert.match(page, /Informações mantidas pela equipe/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /\.summaryBand/);
  assert.match(styles, /\.infoGrid/);
});

test('BNT-D14 edita somente contato local em modal contextual', () => {
  assert.match(page, /title="Editar contato"/);
  assert.match(page, /<Form<ClienteContactUpdate>/);
  assert.match(page, /name="email"/);
  assert.match(page, /name="phone"/);
  assert.match(page, /hasPermission\(role, 'customers\.manage'\)/);
  assert.match(page, /Nome, documento e endereço continuam sendo atualizados pelo Mercado Livre/);
  assert.doesNotMatch(page, /name="document"|name="address"|name="name"/);
});

test('BNT-D14 apresenta histórico paginado e reutiliza venda e tracking canônicos', () => {
  for (const column of ['Data', 'Venda ML', 'Valor', 'Status', 'Entrega', 'Ações']) {
    assert.match(page, new RegExp(`title: '${column}'`));
  }
  assert.match(page, /Pack #\$\{order\.packId\}/);
  assert.match(page, /Venda #\$\{order\.saleId\}/);
  assert.match(page, /\/pedidos\?venda=\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(page, /<TrackingModal/);
  assert.match(page, /order\.isHomologationFixture/);
  assert.match(page, /pageSize: detail\.pageSize/);
});

test('API BNT-D14 usa autorização, DTO explícito e vínculo oficial do comprador', () => {
  assert.match(route, /authorizeApiRequest\(request, 'sales\.read'\)/);
  assert.match(route, /clientIdSchema = z\.string\(\)\.uuid\(\)/);
  assert.match(route, /\.eq\('buyer_ml_id', client\.mlId\)/);
  assert.match(route, /count: 'exact'/);
  assert.match(route, /\.range\(from, to\)/);
  assert.match(route, /pageSize: PAGE_SIZE/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /contato_nome|\.ilike\(/);
  assert.doesNotMatch(route, /\.select\(['"]\*['"]\)/);
});

test('PATCH BNT-D14 valida e altera exclusivamente e-mail e telefone', () => {
  assert.match(route, /authorizeApiRequest\(request, 'customers\.manage'\)/);
  assert.match(route, /contactSchema = z\.object/);
  assert.match(route, /\.strict\(\)/);
  assert.match(route, /\.update\(\{ email: update\.email, telefone: update\.phone \}\)/);
  assert.doesNotMatch(route, /updateData|Object\.entries\(body/);
});

test('sincronização preserva contato local e só inicializa campos no cadastro', () => {
  assert.match(syncRoute, /const synchronizedPayload = \{/);
  assert.match(syncRoute, /\.update\(synchronizedPayload as any\)/);
  assert.match(syncRoute, /\.insert\(\{ \.\.\.synchronizedPayload, email: '', telefone: '' \} as any\)/);
  const synchronizedPayload = syncRoute.match(/const synchronizedPayload = \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.doesNotMatch(synchronizedPayload, /email|telefone/);
});

test('gestão e operador editam contato; visualizador permanece em leitura', () => {
  for (const role of ['admin', 'gerente', 'operador']) {
    assert.equal(hasPermission(role, 'customers.manage'), true);
  }
  assert.equal(hasPermission('visualizador', 'customers.manage'), false);
});

test('status das vendas têm uma única apresentação compartilhada', () => {
  assert.match(page, /ORDER_STATUS_COLORS/);
  assert.match(page, /ORDER_STATUS_LABELS/);
  assert.match(ordersPage, /ORDER_STATUS_COLORS/);
  assert.match(ordersPage, /ORDER_STATUS_LABELS/);
  assert.match(operationalView, /export const ORDER_STATUS_OPTIONS/);
  assert.match(operationalView, /export const ORDER_STATUS_COLORS/);
});
