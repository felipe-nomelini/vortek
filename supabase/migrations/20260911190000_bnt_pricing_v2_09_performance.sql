-- BNT-PRICING-V2-09: visitas diárias e cobertura para desempenho 30/90/150.
-- A migration não publica, pausa nem altera preço no Mercado Livre.

create table public.ml_listing_visit_days (
  seller_id bigint not null check (seller_id > 0),
  ml_item_id text not null check (ml_item_id ~ '^ML[A-Z][0-9]+$'),
  metric_date date not null,
  visits integer not null check (visits >= 0),
  source text not null default 'mercado_livre_time_window'
    check (source = 'mercado_livre_time_window'),
  collected_at timestamptz not null,
  primary key (seller_id, ml_item_id, metric_date)
);

create table public.ml_listing_visit_coverage (
  seller_id bigint not null check (seller_id > 0),
  ml_item_id text not null check (ml_item_id ~ '^ML[A-Z][0-9]+$'),
  coverage_start date,
  coverage_end date,
  complete boolean not null default false,
  last_success_at timestamptz,
  last_attempt_at timestamptz not null,
  last_error_code text,
  source text not null default 'mercado_livre_time_window'
    check (source = 'mercado_livre_time_window'),
  primary key (seller_id, ml_item_id),
  check (
    (complete = false)
    or (
      coverage_start is not null
      and coverage_end is not null
      and coverage_start < coverage_end
      and coverage_end - coverage_start <= 150
      and last_success_at is not null
    )
  )
);

create index pedido_itens_ml_item_pedido_idx
  on public.pedido_itens (ml_item_id, pedido_id)
  where ml_item_id is not null;

alter table public.ml_listing_visit_days enable row level security;
alter table public.ml_listing_visit_coverage enable row level security;

revoke all on public.ml_listing_visit_days, public.ml_listing_visit_coverage
  from public, anon, authenticated, service_role;
grant select on public.ml_listing_visit_days, public.ml_listing_visit_coverage
  to service_role;

create function public.persist_ml_listing_visit_window(
  p_seller_id bigint,
  p_item_id text,
  p_range_start date,
  p_range_end date,
  p_complete boolean,
  p_points jsonb,
  p_collected_at timestamptz,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_days integer;
  point_count integer;
begin
  if p_seller_id is null or p_seller_id <= 0
    or p_item_id is null or p_item_id !~ '^ML[A-Z][0-9]+$'
    or p_range_start is null or p_range_end is null
    or p_range_start >= p_range_end
    or p_range_end - p_range_start > 150
    or p_collected_at is null
    or p_collected_at > clock_timestamp() + interval '1 minute'
    or p_complete is null
    or jsonb_typeof(p_points) is distinct from 'array'
  then
    raise exception 'invalid_visit_window';
  end if;

  expected_days := p_range_end - p_range_start;

  if p_complete then
    if p_error_code is not null then
      raise exception 'complete_visit_window_has_error';
    end if;

    select count(distinct point ->> 'date')
      into point_count
    from jsonb_array_elements(p_points) point;

    if point_count <> expected_days
      or jsonb_array_length(p_points) <> expected_days
      or exists (
        select 1
        from jsonb_array_elements(p_points) point
        where jsonb_typeof(point -> 'visits') is distinct from 'number'
          or (point ->> 'visits')::numeric <> trunc((point ->> 'visits')::numeric)
          or (point ->> 'visits')::numeric < 0
          or (point ->> 'date')::date < p_range_start
          or (point ->> 'date')::date >= p_range_end
      )
    then
      raise exception 'incomplete_visit_points';
    end if;

    insert into public.ml_listing_visit_days (
      seller_id, ml_item_id, metric_date, visits, collected_at
    )
    select
      p_seller_id,
      p_item_id,
      (point ->> 'date')::date,
      (point ->> 'visits')::integer,
      p_collected_at
    from jsonb_array_elements(p_points) point
    on conflict (seller_id, ml_item_id, metric_date) do update
      set visits = excluded.visits,
          collected_at = excluded.collected_at
      where excluded.collected_at >= public.ml_listing_visit_days.collected_at;

    insert into public.ml_listing_visit_coverage (
      seller_id, ml_item_id, coverage_start, coverage_end, complete,
      last_success_at, last_attempt_at, last_error_code
    ) values (
      p_seller_id, p_item_id, p_range_start, p_range_end, true,
      p_collected_at, p_collected_at, null
    )
    on conflict (seller_id, ml_item_id) do update
      set coverage_start = excluded.coverage_start,
          coverage_end = excluded.coverage_end,
          complete = true,
          last_success_at = excluded.last_success_at,
          last_attempt_at = greatest(
            public.ml_listing_visit_coverage.last_attempt_at,
            excluded.last_attempt_at
          ),
          last_error_code = case
            when excluded.last_success_at >= public.ml_listing_visit_coverage.last_attempt_at then null
            else public.ml_listing_visit_coverage.last_error_code
          end
      where excluded.last_success_at >= coalesce(
        public.ml_listing_visit_coverage.last_success_at,
        '-infinity'::timestamptz
      );
  else
    if jsonb_array_length(p_points) <> 0 or nullif(trim(p_error_code), '') is null then
      raise exception 'failed_visit_window_invalid';
    end if;

    insert into public.ml_listing_visit_coverage (
      seller_id, ml_item_id, complete, last_attempt_at, last_error_code
    ) values (
      p_seller_id, p_item_id, false, p_collected_at, left(trim(p_error_code), 120)
    )
    on conflict (seller_id, ml_item_id) do update
      set last_attempt_at = excluded.last_attempt_at,
          last_error_code = excluded.last_error_code
      where excluded.last_attempt_at >= public.ml_listing_visit_coverage.last_attempt_at;
  end if;

  return jsonb_build_object(
    'applied', true,
    'complete', p_complete,
    'itemId', p_item_id,
    'from', p_range_start,
    'to', p_range_end
  );
end;
$$;

revoke all on function public.persist_ml_listing_visit_window(
  bigint, text, date, date, boolean, jsonb, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.persist_ml_listing_visit_window(
  bigint, text, date, date, boolean, jsonb, timestamptz, text
) to service_role;

comment on table public.ml_listing_visit_days is
  'Visitas diárias observadas no Mercado Livre; não contém decisão econômica.';
comment on table public.ml_listing_visit_coverage is
  'Cobertura comprovada da coleta diária de visitas por anúncio.';

notify pgrst, 'reload schema';
