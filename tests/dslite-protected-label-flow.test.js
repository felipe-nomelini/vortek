const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const labelState = load('src/lib/dslite/label-state.ts');
const operationalStatus = load('src/services/order-operational-status.ts', {
  '@/lib/dslite/label-state': labelState,
  '@/lib/orders/operational-view': {},
  '@/lib/supabase': {},
});

function clientWithEvents(events) {
  return {
    from(table) {
      assert.equal(table, 'nf_auditoria_eventos');
      const query = {
        select() { return this; },
        in() { return this; },
        order() { return this; },
        then(resolve) {
          return Promise.resolve({ data: events, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

function baseRow(patch = {}) {
  return {
    id: '30e79910-cad6-4d0d-be7a-45db33a2df17',
    dslite_etiqueta_enviada: false,
    dslite_label_source: null,
    dslite_next_action: 'resume_dslite_flow',
    dslite_next_action_label: 'Retomar fluxo DSLite',
    ...patch,
  };
}

test('classificador aceita apenas o 403 específico de pedido protegido', () => {
  const protectedMessage = 'HTTP 403: A etiqueta não pode ser alterada porque o pedido está em um status protegido. Somente um usuário Administrador pode realizar esta alteração.';
  assert.equal(labelState.isDsliteProtectedExistingLabelError({ message: protectedMessage }), true);
  assert.equal(labelState.isDsliteProtectedExistingLabelError({ status: 403, message: 'Acesso negado' }), false);
  assert.equal(labelState.isDsliteProtectedExistingLabelError({ status: 500, message: protectedMessage.replace('HTTP 403:', '') }), false);
  assert.equal(labelState.isDslitePlaceholderLabelSource('placeholder_release_window_2026-09-07'), true);
});

test('403 legado protegido reconcilia a ação DSLite e preserva o WhatsApp já concluído', async () => {
  const pedidoId = baseRow().id;
  const events = [
    {
      pedido_id: pedidoId,
      evento: 'whatsapp_label_send_success',
      status_resultante: 'success',
      resposta_ml: {},
      created_at: '2026-09-07T12:00:00.000Z',
    },
    {
      pedido_id: pedidoId,
      evento: 'ml_label_send_failed',
      status_resultante: 'failed',
      resposta_ml: {
        error: 'HTTP 403: A etiqueta não pode ser alterada porque o pedido está em um status protegido. Somente um usuário Administrador pode realizar esta alteração.',
      },
      created_at: '2026-09-07T11:00:00.000Z',
    },
  ];

  const [result] = await operationalStatus.enrichOrdersWithWhatsappStatus(
    [baseRow()],
    clientWithEvents(events),
  );

  assert.equal(result.dslite_label_operational_status, 'protected_existing');
  assert.equal(result.dslite_next_action, 'done');
  assert.equal(result.dslite_next_action_label, 'OK');
  assert.equal(result.whatsapp_label_status, 'sent');
});

test('fonte genérica persistida satisfaz DSLite sem depender de auditoria', async () => {
  const [result] = await operationalStatus.enrichOrdersWithWhatsappStatus(
    [baseRow({
      dslite_etiqueta_enviada: true,
      dslite_label_source: 'placeholder_release_window_2026-09-07',
    })],
    clientWithEvents([]),
  );

  assert.equal(result.dslite_label_operational_status, 'generic_sent');
  assert.equal(result.dslite_next_action, 'done');
  assert.equal(result.whatsapp_label_status, 'not_sent');
});

test('outros erros 403 continuam falha operacional e não encerram a ação DSLite', async () => {
  const pedidoId = baseRow().id;
  const [result] = await operationalStatus.enrichOrdersWithWhatsappStatus(
    [baseRow()],
    clientWithEvents([{
      pedido_id: pedidoId,
      evento: 'ml_label_send_failed',
      status_resultante: 'failed',
      resposta_ml: { error: 'HTTP 403: credencial sem permissão' },
      created_at: '2026-09-07T11:00:00.000Z',
    }]),
  );

  assert.equal(result.dslite_label_operational_status, 'failed');
  assert.equal(result.dslite_next_action, 'resume_dslite_flow');
});

test('rotas e UI preservam DSLite e direcionam a etiqueta real ao WhatsApp', () => {
  const fs = require('node:fs');
  const pedidoRoute = fs.readFileSync('src/app/api/dslite/pedido/route.ts', 'utf8');
  const autoRoute = fs.readFileSync('src/app/api/dslite/etiqueta-auto/route.ts', 'utf8');
  const paymentRoute = fs.readFileSync('src/app/api/compras/[id]/confirmar-pagamento/route.ts', 'utf8');
  const page = fs.readFileSync('src/app/(app)/pedidos/page.tsx', 'utf8');

  assert.match(pedidoRoute, /etiquetaStatus === "mantida"\s*\? \{\}/);
  assert.match(pedidoRoute, /actionRequired: "send_whatsapp_label"/);
  assert.match(autoRoute, /operationStatus: 'dslite_label_already_satisfied'/);
  assert.match(autoRoute, /nextAction: 'send_whatsapp_label'/);
  assert.match(paymentRoute, /resumeDsliteFlow && !routeRealLabelToWhatsapp/);
  assert.match(page, /whatsappRequired\s*\? 'send_whatsapp_label'/);
  assert.match(page, /Reenviar etiqueta por WhatsApp/);
});
