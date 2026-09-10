const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const preferredOffer = require('../src/lib/preferred-offer.ts');
const sku = require('../src/lib/sku.ts');

function loadSubject() {
  return load('src/services/order-cmv-snapshot.ts', {
    'server-only': {},
    '@/lib/dslite/supplier-policy': {
      loadOperationalDropshippingSupplierIds: async () => new Set(['97']),
      filterOperationalDropshippingSupplierOffers: (offers, ids) => (
        offers.filter((offer) => ids.has(String(offer.dslite_fornecedor_id)))
      ),
    },
    '@/lib/preferred-offer': preferredOffer,
    '@/lib/sku': sku,
  });
}

function clientWith(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const builder = {
        select() { return builder; },
        in(column, values) {
          rows = rows.filter((row) => values.map(String).includes(String(row[column])));
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

const orderItem = {
  item: { id: 'MLB7229843632', seller_sku: 'VTK009908' },
  quantity: 1,
};

const baseTables = {
  produtos: [{
    id: 'produto-1', ativo: true, sku: 'VTK009908', ml_item_id: 'MLB7229843632',
    custo: 394.74, updated_at: '2026-09-09T21:00:00Z',
    oferta_preferencial_id: 'oferta-1', fornecedor_preferencial_manual: true,
  }],
  catalogo_ml_snapshot: [],
  produto_kits: [],
  produto_kit_componentes: [],
  produto_fornecedor_ofertas: [{
    id: 'oferta-1', produto_id: 'produto-1', dslite_fornecedor_id: '97',
    ativo: true, estoque: 5, custo: 394.74, prioridade: 1,
    updated_at: '2026-09-09T21:00:00Z',
  }],
};

test('congela o custo da oferta preferencial e fornece evidência itemizada ao lucro', async () => {
  const subject = loadSubject();
  const snapshots = await subject.loadOrderItemCmvSnapshots({
    client: clientWith(baseTables),
    mlOrderId: '2000018383274684',
    orderItems: [orderItem],
  });
  assert.equal(snapshots[0].cmv_unitario_snapshot, 394.74);
  assert.equal(snapshots[0].cmv_total_snapshot, 394.74);
  assert.equal(snapshots[0].cmv_fonte, 'preferred_offer');
  assert.match(snapshots[0].cmv_evidencia_id, /oferta-1/);
  assert.deepEqual(subject.buildOrderHistoricalCosts([orderItem], snapshots), [{
    itemId: 'MLB7229843632',
    quantity: 1,
    totalCostCents: 39474,
    evidenceId: snapshots[0].cmv_evidencia_id,
  }]);
});

test('reidratação preserva o primeiro CMV válido após mudança da oferta', async () => {
  const subject = loadSubject();
  const first = (await subject.loadOrderItemCmvSnapshots({
    client: clientWith(baseTables),
    mlOrderId: '2000018383274684',
    orderItems: [orderItem],
  }))[0];
  const changedTables = structuredClone(baseTables);
  changedTables.produto_fornecedor_ofertas[0].custo = 450;
  changedTables.produto_fornecedor_ofertas[0].updated_at = '2026-09-10T12:00:00Z';
  const second = await subject.loadOrderItemCmvSnapshots({
    client: clientWith(changedTables),
    mlOrderId: '2000018383274684',
    orderItems: [orderItem],
    existingItems: [{ ...first, ml_item_id: 'MLB7229843632', seller_sku: 'VTK009908', quantidade: 1 }],
  });
  assert.deepEqual(second[0], first);
});

test('produto sem vínculo inequívoco mantém o CMV pendente', async () => {
  const subject = loadSubject();
  const snapshots = await subject.loadOrderItemCmvSnapshots({
    client: clientWith({ ...baseTables, produtos: [], produto_fornecedor_ofertas: [] }),
    mlOrderId: '2000018383274684',
    orderItems: [orderItem],
  });
  assert.deepEqual(snapshots, [null]);
  assert.deepEqual(subject.buildOrderHistoricalCosts([orderItem], snapshots), []);
});
