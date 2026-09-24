-- Registra somente transições de cancelamento após a instalação da migration.
-- O envio ocorre fora da transação, no executor já agendado de cancelamentos.
create table if not exists public.supplier_cancellation_notices (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  compra_id uuid references public.compras(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'failed', 'sent', 'skipped', 'blocked')),
  recipients jsonb not null default '{}'::jsonb,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists supplier_cancellation_notices_due_idx
  on public.supplier_cancellation_notices (next_attempt_at, created_at)
  where status in ('pending', 'failed');

alter table public.supplier_cancellation_notices enable row level security;
revoke all on public.supplier_cancellation_notices from anon, authenticated;
grant select, insert, update on public.supplier_cancellation_notices to service_role;

create or replace function public.enqueue_supplier_cancellation_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.situacao::text is distinct from 'cancelado' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.situacao::text = 'cancelado' then
      return new;
    end if;
  end if;
  insert into public.supplier_cancellation_notices (pedido_id)
  values (new.id)
  on conflict (pedido_id) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_supplier_cancellation_notice() from public;

drop trigger if exists pedidos_supplier_cancellation_notice on public.pedidos;
create trigger pedidos_supplier_cancellation_notice
  after insert or update of situacao on public.pedidos
  for each row execute function public.enqueue_supplier_cancellation_notice();

-- Recuperação: desativar primeiro o executor novo; os registros podem ser
-- preservados para auditoria. Para remover: drop trigger, function, table.
