create table public.ml_brand_equivalences (
  id uuid primary key default gen_random_uuid(),
  brand_a text not null,
  brand_b text not null,
  brand_a_key text not null,
  brand_b_key text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ml_brand_equivalences_order check (brand_a_key < brand_b_key),
  constraint ml_brand_equivalences_pair unique (brand_a_key, brand_b_key)
);

create table public.ml_stock_pause_ownership (
  ml_item_id text primary key,
  outbox_id uuid not null references public.anuncios_ml_outbox(id),
  remote_last_updated timestamptz not null,
  active boolean not null default true,
  released_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ml_brand_equivalence_audit (
  id uuid primary key default gen_random_uuid(),
  equivalence_id uuid not null references public.ml_brand_equivalences(id),
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'updated')),
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);

create function public.audit_ml_brand_equivalence() returns trigger
language plpgsql as $$
begin
  insert into public.ml_brand_equivalence_audit
    (equivalence_id, actor_id, action, before_value, after_value)
  values (
    new.id, new.updated_by,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else jsonb_build_object(
      'brand_a', old.brand_a, 'brand_b', old.brand_b, 'active', old.active) end,
    jsonb_build_object('brand_a', new.brand_a, 'brand_b', new.brand_b, 'active', new.active)
  );
  return new;
end $$;

create trigger audit_ml_brand_equivalence
after insert or update on public.ml_brand_equivalences
for each row execute function public.audit_ml_brand_equivalence();

create index ml_stock_pause_ownership_active_idx
  on public.ml_stock_pause_ownership (active) where active;

alter table public.ml_brand_equivalences enable row level security;
alter table public.ml_brand_equivalence_audit enable row level security;
alter table public.ml_stock_pause_ownership enable row level security;
revoke all on public.ml_brand_equivalences, public.ml_brand_equivalence_audit, public.ml_stock_pause_ownership from public, anon, authenticated;
grant select, insert, update on public.ml_brand_equivalences, public.ml_stock_pause_ownership to service_role;
grant select, insert on public.ml_brand_equivalence_audit to service_role;

insert into public.ml_brand_equivalences
  (brand_a, brand_b, brand_a_key, brand_b_key)
values ('Storm', 'Stormtech', 'storm', 'stormtech')
on conflict (brand_a_key, brand_b_key) do nothing;
