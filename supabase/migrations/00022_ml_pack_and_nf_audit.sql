alter table public.pedidos
  add column if not exists ml_pack_id text;

create index if not exists idx_pedidos_ml_pack_id on public.pedidos (ml_pack_id);

create table if not exists public.nf_auditoria_eventos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  ml_order_id text,
  ml_pack_id text,
  evento text not null,
  payload_enviado jsonb,
  resposta_ml jsonb,
  status_resultante text,
  created_at timestamptz not null default now()
);

create index if not exists idx_nf_auditoria_eventos_pedido_id on public.nf_auditoria_eventos (pedido_id);
create index if not exists idx_nf_auditoria_eventos_ml_order_id on public.nf_auditoria_eventos (ml_order_id);
create index if not exists idx_nf_auditoria_eventos_created_at on public.nf_auditoria_eventos (created_at desc);

-- regra de consistência: só considerar emitida quando status está autorizado
update public.pedidos
set nota_fiscal_emitida = false
where nota_fiscal_emitida = true
  and coalesce(lower(nfe_status), '') not in ('authorized', 'autorizada');
