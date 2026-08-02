-- A devolução desta venda voltou ao remetente em Porto Alegre, não ao
-- estoque interno da Vortek no Rio de Janeiro. Remove somente o movimento
-- legado ainda não revisado; pedido e item permanecem preservados.
delete from public.estoque_interno_movimentacoes as movimento
using public.pedidos as pedido, public.produtos as produto
where movimento.pedido_id = pedido.id
  and movimento.produto_id = produto.id
  and pedido.ml_order_id = '2000017420434766'
  and produto.sku = 'VTK012762'
  and movimento.tipo = 'entrada_devolucao'
  and movimento.situacao_estoque = 'revisao'
  and movimento.disponivel_venda = false;
