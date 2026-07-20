create table if not exists public.estoque_interno_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  pedido_id uuid references public.pedidos(id) on delete set null,
  tipo text not null check (tipo in ('entrada_devolucao','saida_envio_interno')),
  quantidade integer not null check (quantidade > 0),
  motivo text not null,
  disponivel_venda boolean not null default false,
  created_at timestamptz not null default now(),
  unique (pedido_id, produto_id, tipo)
);
create index if not exists idx_estoque_interno_produto on public.estoque_interno_movimentacoes(produto_id);
alter table public.estoque_interno_movimentacoes enable row level security;

-- Devoluções já confirmadas passam a aparecer bloqueadas para conferência física.
insert into public.estoque_interno_movimentacoes (
  produto_id, pedido_id, tipo, quantidade, motivo, disponivel_venda
)
select
  produto.id,
  pedido_item.pedido_id,
  'entrada_devolucao',
  pedido_item.quantidade,
  'Devolução confirmada',
  false
from public.pedidos pedido
join public.pedido_itens pedido_item on pedido_item.pedido_id = pedido.id
join public.produtos produto on produto.sku = pedido_item.seller_sku
where pedido.situacao = 'devolvido'
on conflict (pedido_id, produto_id, tipo) do nothing;
