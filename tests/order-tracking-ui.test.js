const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/pedidos/page.tsx');
const drawer = read('src/components/pedidos/PedidoDetailsDrawer.tsx');
const modal = read('src/components/modals/TrackingModal.tsx');
const details = read('src/components/pedidos/OrderTrackingDetails.tsx');
const route = read('src/app/api/pedidos/[id]/tracking/route.ts');
const orderTypes = read('src/types/order.ts');

test('modal e Drawer reutilizam um único componente de acompanhamento', () => {
  assert.match(modal, /import OrderTrackingDetails/);
  assert.match(drawer, /import OrderTrackingDetails/);
  assert.match(modal, /<OrderTrackingDetails/);
  assert.match(drawer, /<OrderTrackingDetails/);
  assert.doesNotMatch(modal, /fetch\(/);
  assert.match(details, /fetch\(`\/api\/pedidos\/\$\{encodeURIComponent\(orderId\)\}\/tracking`/);
});

test('Drawer separa acompanhamento de histórico operacional e consulta de forma lazy', () => {
  assert.match(drawer, /label: 'Acompanhamento'/);
  assert.match(drawer, /label: 'Histórico operacional'/);
  assert.match(drawer, /enabled=\{canTrack && Boolean\(order\.ml_shipment_id\) && !order\.is_homologation_fixture\}/);
  assert.match(drawer, /amostra protegida de homologação/);
  assert.match(drawer, /ainda não possui um shipment do Mercado Livre/);
});

test('tag de status abre o modal somente quando o acompanhamento é elegível', () => {
  assert.match(page, /hasPermission\(role, 'sales\.track'\)/);
  assert.match(page, /!order\.is_homologation_fixture/);
  assert.match(page, /order\.ml_shipment_id/);
  assert.match(page, /onClick=\{\(\) => openTracking\(order\)\}/);
  assert.match(page, /aria-label=\{`Acompanhar entrega da venda/);
  assert.match(page, /Abrir acompanhamento da entrega/);
});

test('tracking preserva respostas parciais e usa o contrato atual de shipment', () => {
  assert.match(orderTypes, /export type PedidoTrackingApiDto/);
  assert.match(orderTypes, /warnings: string\[\]/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /ML_NEW_FORMAT_HEADERS/);
  assert.match(route, /safeWebUrl/);
  assert.match(route, /result\.history\.sort/);
  assert.match(route, /Acompanhamento carregado parcialmente|warnings/);
  assert.match(details, /Acompanhamento carregado parcialmente/);
  assert.match(details, /Tentar novamente/);
});
