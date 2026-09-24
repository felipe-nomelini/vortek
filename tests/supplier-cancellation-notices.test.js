const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const templates = require('../src/lib/notifications/templates.ts');
const saleId = '00000000-0000-4000-8000-000000000001';
const purchaseId = '00000000-0000-4000-8000-000000000002';

function fixture({ direct = false, additionalPhone = '11999998888', primaryPhone = '11988887777',
  secondSale = null, sendFailure = null, notice = true, legacySent = false, fixtureSource = null } = {}) {
  const reference = direct ? 63012231 : '918542';
  const tables = {
    supplier_cancellation_notices: notice ? [{
      pedido_id: saleId, compra_id: null, status: 'pending', recipients: {},
      next_attempt_at: '2026-09-24T00:00:00Z', created_at: '2026-09-24T00:00:00Z',
    }] : [],
    pedidos: [{ id: saleId, numero: 821, ml_order_id: '2000018210665568', situacao: 'cancelado',
      dslite_id: direct ? null : reference, evolusom_order_id: direct ? reference : null,
      snapshot_source: fixtureSource,
      ml_pack_id: secondSale ? 'PACK1' : null, ml_bundle_type: secondSale ? 'cart' : null,
      ml_bundle_parent_item_id: null },
    ...(secondSale ? [{ id: '00000000-0000-4000-8000-000000000003', numero: 822,
      ml_order_id: '2000018210665569', situacao: secondSale,
      dslite_id: direct ? null : reference, evolusom_order_id: direct ? reference : null,
      ml_pack_id: 'PACK1', ml_bundle_type: 'cart', ml_bundle_parent_item_id: null }] : [])],
    compras: [{ id: purchaseId, pedido_id: direct ? saleId : null,
      evolusom_order_id: direct ? reference : null, dsid: direct ? null : reference,
      fornecedor_id: direct ? '133' : '97', status: 'Faturado', evolusom_request_state: direct ? 'created' : null }],
    fornecedores: [{ dslite_id: direct ? '133' : '97', telefone: primaryPhone }],
    nf_auditoria_eventos: legacySent ? [{ id: 'old-send', pedido_id: saleId,
      evento: 'ml_cancel_auto_supplier_whatsapp_sent', status_resultante: 'success',
      resposta_ml: { dsid: reference } }] : [],
  };
  const sent = [];
  const events = [];
  let allocated = 0;
  let failurePending = Boolean(sendFailure);
  const client = {
    from(table) {
      let rows = tables[table] || [];
      let patch = null;
      const query = {
        select() { return this; },
        update(value) { patch = value; return this; },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return this; },
        lte(field, value) { rows = rows.filter((row) => row[field] <= value); return this; },
        order(field) { rows = [...rows].sort((a, b) => String(a[field]).localeCompare(String(b[field]))); return this; },
        limit(count) { rows = rows.slice(0, count); return this; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then(resolve) {
          if (patch) for (const row of rows) Object.assign(row, patch);
          resolve({ data: patch ? rows : rows.map((row) => ({ ...row })), error: null });
        },
      };
      return query;
    },
  };
  const service = load('src/services/supplier-cancellation-notices.ts', {
    '@/lib/supabase': { createServiceClient: () => client },
    '@/lib/homologation-fixture': { isHomologationFixtureSource: (source) =>
      ['bnt_d01_production_clone', 'bnt_d05_inventory_mock'].includes(source) },
    '@/lib/dslite/purchase-link': { resolveSafeDslitePedidoMutation: (candidates, expected, target) => ({
      safe: candidates.every((row) => String(row.dslite_id) === expected) && candidates.some((row) => row.id === target),
      ids: candidates.map((row) => row.id),
    }) },
    '@/lib/notifications/templates': templates,
    '@/services/nf-auditoria': { registrarEventoNfAuditoria: async (event) => { events.push(event); } },
    '@/services/waha': {
      normalizeWhatsappChatId: (phone) => {
        const digits = String(phone).replace(/\D/g, '');
        if (digits.length !== 11) throw Error('Telefone inválido');
        return `55${digits}@c.us`;
      },
      getWahaNewMessageId: async () => `msg-${++allocated}`,
      sendWahaText: async (input) => {
        sent.push(input);
        if (failurePending && input.chatId.includes(sendFailure)) {
          failurePending = false;
          throw Error('WAHA indisponível');
        }
      },
    },
  });
  return { client, tables, sent, events, service, get allocated() { return allocated; }, additionalPhone };
}

test('compra DSLite cancelada antes da NF-e avisa uma vez; sem evento novo não há envio', async () => {
  const f = fixture();
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).sent, 1);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /Não despache este pedido/);
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).seen, 0);
  const old = fixture({ notice: false });
  assert.equal((await old.service.runSupplierCancellationNotices(old.client, 10)).seen, 0);
});

test('envio DSLite ocorrido entre migration e deploy não é repetido', async () => {
  const f = fixture({ legacySent: true });
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).sent, 1);
  assert.equal(f.sent.length, 0);
});

test('amostra de homologação cancelada não gera envio externo', async () => {
  const f = fixture({ fixtureSource: 'bnt_d01_production_clone' });
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).skipped, 1);
  assert.equal(f.sent.length, 0);
});

test('Evolusom direta avisa os dois contatos e não duplica números iguais', async () => {
  const previous = process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE;
  try {
    process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE = '11999998888';
    const f = fixture({ direct: true });
    assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).sent, 1);
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[0].text, /Evolusom #63012231/);
    const same = fixture({ direct: true, primaryPhone: '11999998888' });
    assert.equal((await same.service.runSupplierCancellationNotices(same.client, 10)).sent, 1);
    assert.equal(same.sent.length, 1);
    assert.equal(same.tables.supplier_cancellation_notices[0].recipients.evolusom_additional.status, 'duplicate');
  } finally {
    if (previous === undefined) delete process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE;
    else process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE = previous;
  }
});

test('falha parcial retoma só o contato pendente com o mesmo ID de mensagem', async () => {
  const previous = process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE;
  try {
    process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE = '11999998888';
    const f = fixture({ direct: true, sendFailure: '999998888' });
    assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).failed, 1);
    assert.equal(f.sent.length, 2);
    f.tables.supplier_cancellation_notices[0].next_attempt_at = '2026-09-24T00:00:00Z';
    assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).sent, 1);
    assert.equal(f.sent.length, 3);
    assert.equal(f.sent[1].messageId, f.sent[2].messageId);
    assert.equal(f.allocated, 2);
  } finally {
    if (previous === undefined) delete process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE;
    else process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE = previous;
  }
});

test('compra compartilhada não recebe instrução de bloquear vendas ativas', async () => {
  const f = fixture({ secondSale: 'etiqueta_impressa' });
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).sent, 1);
  assert.match(f.sent[0].text, /Confira os itens antes de despachar/);
  assert.doesNotMatch(f.sent[0].text, /Não despache este pedido/);
});

test('vínculo simultâneo com duas origens bloqueia o envio', async () => {
  const f = fixture({ direct: true });
  f.tables.pedidos[0].dslite_id = '918542';
  assert.equal((await f.service.runSupplierCancellationNotices(f.client, 10)).blocked, 1);
  assert.equal(f.sent.length, 0);
});
