-- O shipment 47526326896 foi concluído como `not_delivered/returned`.
-- Para envios sem claim, o endereço de origem da ida não representa o destino
-- da devolução. A conta ML confirma o endereço padrão de devolução no Rio de
-- Janeiro (address_id 1634853936 / CEP 21011550), onde o item foi recebido.
insert into public.estoque_interno_movimentacoes (
  produto_id,
  pedido_id,
  tipo,
  quantidade,
  motivo,
  disponivel_venda,
  created_at,
  situacao_estoque,
  status_devolucao
)
select
  produto.id,
  pedido.id,
  'entrada_devolucao',
  item.quantidade::integer,
  'Destinatário ausente',
  true,
  '2026-07-30T18:52:34.929Z'::timestamptz,
  'liberado',
  'returned'
from public.pedidos as pedido
join public.pedido_itens as item
  on item.pedido_id = pedido.id
join public.produtos as produto
  on produto.sku = item.seller_sku
where pedido.ml_order_id = '2000017420434766'
  and item.seller_sku = 'VTK012762'
  and item.quantidade > 0
on conflict (pedido_id, produto_id, tipo) do update
set quantidade = excluded.quantidade,
    motivo = excluded.motivo,
    disponivel_venda = excluded.disponivel_venda,
    situacao_estoque = excluded.situacao_estoque,
    status_devolucao = excluded.status_devolucao,
    estornada_em = null,
    estorno_motivo = null;

-- Replica efeito da liberação pela API: publica saldo interno corrigido no ML.
insert into public.anuncios_ml_outbox (
  produto_id,
  ml_item_id,
  desired_status,
  desired_quantity,
  source,
  payload,
  status,
  available_at
)
select
  produto.id,
  produto.ml_item_id,
  'ativo',
  2,
  'internal_stock_air_fryer_return_correction',
  jsonb_build_object(
    'apply_price', false,
    'apply_quantity_pricing', false,
    'apply_quantity', true,
    'apply_status', true,
    'sku', produto.sku,
    'estoque_fornecedor', produto.estoque,
    'estoque_interno', 2,
    'estoque_disponivel', greatest(produto.estoque, 2)
  ),
  'pending',
  now()
from public.produtos as produto
where produto.sku = 'VTK012762'
  and nullif(produto.ml_item_id, '') is not null
  and not exists (
    select 1
    from public.ml_manual_blocklist as bloqueio
    where bloqueio.ativo = true
      and (
        bloqueio.sku = produto.sku
        or bloqueio.ml_item_id = produto.ml_item_id
      )
  )
  and not exists (
    select 1
    from public.anuncios_ml_outbox as outbox
    where outbox.produto_id = produto.id
      and outbox.ml_item_id = produto.ml_item_id
      and outbox.source = 'internal_stock_air_fryer_return_correction'
  );
