const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/pedidos/page.tsx');
const orderTypes = read('src/types/order.ts');
const pedidosRoute = read('src/app/api/pedidos/route.ts');
const dsliteFlow = read('src/components/pedidos/usePedidosDsliteFlow.ts');
const dsliteModals = read('src/components/pedidos/PedidosDsliteModals.tsx');
const labelWhatsappFlow = read('src/components/pedidos/usePedidosLabelWhatsappFlow.ts');
const labelWhatsappModals = read('src/components/pedidos/PedidosLabelWhatsappModals.tsx');
const detailsDrawer = read('src/components/pedidos/PedidoDetailsDrawer.tsx');

test('Pedidos permanece como orquestradora de lista, filtros, DTO e tracking', () => {
  assert.match(page, /function mapDBtoOrder/);
  assert.match(page, /fetch\(`\/api\/pedidos\?\$\{listParams\.toString\(\)\}`/);
  assert.match(page, /fetch\(`\/api\/pedidos\/resumo\?\$\{filterParams\.toString\(\)\}`/);
  assert.match(page, /<ResizableTable<Order>/);
  assert.match(page, /<TrackingModal/);
  assert.match(page, /usePedidosDsliteFlow\(\{/);
  assert.match(page, /usePedidosLabelWhatsappFlow\(\{/);
  assert.match(page, /openShippingSelection: dsliteFlow\.openShippingSelection/);
  assert.match(page, /<PedidosDsliteModals flow=\{dsliteFlow\}/);
  assert.match(page, /<PedidosLabelWhatsappModals flow=\{labelWhatsappFlow\}/);
});

test('DTO operacional representa a resposta real de Pedidos sem casts compensatórios', () => {
  assert.match(orderTypes, /export type PedidoOperacionalApiDto =/);
  assert.match(orderTypes, /export type PedidosOperacionaisApiResponse =/);
  assert.match(page, /function mapDBtoOrder\(item: PedidoOperacionalApiDto\): Order/);
  assert.match(page, /response\.json\(\) as Promise<PedidosOperacionaisApiResponse>/);
  assert.match(pedidosRoute, /const payload: PedidosOperacionaisApiResponse =/);
  assert.doesNotMatch(page, /\(item as any\)/);
  assert.doesNotMatch(page, /\(record as any\)\.ml_claim_id/);
});

test('piloto Bentevi concentra decisão na tabela e detalhes no Drawer', () => {
  for (const label of ['Pedido', 'Cliente', 'Valor', 'Status', 'Progresso', 'Próxima ação']) {
    assert.match(page, new RegExp(`title: '${label}'`));
  }
  assert.doesNotMatch(page, /title: 'Pendência'/);
  assert.doesNotMatch(page, /title: 'Idade'/);
  assert.match(page, /Venda #\{saleId\}/);
  assert.match(page, /Pack #\{packId\}/);
  assert.match(page, /getOrderSalesProgress\(order\)/);
  assert.match(page, /steps=\{SALES_PROGRESS_STAGES\.length\}/);
  assert.match(page, /function getOrderActions/);
  assert.match(page, /hasPermission\(role, permission\)/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /Os dados anteriores foram preservados/);
  assert.match(page, /storageKey="pedidos-bentevi-v2"/);
  assert.match(page, /operational\.shortLabel/);
  assert.match(page, /title=\{operational\.label\}/);
  assert.doesNotMatch(page, /rowSelection=/);
  assert.doesNotMatch(page, /expandable=/);
  assert.match(detailsDrawer, /<Drawer/);
  assert.match(detailsDrawer, /Linha do tempo/);
  assert.match(detailsDrawer, /Fulfillment e pagamento/);
  assert.match(detailsDrawer, /Fiscal e rastreio/);
});

test('Pedidos não mantém endpoints, timers ou modais dos fluxos extraídos', () => {
  for (const pattern of [
    /\/api\/dslite\/pedido/,
    /\/api\/dslite\/frete/,
    /\/api\/dslite\/completar-etiqueta/,
    /\/api\/dslite\/etiqueta-auto/,
    /confirmar-pagamento/,
    /enviar-etiqueta-whatsapp/,
    /setTimeout\([^)]*,\s*1200\)/,
    /setTimeout\([^)]*,\s*1500\)/,
    /<ProgressModal/,
    /<Modal/,
    /<Upload(?:\s|>)/,
  ]) {
    assert.doesNotMatch(page, pattern);
  }
});

test('fluxo DSLite concentra job, pagamento, frete e desvinculação', () => {
  for (const pattern of [
    /\/api\/dslite\/pedido\/status\?jobId=/,
    /fetch\('\/api\/dslite\/pedido'/,
    /\/api\/compras\/\$\{paymentPrompt\.compraId\}\/confirmar-pagamento/,
    /fetch\('\/api\/dslite\/frete'/,
    /fetch\('\/api\/dslite\/desvincular-local'/,
    /setTimeout\(\(\) => \{/,
    /\}, 1500\)/,
    /clearTimeout\(pollRef\.current\)/,
  ]) {
    assert.match(dsliteFlow, pattern);
  }

  assert.match(dsliteModals, /function SupplierPaymentModal/);
  assert.match(dsliteModals, /function DsliteShippingModal/);
  assert.match(dsliteModals, /title="Criando Pedido DSLite"/);
  assert.match(dsliteModals, /<Upload/);
});

test('fluxo de etiqueta e WhatsApp concentra operações e modais correspondentes', () => {
  for (const pattern of [
    /enviar-etiqueta-whatsapp/,
    /fetch\('\/api\/dslite\/completar-etiqueta'/,
    /fetch\('\/api\/dslite\/etiqueta-auto'/,
    /\/api\/pedidos\/\$\{order\.dbId\}\/etiqueta/,
    /\}, 1200\)/,
    /clearTimeout\(whatsappPollRef\.current\)/,
    /openShippingSelection\(\{/,
  ]) {
    assert.match(labelWhatsappFlow, pattern);
  }

  assert.match(labelWhatsappModals, /Enviando Etiqueta por WhatsApp/);
  assert.match(labelWhatsappModals, /Completando Etiqueta DSLite/);
  assert.match(labelWhatsappModals, /Prosseguir com Nota Encontrada/);
  assert.doesNotMatch(`${dsliteFlow}\n${labelWhatsappFlow}`, /usePolling|useInterval/);
});
