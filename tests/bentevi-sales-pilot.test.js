const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/(app)/pedidos/page.tsx'), 'utf8');
const drawer = fs.readFileSync(path.join(root, 'src/components/pedidos/PedidoDetailsDrawer.tsx'), 'utf8');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('BNT-D01 persiste o estado operacional relevante na URL', () => {
  for (const key of [
    'view', 'search', 'status', 'fornecedores', 'dateFrom', 'dateTo',
    'priceMin', 'priceMax', 'page', 'sortBy', 'sortOrder',
  ]) {
    assert.match(page, new RegExp(`['\"]${key}['\"]`), `parâmetro ${key} deve ser persistido`);
  }
  assert.match(page, /window\.history\.replaceState/);
});

test('BNT-D01 apresenta somente ações autorizadas para o cargo atual', () => {
  assert.match(page, /fetch\('\/api\/auth\/me'/);
  assert.match(page, /hasPermission\(role, permission\)/);
  for (const permission of [
    'sales.track',
    'sales.dslite.create',
    'sales.internal_shipping.process',
    'sales.dslite.label.complete',
    'sales.dslite.resume',
    'purchases.payment.confirm',
    'sales.whatsapp_label.send',
    'sales.dslite.unlink',
  ]) {
    assert.match(page, new RegExp(permission.replaceAll('.', '\\.')));
  }
});

test('BNT-D01 mantém lista e resumo independentes e preserva dados em falha de refresh', () => {
  assert.match(page, /listLoading/);
  assert.match(page, /summaryLoading/);
  assert.match(page, /listError/);
  assert.match(page, /summaryError/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /Os dados anteriores foram preservados/);
});

test('BNT-D01 identifica a amostra real e informa que ela é somente leitura', () => {
  assert.match(page, /isHomologationFixtureSource\(item\.snapshot_source\)/);
  assert.match(page, /Amostra real protegida para homologação/);
  assert.match(page, /order\.is_homologation_fixture && operational\.key !== 'view'/);
  assert.match(drawer, /Amostra protegida de homologação/);
  assert.match(drawer, /disabled=\{order\.is_homologation_fixture\}/);
});

test('BNT-D01 bloqueia os endpoints operacionais da amostra antes de efeitos externos', () => {
  const guardedRoutes = [
    'src/app/api/dslite/pedido/route.ts',
    'src/app/api/dslite/frete/route.ts',
    'src/app/api/dslite/etiqueta-auto/route.ts',
    'src/app/api/dslite/desvincular-local/route.ts',
    'src/app/api/pedidos/[id]/enviar-etiqueta-whatsapp/route.ts',
    'src/app/api/compras/[id]/confirmar-pagamento/route.ts',
    'src/app/api/compras/[id]/enviar-etiqueta-whatsapp/route.ts',
    'src/app/api/pedidos/[id]/tracking/route.ts',
    'src/app/api/pedidos/[id]/etiqueta/route.ts',
    'src/app/api/notas-fiscais/[id]/pdf/route.ts',
    'src/app/api/notas-fiscais/[id]/pdf/download/route.ts',
    'src/app/api/notas-fiscais/[id]/xml/route.ts',
    'src/app/api/notas-fiscais/[id]/cancelar/route.ts',
    'src/app/api/notas-fiscais/[id]/carta-correcao/route.ts',
    'src/app/api/notas-fiscais/[id]/enviar-email/route.ts',
  ];

  for (const route of guardedRoutes) {
    const contents = source(route);
    assert.match(contents, /snapshot_source/, `${route} deve ler o marcador da amostra`);
    assert.match(contents, /HOMOLOGATION_FIXTURE_READ_ONLY_ERROR/, `${route} deve responder com o erro canônico`);
    assert.match(contents, /status: 409/, `${route} deve bloquear a ação com conflito`);
  }
});

test('BNT-D01 não reconcilia nem persiste estado fiscal da amostra durante uma leitura', () => {
  const ordersApi = source('src/app/api/pedidos/route.ts');
  assert.match(ordersApi, /!isHomologationFixtureSource\(entry\.row\?\.snapshot_source\)/);

  for (const route of [
    'src/app/api/sync/nf/reconciliar-brasilnfe/route.ts',
    'src/app/api/nf/backfill-danfes/route.ts',
    'src/app/api/sync/pedidos/cancelamentos-pos-nfe/route.ts',
    'src/app/api/sync/pedidos/pack-id-backfill/route.ts',
  ]) {
    const contents = source(route);
    assert.match(contents, /snapshot_source\.is\.null,snapshot_source\.neq\.\$\{BNT_D01_FIXTURE_SOURCE\}/);
  }
});
