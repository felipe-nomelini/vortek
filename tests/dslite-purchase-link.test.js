const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isDsliteRelinkBlockedByManualUnlink,
  resolveSafeReactivatedDsliteOrderReuse,
  resolveSafeDslitePedidoLinks,
  resolveSafeDslitePedidoMutation,
} = require('../src/lib/dslite/purchase-link.ts');

test('bloqueia restauração do mesmo DSLite removido manualmente', () => {
  assert.equal(isDsliteRelinkBlockedByManualUnlink([
    { pedido_id: 'p1', resposta_ml: { dslite_id_antigo: '391293' } },
  ], ['p1'], '391293'), true);
});

test('permite vínculo de novo pedido DSLite após desvínculo manual', () => {
  assert.equal(isDsliteRelinkBlockedByManualUnlink([
    { pedido_id: 'p1', resposta_ml: { dslite_id_antigo: '391293' } },
  ], ['p1'], '399999'), false);
});

test('ignora desvínculo manual de outra venda', () => {
  assert.equal(isDsliteRelinkBlockedByManualUnlink([
    { pedido_id: 'p2', resposta_ml: { dslite_id_antigo: '391293' } },
  ], ['p1'], '391293'), false);
});

test('aceita pedido único sem vínculo conflitante', () => {
  assert.deepEqual(resolveSafeDslitePedidoLinks([{ id: 'p1', dslite_id: null }], '392520'), {
    safe: true,
    ids: ['p1'],
    reason: 'single_order',
  });
});

test('aceita somente componentes do mesmo carrinho explícito', () => {
  const result = resolveSafeDslitePedidoLinks([
    { id: 'p1', dslite_id: null, ml_bundle_type: 'cart', ml_pack_id: 'pack-1' },
    { id: 'p2', dslite_id: '392520', ml_bundle_type: 'cart', ml_pack_id: 'pack-1' },
  ], '392520');
  assert.equal(result.safe, true);
  assert.deepEqual(result.ids, ['p1', 'p2']);
});

test('bloqueia NF-e compartilhada por vendas independentes', () => {
  const result = resolveSafeDslitePedidoLinks([
    { id: 'p1', dslite_id: null },
    { id: 'p2', dslite_id: null },
  ], '392520');
  assert.deepEqual(result, { safe: false, ids: [], reason: 'ambiguous_nfe' });
});

test('bloqueia substituição de DSLite já vinculado', () => {
  const result = resolveSafeDslitePedidoLinks([
    { id: 'p1', dslite_id: '391999' },
  ], '392520');
  assert.deepEqual(result, { safe: false, ids: [], reason: 'conflicting_dslite_id' });
});

test('autoriza mutação fiscal somente para o pedido resolvido', () => {
  assert.deepEqual(
    resolveSafeDslitePedidoMutation(
      [{ id: 'p1', dslite_id: '392520' }],
      '392520',
      'p1',
    ),
    { safe: true, ids: ['p1'], reason: 'single_order' },
  );
});

test('bloqueia mutação fiscal quando o alvo não pertence ao grupo resolvido', () => {
  assert.deepEqual(
    resolveSafeDslitePedidoMutation(
      [{ id: 'p1', dslite_id: '392520' }],
      '392520',
      'p2',
    ),
    { safe: false, ids: [], reason: 'target_not_in_resolved_group' },
  );
});

test('bloqueia mutação fiscal em NF-e compartilhada por vendas independentes', () => {
  assert.deepEqual(
    resolveSafeDslitePedidoMutation(
      [
        { id: 'p1', dslite_id: '392520' },
        { id: 'p2', dslite_id: '392520' },
      ],
      '392520',
      'p1',
    ),
    { safe: false, ids: [], reason: 'ambiguous_nfe' },
  );
});

const reactivatedOrderFixture = {
  expectedDsliteId: '394584',
  expectedNfeKey: '43260865850289000183550020000008611029758401',
  expectedItems: [{ sku: 'MUSIC54002', quantity: 1 }],
  targetPedidoId: 'p1',
  pedidoCandidates: [{ id: 'p1', dslite_id: null }],
  purchase: {
    dsid: '394584',
    nf_chave: '43260865850289000183550020000008611029758401',
    fornecedor_id: '97',
  },
  remoteOrder: {
    dsid: 394584,
    status: 'Aguardando Informações',
    nf_chave: '43260865850289000183550020000008611029758401',
    fornecedor: { fornecedorid: 97 },
    items: [{ nf_produtoid: 'MUSIC54002', quantidade: 1 }],
  },
};

test('reutiliza pedido reativado somente com identidade exata', () => {
  assert.deepEqual(
    resolveSafeReactivatedDsliteOrderReuse(reactivatedOrderFixture),
    {
      safe: true,
      reason: 'reactivated_order_match',
      pedidoIds: ['p1'],
    },
  );
});

test('bloqueia reutilização quando item remoto diverge do XML', () => {
  const result = resolveSafeReactivatedDsliteOrderReuse({
    ...reactivatedOrderFixture,
    remoteOrder: {
      ...reactivatedOrderFixture.remoteOrder,
      items: [{ nf_produtoid: 'OUTRO', quantidade: 1 }],
    },
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'items_mismatch');
});

test('bloqueia reutilização fora de Aguardando Informações', () => {
  const result = resolveSafeReactivatedDsliteOrderReuse({
    ...reactivatedOrderFixture,
    remoteOrder: {
      ...reactivatedOrderFixture.remoteOrder,
      status: 'Em separação',
    },
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'status_not_reusable');
});

test('bloqueia reutilização quando outro pedido já possui o DSID', () => {
  const result = resolveSafeReactivatedDsliteOrderReuse({
    ...reactivatedOrderFixture,
    pedidoCandidates: [{ id: 'p1', dslite_id: '999999' }],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'conflicting_dslite_id');
});
