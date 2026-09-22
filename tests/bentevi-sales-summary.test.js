const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const operationalView = load('src/lib/orders/operational-view.ts');
const oldDate = '2026-09-01T12:00:00.000Z';
const releasedDate = '2026-09-02T12:00:00.000Z';
const blockedDate = '2099-09-02T12:00:00.000Z';

const whatsappProjection = load('src/services/order-operational-status.ts', {
  '@/lib/dslite/label-state': {
    DSLITE_PROTECTED_EXISTING_LABEL_EVENT: 'placeholder_label_protected_existing',
    isDslitePlaceholderLabelSource: (source) => String(source || '').startsWith('placeholder_'),
    isDsliteProtectedExistingLabelError: () => false,
    matchesDeferredSupplierPayment: () => false,
  },
});
const readProjection = load('src/services/order-read-projection.ts', {
  'server-only': {},
  '@/lib/fiscal/nfe-local-reconciliation': {},
  '@/lib/supplier-balance': { isBkr1Supplier: () => false },
  '@/lib/produto-fornecedor': {},
  '@/lib/sku': {},
  '@/lib/estoque-interno-saldo': {},
  '@/lib/orders/fulfillment-capacity': {},
  '@/lib/dslite/supplier-policy': {},
  '@/lib/kit-supply-source': {},
  '@/services/order-operational-status': whatsappProjection,
});

function sale(id, overrides = {}) {
  return {
    id, numero: id, situacao: 'pendente', data: oldDate, data_venda: oldDate,
    dslite_id: null, dslite_label_source: 'placeholder_release_window_evolusom',
    dslite_etiqueta_enviada: true, ml_fiscal_release_at: blockedDate,
    operational_total: 10, operational_lucro: 2,
    pagamento_resumo: [{ status: 'approved' }],
    operational_pedido_ids: [id], fornecedor_id: 'supplier-a',
    ...overrides,
  };
}

function harness(rows, purchases = new Map(), options = {}) {
  const calls = [];
  const project = async (source) => source.map((row) => {
    const purchase = purchases.get(row.id);
    return {
      ...row,
      evolusom_order_id: purchase?.evolusomId || null,
      dslite_next_action: purchase ? 'wait_ml_label' : 'create_dslite_order',
      dslite_label_operational_status: row.labelDelivered ? 'real_sent' : 'generic_sent',
      supplier_label_delivered: Boolean(row.labelDelivered),
      whatsapp_label_status: row.labelDelivered ? 'sent' : 'not_sent',
    };
  });
  const client = {
    from(table) {
      assert.equal(table, 'pedidos_operacionais');
      const filters = [];
      let range = null;
      let count = false;
      let head = false;
      const query = {
        select(_columns, options = {}) { count = Boolean(options.count); head = Boolean(options.head); return query; },
        eq(field, value) { filters.push((row) => row[field] === value); return query; },
        in(field, values) { filters.push((row) => values.includes(row[field])); return query; },
        gte(field, value) { filters.push((row) => row[field] >= value); return query; },
        lte(field, value) { filters.push((row) => row[field] <= value); return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        then(resolve, reject) {
          const filtered = rows.filter((row) => filters.every((filter) => filter(row)));
          calls.push({ kind: 'select', range, count, head });
          if (options.failOffset !== undefined && range?.[0] === options.failOffset) {
            return Promise.resolve({ data: null, count: null, error: { code: 'synthetic_failure', message: 'read failed' } }).then(resolve, reject);
          }
          const data = head ? null : filtered.slice(range?.[0] || 0, (range?.[1] ?? 999) + 1);
          return Promise.resolve({ data, count: count ? filtered.length : null, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'search_pedidos_paginated');
      const filtered = rows.filter((row) => String(row.numero).includes(args.p_search))
        .filter((row) => !args.p_status || row.situacao === args.p_status);
      const start = (args.p_page - 1) * Math.min(args.p_page_size, 100);
      return { data: { data: filtered.slice(start, start + 100), total: filtered.length }, error: null };
    },
  };
  const common = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true }) },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/services/operation-configuration': { loadOperationRuntimeConfiguration: async () => ({ delayedAfterMinutes: 60 }) },
    '@/services/order-read-projection': {
      enrichOperationalOrders: project,
      reconcileNotaFiscalEmitidaRow: (row) => ({ row, needsPersistence: false }),
      logDbError: () => {},
    },
    '@/lib/orders/operational-view': operationalView,
    '@/lib/timezone': { saoPauloDateParamToUtcIso: (value) => value },
  };
  const list = load('src/app/api/pedidos/route.ts', {
    ...common,
    'next/cache': { unstable_noStore: () => {} },
    '@/lib/homologation-fixture': { isHomologationFixtureSource: () => false },
    '@/lib/produto-filtering': {
      listActiveSupplierOptions: async () => [{ id: 'supplier-a', label: 'Fornecedor A' }],
      mapSupplierFilterIdsToDsliteIds: (ids) => ids,
      includesInternalSupplierFilter: () => false,
      matchesOrderSupplierFilter: ({ row, supplierDsliteIds }) => supplierDsliteIds.includes(row.fornecedor_id),
    },
  });
  const summary = load('src/app/api/pedidos/resumo/route.ts', {
    ...common,
    '@/app/api/pedidos/route': { GET: list.GET },
  });
  const request = async (route, query = '') => {
    const response = await route.GET(new Request(`http://localhost/api/pedidos${query}`));
    return { status: response.status, body: await response.json() };
  };
  return { list, summary, request, calls };
}

test('cartão e lista concordam sobre compra Evolusom, bloqueio e etiqueta entregue', async () => {
  const rows = [
    sale('blocked'),
    sale('delivered', { ml_fiscal_release_at: null, dslite_label_source: 'mercado_livre', labelDelivered: true }),
    sale('released', { ml_fiscal_release_at: releasedDate }),
    sale('missing', { ml_fiscal_release_at: releasedDate }),
  ];
  const purchases = new Map([
    ['blocked', { evolusomId: 101 }],
    ['delivered', { evolusomId: 102 }],
    ['released', { evolusomId: 103 }],
  ]);
  const app = harness(rows, purchases);
  const list = await app.request(app.list, '?operationalView=urgent');
  const summary = await app.request(app.summary, '/resumo');
  assert.equal(list.status, 200);
  assert.equal(summary.status, 200);
  assert.deepEqual(list.body.data.map((row) => row.id), ['released', 'missing']);
  assert.equal(list.body.total, summary.body.urgentCount);
});

test('projeção compartilhada lê a compra Evolusom antes de decidir urgência', async () => {
  const rows = [
    sale('blocked'),
    sale('delivered', { ml_fiscal_release_at: null, dslite_label_source: 'mercado_livre' }),
    sale('released', { ml_fiscal_release_at: releasedDate }),
  ];
  const purchases = new Map(rows.map((row, index) => [row.id, {
    id: `purchase-${index}`, pedido_id: row.id, evolusom_order_id: index + 101,
    evolusom_request_state: 'created', supplier_payment_mode: 'prepaid_pix',
    supplier_payment_status: index === 1 ? 'paid' : 'pending',
  }]));
  const client = {
    from(table) {
      let result = [];
      return {
        select() { return this; },
        in(field, values) {
          if (table === 'compras') result = values.map((id) => purchases.get(id)).filter(Boolean);
          if (table === 'pedidos' && field === 'id') result = values.map((id) => ({
            id, label_type: id === 'delivered' ? 'real' : 'provisional',
            label_delivery_channel: 'whatsapp',
            label_delivered_at: id === 'delivered' ? oldDate : null,
          }));
          return this;
        },
        order() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: result, error: null }).then(resolve, reject); },
      };
    },
  };
  const projected = await readProjection.enrichOperationalOrders(rows, client);
  assert.deepEqual(projected.map((row) => row.evolusom_order_id), [101, 102, 103]);
  assert.deepEqual(projected.map((row) => operationalView.matchesOrdersOperationalView(row, 'urgent', 60)),
    [false, false, true]);
});

test('resumo conta todos os lotes e exclui canceladas apenas dos valores', async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => sale(`sale-${String(index).padStart(4, '0')}`, {
    situacao: index === 1204 ? 'cancelado' : 'entregue',
  }));
  const app = harness(rows);
  const result = await app.request(app.summary, '/resumo');
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 1205);
  assert.equal(result.body.statusCounts.entregue, 1204);
  assert.equal(result.body.statusCounts.cancelado, 1);
  assert.equal(result.body.total, 12040);
  assert.equal(result.body.lucroSum, 2408);
  assert.equal(result.body.mlCompatibleTotal, 12040);
  assert.equal(result.body.urgentCount, 0);
  assert.deepEqual(app.calls.filter((call) => call.range && call.range[1] - call.range[0] === 499)
    .slice(0, 3).map((call) => call.range), [[0, 499], [500, 999], [1000, 1499]]);
});

test('busca e fornecedor mantêm o resumo alinhado à lista', async () => {
  const rows = Array.from({ length: 110 }, (_, index) => sale(`match-${index}`, {
    ml_fiscal_release_at: releasedDate,
    fornecedor_id: index < 30 ? 'supplier-a' : 'supplier-b',
  }));
  const app = harness(rows);
  for (const filter of ['?search=match', '?fornecedores=supplier-a']) {
    const list = await app.request(app.list, `${filter}&operationalView=urgent`);
    const summary = await app.request(app.summary, `/resumo${filter}`);
    assert.equal(list.status, 200);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.urgentCount, list.body.total);
    assert.equal(summary.body.count, filter.includes('fornecedores') ? 30 : 110);
  }
});

test('falha no segundo lote não publica métricas parciais', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => sale(`sale-${index}`, { situacao: 'entregue' }));
  const app = harness(rows, new Map(), { failOffset: 500 });
  const result = await app.request(app.summary, '/resumo');
  assert.equal(result.status, 500);
  assert.equal(result.body.total, undefined);
  assert.match(result.body.erro, /Falha ao calcular totais/);
});
