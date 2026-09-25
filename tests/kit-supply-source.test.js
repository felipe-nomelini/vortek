const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');

const subject = load('src/lib/kit-supply-source.ts', {
  '@/lib/dslite/supplier-policy': {
    loadOperationalDropshippingSupplierIds: async () => new Set(['108', '115']),
  },
});

const base = {
  kitProductId: 'kit',
  kit: { produto_id: 'kit', fornecedor_dslite_id: '108', sku_origem: '2295CX48', ativo: true },
  components: [{ kit_produto_id: 'kit', componente_produto_id: 'component', quantidade: 48 }],
  componentProducts: [{ id: 'component', sku: 'VTK001502', nome: 'Pilha AA', ativo: true }],
  offers: [
    {
      id: 'mks', produto_id: 'component', dslite_fornecedor_id: '115', dslite_produto_id: '2295',
      fornecedor_nome: 'MKS', custo: 10, estoque: 144, ativo: true, prioridade: 1,
    },
    {
      id: 'bkr1', produto_id: 'component', dslite_fornecedor_id: '108', dslite_produto_id: '2295',
      fornecedor_nome: 'BKR1', custo: 10.06, estoque: 100, ativo: true, prioridade: 2,
      updated_at: '2026-09-15T08:05:00Z',
    },
  ],
  operationalSupplierIds: new Set(['108', '115']),
};

test('kit usa exclusivamente a oferta do fornecedor configurado', () => {
  const result = subject.resolveKitSupplySourceFromRows(base);
  assert.equal(result.kind, 'ready');
  assert.equal(result.source.supplierId, '108');
  assert.equal(result.source.offer.id, 'bkr1');
  assert.equal(result.source.stock, 2);
  assert.equal(result.source.cost, 482.88);
});

test('cabo por metro: trinta metros rendem três kits de dez e custo de R$ 599', () => {
  const input = {
    ...base,
    kit: { produto_id: 'kit', fornecedor_dslite_id: '133', sku_origem: '229965', ativo: true },
    components: [{ kit_produto_id: 'kit', componente_produto_id: 'component', quantidade: 10 }],
    componentProducts: [{ id: 'component', sku: 'VTK026507', nome: 'Cabo SAS - metro',
      descricao: 'Unidade de medida: metro', ativo: true }],
    offers: [{ id: 'offer', produto_id: 'component', dslite_fornecedor_id: '133',
      dslite_produto_id: '229965', custo: 59.9, estoque: 30, ativo: true }],
    operationalSupplierIds: new Set(['133']),
  };
  for (const [meters, expectedKits] of [[30, 3], [20, 2], [0, 0]]) {
    const result = subject.resolveKitSupplySourceFromRows({ ...input,
      offers: [{ ...input.offers[0], estoque: meters }] });
    assert.equal(result.kind, 'ready');
    assert.equal(result.source.stock, expectedKits);
    assert.equal(result.source.cost, 599);
    assert.equal(result.source.componentQuantity, 10);
    assert.equal(result.source.componentUnit, 'M');
    assert.equal(result.source.offer.dslite_produto_id, '229965');
  }
});

test('kit de oito pilhas usa quatro cartelas e acompanha mudança de custo da oferta', () => {
  const input = {
    ...base,
    components: [{ kit_produto_id: 'kit', componente_produto_id: 'component', quantidade: 4 }],
    offers: base.offers.map(offer => ({ ...offer, custo: offer.dslite_fornecedor_id === '108' ? 7.19 : 7 })),
  };
  const first = subject.resolveKitSupplySourceFromRows(input);
  assert.equal(first.kind, 'ready');
  assert.equal(first.source.cost, 28.76);
  assert.equal(first.source.componentQuantity, 4);
  const changed = subject.resolveKitSupplySourceFromRows({
    ...input, offers: input.offers.map(offer => ({ ...offer,
      custo: offer.dslite_fornecedor_id === '108' ? 8 : 7 })),
  });
  assert.equal(changed.kind, 'ready');
  assert.equal(changed.source.cost, 32);
});

test('kit não faz fallback quando falta oferta do fornecedor configurado', () => {
  const result = subject.resolveKitSupplySourceFromRows({
    ...base,
    offers: base.offers.filter((offer) => offer.dslite_fornecedor_id !== '108'),
  });
  assert.deepEqual(result, {
    kind: 'incomplete', supplierId: '108', sourceSku: '2295CX48', reason: 'missing_supplier_offer',
  });
});

test('kit composto permanece bloqueado no fulfillment DSLite', () => {
  const result = subject.resolveKitSupplySourceFromRows({
    ...base,
    components: [...base.components, { kit_produto_id: 'kit', componente_produto_id: 'other', quantidade: 1 }],
  });
  assert.equal(result.kind, 'unsupported_composite');
  assert.equal(result.componentCount, 2);
});

test('RPC preserva contrato e inclui fornecedor e SKU de origem dos kits', () => {
  const migration = fs.readFileSync('supabase/migrations/20260915113000_kit_supplier_source_search.sql', 'utf8');
  assert.match(migration, /kit\.fornecedor_dslite_id as kit_fornecedor_dslite_id/);
  assert.match(migration, /kit\.sku_origem as kit_sku_origem/);
  assert.match(migration, /coalesce\(produto\.kit_fornecedor_dslite_id, ''\) = any\(p_supplier_dslite_ids\)/);
  assert.match(migration, /security definer[\s\S]*set search_path to 'pg_catalog', 'pg_temp'/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test('reparo da venda pendente é idempotente e condicionado à origem BKR1 comprovada', () => {
  const migration = fs.readFileSync('supabase/migrations/20260915114000_repair_pending_kit_order_cmv.sql', 'utf8');
  assert.match(migration, /ml_order_id = '2000018469395176'/);
  assert.match(migration, /nullif\(trim\(coalesce\(pedido\.dslite_id, ''\)\), ''\) is not null[\s\S]*return;/);
  assert.doesNotMatch(migration, /já possui pedido DSLite; reparo de CMV interrompido/);
  assert.match(migration, /kit\.fornecedor_dslite_id = '108'/);
  assert.match(migration, /offer\.dslite_produto_id = '2295'/);
  assert.match(migration, /item\.cmv_unitario_snapshot = 482\.88[\s\S]*return;/);
  assert.match(migration, /item\.cmv_unitario_snapshot = 480\.00[\s\S]*pedido\.lucro = 167\.54/);
  assert.match(migration, /cmv_total_snapshot = 965\.76/);
  assert.match(migration, /set lucro = 161\.78/);
});
