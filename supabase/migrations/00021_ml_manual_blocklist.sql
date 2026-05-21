create table if not exists public.ml_manual_blocklist (
  id uuid primary key default uuid_generate_v4(),
  sku text null,
  ml_item_id text null,
  ativo boolean not null default true,
  motivo text null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ml_manual_blocklist_ativo
  on public.ml_manual_blocklist (ativo);

create unique index if not exists uq_ml_manual_blocklist_ml_item_id_ativo
  on public.ml_manual_blocklist (ml_item_id)
  where ativo = true and ml_item_id is not null;

drop trigger if exists set_updated_at_ml_manual_blocklist on public.ml_manual_blocklist;
create trigger set_updated_at_ml_manual_blocklist
before update on public.ml_manual_blocklist
for each row execute function public.set_updated_at();

insert into public.ml_manual_blocklist (sku, ml_item_id, ativo, motivo, created_by)
values ('HYX84825', 'MLB6573107112', true, 'ajuste manual temporário', 'migration_00021')
on conflict do nothing;

