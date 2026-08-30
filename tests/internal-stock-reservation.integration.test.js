const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const enabled = process.env.RUN_VORTEK_DEV_DB_TESTS === '1';

test('supabase-dev serializa reserva, retry, despacho e cancelamento', {
  skip: !enabled,
}, async () => {
  assert.equal(
    process.env.VORTEK_SUPABASE_TARGET,
    '192.168.1.162',
    'Teste protegido: informe explicitamente o host supabase-dev.',
  );
  const url = String(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  assert.ok(url && key, 'Credenciais service-role do supabase-dev são obrigatórias.');
  assert.equal(/app\.vortek\.shop/i.test(url), false, 'Produção não é permitida neste teste.');

  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const productId = crypto.randomUUID();
  const orderA = crypto.randomUUID();
  const orderB = crypto.randomUUID();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const sku = `STO-${suffix}`.toUpperCase();
  const numeroBase = Date.now() * 1000;
  const item = [{ produto_id: productId, sku, quantidade: 1 }];

  try {
    const { error: productError } = await db.from('produtos').insert({
      id: productId,
      sku,
      nome: `Fixture reserva atômica ${suffix}`,
    });
    assert.ifError(productError);

    const { error: ordersError } = await db.from('pedidos').insert([
      { id: orderA, numero: numeroBase + 1, contato_nome: 'Fixture STO A' },
      { id: orderB, numero: numeroBase + 2, contato_nome: 'Fixture STO B' },
    ]);
    assert.ifError(ordersError);

    const { error: entryError } = await db.from('estoque_interno_movimentacoes').insert({
      produto_id: productId,
      tipo: 'entrada_devolucao',
      quantidade: 1,
      motivo: 'Fixture reserva atômica',
      situacao_estoque: 'liberado',
      disponivel_venda: true,
      status_devolucao: 'manual',
    });
    assert.ifError(entryError);

    const reserve = (pedidoId) => db.rpc('select_order_fulfillment', {
      p_pedido_id: pedidoId,
      p_source: 'internal',
      p_items: item,
    });
    const concurrent = await Promise.all([reserve(orderA), reserve(orderB)]);
    const success = concurrent
      .map((result, index) => ({ result, pedidoId: index === 0 ? orderA : orderB }))
      .filter(({ result }) => !result.error);
    const rejected = concurrent.filter((result) => result.error);
    assert.equal(success.length, 1, 'Somente um pedido pode reservar o saldo 1.');
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].error.message), /internal_stock_insufficient/);

    const winner = success[0].pedidoId;
    const loser = winner === orderA ? orderB : orderA;
    const retry = await reserve(winner);
    assert.ifError(retry.error);

    const { data: activeRows, error: activeRowsError } = await db
      .from('estoque_interno_movimentacoes')
      .select('pedido_id,quantidade,estado_envio_interno,despachado_em,estornada_em')
      .eq('produto_id', productId)
      .eq('tipo', 'saida_envio_interno');
    assert.ifError(activeRowsError);
    assert.equal(activeRows.length, 1, 'Retry não pode duplicar a reserva.');
    assert.equal(activeRows[0].pedido_id, winner);
    assert.equal(activeRows[0].estado_envio_interno, 'reservado');
    assert.equal(activeRows[0].despachado_em, null);

    const { data: selectedOrders, error: selectedOrdersError } = await db
      .from('pedidos')
      .select('id,fulfillment_source,envio_interno_at')
      .in('id', [orderA, orderB]);
    assert.ifError(selectedOrdersError);
    assert.equal(selectedOrders.find((order) => order.id === winner).fulfillment_source, 'internal');
    assert.equal(selectedOrders.find((order) => order.id === winner).envio_interno_at, null);
    assert.equal(selectedOrders.find((order) => order.id === loser).fulfillment_source, null);

    const supplierSelection = await db.rpc('select_order_fulfillment', {
      p_pedido_id: loser,
      p_source: 'supplier',
      p_items: null,
    });
    assert.ifError(supplierSelection.error);

    const dispatch = await db.rpc('dispatch_internal_stock_reservation', {
      p_pedido_id: winner,
    });
    assert.ifError(dispatch.error);
    assert.equal(Number(dispatch.data?.[0]?.movimentos_atualizados), 1);
    const dispatchRetry = await db.rpc('dispatch_internal_stock_reservation', {
      p_pedido_id: winner,
    });
    assert.ifError(dispatchRetry.error);
    assert.equal(Number(dispatchRetry.data?.[0]?.movimentos_atualizados), 0);

    const reverse = await db.rpc('reverse_internal_stock_commitment', {
      p_pedido_id: winner,
      p_motivo: 'Cancelamento da fixture',
    });
    assert.ifError(reverse.error);
    assert.equal(Number(reverse.data?.[0]?.movimentos_atualizados), 1);
    const reverseRetry = await db.rpc('reverse_internal_stock_commitment', {
      p_pedido_id: winner,
      p_motivo: 'Cancelamento da fixture',
    });
    assert.ifError(reverseRetry.error);
    assert.equal(Number(reverseRetry.data?.[0]?.movimentos_atualizados), 0);

    const { data: finalRows, error: finalRowsError } = await db
      .from('estoque_interno_movimentacoes')
      .select('estado_envio_interno,despachado_em,estornada_em')
      .eq('produto_id', productId)
      .eq('tipo', 'saida_envio_interno');
    assert.ifError(finalRowsError);
    assert.equal(finalRows[0].estado_envio_interno, 'despachado');
    assert.ok(finalRows[0].despachado_em);
    assert.ok(finalRows[0].estornada_em);
  } finally {
    await db.from('estoque_interno_movimentacoes').delete().eq('produto_id', productId);
    await db.from('pedidos').delete().in('id', [orderA, orderB]);
    await db.from('produtos').delete().eq('id', productId);
  }
});
