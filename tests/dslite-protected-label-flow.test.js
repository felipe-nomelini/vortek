const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const labelState = load('src/lib/dslite/label-state.ts');
const operationalStatus = load('src/services/order-operational-status.ts', {
  '@/lib/dslite/label-state': labelState,
  '@/lib/orders/operational-view': {},
  '@/lib/supabase': {},
});

function clientWithEvents(events, labels = []) {
  return {
    from(table) {
      assert.ok(['nf_auditoria_eventos', 'pedidos'].includes(table));
      const query = {
        select() { return this; },
        in() { return this; },
        order() { return this; },
        then(resolve) {
          return Promise.resolve({ data: table === 'pedidos' ? labels : events, error: null }).then(resolve);
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

test('apresentação da etiqueta diferencia origem e exibe WhatsApp somente para genérica', () => {
  const present = labelState.resolveDsliteLabelPresentation;

  assert.deepEqual(present({ labelSource: 'mercado_livre', operationalStatus: 'sent_unverified' }), {
    label: 'real', showWhatsapp: false, whatsappLabel: null,
  });
  assert.deepEqual(present({ operationalStatus: 'real_sent', whatsappStatus: 'sent' }), {
    label: 'real', showWhatsapp: false, whatsappLabel: null,
  });
  assert.deepEqual(present({ labelSource: 'placeholder_release_window_vanral', whatsappStatus: 'not_sent' }), {
    label: 'genérica', showWhatsapp: true, whatsappLabel: 'Não enviado',
  });
  assert.deepEqual(present({ operationalStatus: 'protected_existing', whatsappStatus: 'sent' }), {
    label: 'genérica', showWhatsapp: true, whatsappLabel: 'Enviado',
  });
  for (const whatsappStatus of ['test_sent', 'pending', 'on_hold', 'failed', 'unknown', 'not_sent']) {
    assert.equal(
      present({ operationalStatus: 'generic_sent', whatsappStatus }).whatsappLabel,
      'Não enviado',
    );
  }
  assert.deepEqual(present({ operationalStatus: 'provider_shipping' }), {
    label: 'própria DSLite', showWhatsapp: false, whatsappLabel: null,
  });
});

test('apresentação da etiqueta não inventa origem em estados incompletos', () => {
  const present = labelState.resolveDsliteLabelPresentation;

  assert.equal(present({ operationalStatus: 'pending' }).label, 'não enviada');
  assert.equal(present({ operationalStatus: 'failed' }).label, 'falha');
  assert.equal(present({ operationalStatus: 'sent_unverified' }).label, 'não identificada');
  assert.equal(present({ operationalStatus: 'unknown' }).label, 'não identificada');
  assert.equal(present({}).label, 'não identificada');
});

test('adiamento do PIX só autoriza a compra e o DSID registrados', () => {
  const event = {
    evento: 'supplier_payment_deferred_by_user',
    status_resultante: 'continued_pending',
    resposta_ml: { compra_id: 'compra-1', dslite_id: '410989' },
  };
  assert.equal(labelState.matchesDeferredSupplierPayment(event, 'compra-1', '410989'), true);
  assert.equal(labelState.matchesDeferredSupplierPayment(event, 'compra-2', '410989'), false);
  assert.equal(labelState.matchesDeferredSupplierPayment(event, 'compra-1', '410990'), false);
  assert.equal(labelState.matchesDeferredSupplierPayment({ ...event, status_resultante: 'failed' }, 'compra-1', '410989'), false);
});

test('falha de etiqueta com PIX adiado identifica a repetição sem alterar o pagamento', async () => {
  const pedidoId = baseRow().id;
  const [result] = await operationalStatus.enrichOrdersWithWhatsappStatus(
    [baseRow({
      dslite_id: '410989',
      compra_id: 'compra-1',
      dslite_next_action: 'confirm_supplier_payment',
    })],
    clientWithEvents([
      {
        pedido_id: pedidoId,
        evento: 'ml_label_send_failed',
        status_resultante: 'failed',
        resposta_ml: { error: 'HTTP 404' },
        created_at: '2026-09-18T21:40:34.549Z',
      },
      {
        pedido_id: pedidoId,
        evento: 'supplier_payment_deferred_by_user',
        status_resultante: 'continued_pending',
        resposta_ml: { compra_id: 'compra-1', dslite_id: '410989' },
        created_at: '2026-09-18T21:40:32.719Z',
      },
    ]),
  );
  assert.equal(result.dslite_label_operational_status, 'failed');
  assert.equal(result.supplier_payment_deferred, true);
  assert.equal(result.dslite_next_action, 'confirm_supplier_payment');
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

test('entrega real confirmada encerra a espera da Evolusom, independentemente da auditoria', async () => {
  const row = baseRow({
    evolusom_order_id: 63012097,
    dslite_etiqueta_enviada: true,
    dslite_label_source: 'placeholder_release_window_evolusom',
    dslite_next_action: 'wait_ml_label',
    dslite_next_action_label: 'Aguardar etiqueta real do ML',
  });
  const event = {
    pedido_id: row.id,
    evento: 'whatsapp_label_send_success',
    status_resultante: 'success',
    resposta_ml: { test_placeholder_label: false },
    created_at: '2026-09-22T04:30:52.426Z',
  };
  const deliveredLabel = [{ id: row.id, label_type: 'real', label_delivery_channel: 'whatsapp', label_delivered_at: event.created_at }];
  const [pending] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([]));
  const [unverified] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([event]));
  const [sent] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([], deliveredLabel));
  assert.equal(pending.dslite_next_action, 'wait_ml_label');
  assert.equal(unverified.dslite_next_action, 'wait_ml_label');
  assert.equal(unverified.whatsapp_label_status, 'sent_unverified');
  assert.equal(unverified.supplier_label_delivered, false);
  assert.equal(sent.whatsapp_label_status, 'sent');
  assert.equal(sent.supplier_label_delivered, true);
  assert.equal(sent.dslite_next_action, 'done');
  assert.equal(sent.dslite_next_action_label, 'OK');
});

test('etiqueta real incluída no pedido Evolusom encerra a espera sem exigir WhatsApp', async () => {
  const row = baseRow({
    evolusom_order_id: 63012179,
    dslite_etiqueta_enviada: true,
    dslite_label_source: 'mercado_livre',
    dslite_next_action: 'wait_ml_label',
    dslite_next_action_label: 'Aguardar etiqueta real do ML',
  });
  const label = [{
    id: row.id,
    label_type: 'real',
    label_delivery_channel: 'dslite',
    label_delivered_at: '2026-09-22T15:04:14.000Z',
  }];
  const [pending] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([]));
  const [delivered] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([{
    pedido_id: row.id,
    evento: 'ml_label_send_failed',
    status_resultante: 'failed',
    resposta_ml: { error: 'Falha anterior' },
    created_at: '2026-09-22T14:00:00.000Z',
  }], label));
  assert.equal(pending.dslite_next_action, 'wait_ml_label');
  assert.equal(delivered.supplier_label_delivered, true);
  assert.equal(delivered.dslite_label_operational_status, 'real_sent');
  assert.equal(delivered.dslite_next_action, 'done');
  assert.equal(delivered.whatsapp_label_status, 'not_sent');
});

test('etiqueta provisória ainda exige entrega real por WhatsApp', async () => {
  const row = baseRow({
    evolusom_order_id: 63012097,
    dslite_label_source: 'placeholder_release_window_evolusom',
    dslite_next_action: 'wait_ml_label',
  });
  const [status] = await operationalStatus.enrichOrdersWithWhatsappStatus([row], clientWithEvents([], [{
    id: row.id,
    label_type: 'real',
    label_delivery_channel: 'dslite',
    label_delivered_at: '2026-09-22T15:04:14.000Z',
  }]));
  assert.equal(status.supplier_label_delivered, false);
  assert.equal(status.dslite_next_action, 'wait_ml_label');
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
  assert.match(page, /Reenviar etiqueta/);
  assert.doesNotMatch(page, /Reenviar etiqueta por WhatsApp/);
});
