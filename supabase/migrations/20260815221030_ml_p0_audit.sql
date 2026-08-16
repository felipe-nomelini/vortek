create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.ml_p0_population_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  fornecedor_id text not null,
  fornecedor_nome text not null,
  oferta_preferencial_id uuid not null references public.produto_fornecedor_ofertas(id) on delete restrict,
  captured_at timestamptz not null default now(),
  snapshot jsonb not null,
  unique (job_id, produto_id),
  unique (job_id, sku)
);

create index if not exists idx_ml_p0_population_job_supplier
  on public.ml_p0_population_snapshots (job_id, fornecedor_id, sku);

create table if not exists public.ml_p0_publication_audits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  population_snapshot_id uuid not null references public.ml_p0_population_snapshots(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  fornecedor_id text not null,
  fornecedor_nome text not null,
  priority_rank integer,
  confidence_score integer check (confidence_score between 0 and 100),
  audit_status text check (
    audit_status is null or audit_status in (
      'P0_READY',
      'P0_PUBLISHED',
      'P0_MANUAL_GTIN',
      'P0_MANUAL_IDENTITY',
      'P0_MANUAL_IMAGE',
      'P0_MANUAL_TECH',
      'P0_API_ERROR'
    )
  ),
  validation_status text,
  publication_action text check (
    publication_action is null or publication_action in ('create_new', 'link_existing', 'none')
  ),
  block_reason text,
  ml_item_id text,
  level0_snapshot jsonb not null default '{}'::jsonb,
  dslite_raw jsonb not null default '{}'::jsonb,
  official_sources jsonb not null default '[]'::jsonb,
  evidence_ledger jsonb not null default '[]'::jsonb,
  image_audit jsonb not null default '{}'::jsonb,
  ml_schema_audit jsonb not null default '{}'::jsonb,
  content_snapshot jsonb not null default '{}'::jsonb,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  duplicate_audit jsonb not null default '{}'::jsonb,
  eligibility_drift jsonb not null default '{}'::jsonb,
  event_log jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, produto_id),
  unique (job_id, sku)
);

create index if not exists idx_ml_p0_audits_job_status
  on public.ml_p0_publication_audits (job_id, audit_status, fornecedor_id);
create index if not exists idx_ml_p0_audits_job_score
  on public.ml_p0_publication_audits (job_id, confidence_score desc nulls last);

alter table public.ml_p0_population_snapshots enable row level security;
alter table public.ml_p0_publication_audits enable row level security;

revoke all on table public.ml_p0_population_snapshots from anon, authenticated;
revoke all on table public.ml_p0_publication_audits from anon, authenticated;
grant select, insert on table public.ml_p0_population_snapshots to service_role;
grant select, insert, update on table public.ml_p0_publication_audits to service_role;

create or replace function private.prevent_ml_p0_population_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ml_p0_population_snapshots is immutable';
end;
$$;

drop trigger if exists protect_ml_p0_population_snapshots on public.ml_p0_population_snapshots;
create trigger protect_ml_p0_population_snapshots
before update or delete on public.ml_p0_population_snapshots
for each row execute function private.prevent_ml_p0_population_mutation();

create or replace function private.capture_ml_p0_population(
  p_job_id uuid,
  p_expected_total integer default 501,
  p_expected_hayamax integer default 103,
  p_expected_bkr1 integer default 123,
  p_expected_evolusom integer default 275
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_hayamax integer;
  v_bkr1 integer;
  v_evolusom integer;
  v_hash text;
begin
  if not exists (select 1 from public.jobs where id = p_job_id and tipo = 'ml_p0_premium_audit') then
    raise exception 'invalid ml_p0 audit job %', p_job_id;
  end if;

  with eligible as (
    select p.id as produto_id, o.dslite_fornecedor_id
    from public.produtos p
    join public.produto_fornecedor_ofertas o on o.id = p.oferta_preferencial_id
    where p.ativo is true
      and p.ml_status::text = 'sem_anuncio'
      and p.estoque > 0
      and p.ml_item_id is null
      and coalesce(nullif(trim(p.ml_shipping_warning), ''), '') = ''
      and o.produto_id = p.id
      and o.ativo is true
      and o.estoque > 0
      and o.custo > 0
  )
  select
    count(*)::integer,
    count(*) filter (where dslite_fornecedor_id = '2')::integer,
    count(*) filter (where dslite_fornecedor_id = '108')::integer,
    count(*) filter (where dslite_fornecedor_id = '133')::integer
  into v_total, v_hayamax, v_bkr1, v_evolusom
  from eligible;

  if v_total <> p_expected_total
     or v_hayamax <> p_expected_hayamax
     or v_bkr1 <> p_expected_bkr1
     or v_evolusom <> p_expected_evolusom then
    raise exception 'P0_BASELINE_MISMATCH total=% hayamax=% bkr1=% evolusom=%',
      v_total, v_hayamax, v_bkr1, v_evolusom;
  end if;

  insert into public.ml_p0_population_snapshots (
    job_id, produto_id, sku, fornecedor_id, fornecedor_nome,
    oferta_preferencial_id, captured_at, snapshot
  )
  select
    p_job_id,
    p.id,
    p.sku,
    o.dslite_fornecedor_id,
    coalesce(o.fornecedor_nome, p.fornecedor, o.dslite_fornecedor_id),
    o.id,
    statement_timestamp(),
    jsonb_build_object(
      'produto', to_jsonb(p),
      'oferta_preferencial', to_jsonb(o),
      'criteria', jsonb_build_object(
        'produto_ativo', p.ativo is true,
        'ml_sem_anuncio', p.ml_status::text = 'sem_anuncio',
        'estoque_positivo', p.estoque > 0,
        'sem_ml_item_id', p.ml_item_id is null,
        'sem_shipping_warning', coalesce(nullif(trim(p.ml_shipping_warning), ''), '') = '',
        'oferta_produto_match', o.produto_id = p.id,
        'oferta_ativa', o.ativo is true,
        'oferta_estoque_positivo', o.estoque > 0,
        'oferta_custo_positivo', o.custo > 0
      )
    )
  from public.produtos p
  join public.produto_fornecedor_ofertas o on o.id = p.oferta_preferencial_id
  where p.ativo is true
    and p.ml_status::text = 'sem_anuncio'
    and p.estoque > 0
    and p.ml_item_id is null
    and coalesce(nullif(trim(p.ml_shipping_warning), ''), '') = ''
    and o.produto_id = p.id
    and o.ativo is true
    and o.estoque > 0
    and o.custo > 0
  order by p.sku;

  select encode(
    extensions.digest(
      convert_to(string_agg(snapshot::text, E'\n' order by sku), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
  into v_hash
  from public.ml_p0_population_snapshots
  where job_id = p_job_id;

  update public.jobs
  set total = v_total,
      status = 'processando',
      progresso = 0,
      processados = 0,
      log = coalesce(log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'event', 'p0_population_captured',
        'timestamp', statement_timestamp(),
        'total', v_total,
        'by_supplier', jsonb_build_object('2', v_hayamax, '108', v_bkr1, '133', v_evolusom),
        'sha256', v_hash
      ))
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'total', v_total,
    'by_supplier', jsonb_build_object('2', v_hayamax, '108', v_bkr1, '133', v_evolusom),
    'sha256', v_hash
  );
end;
$$;

revoke all on function private.capture_ml_p0_population(uuid, integer, integer, integer, integer) from public;
grant execute on function private.capture_ml_p0_population(uuid, integer, integer, integer, integer) to postgres;

drop trigger if exists set_updated_at_ml_p0_publication_audits on public.ml_p0_publication_audits;
create trigger set_updated_at_ml_p0_publication_audits
before update on public.ml_p0_publication_audits
for each row execute function public.set_updated_at();
