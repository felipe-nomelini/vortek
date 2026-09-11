-- Central de pricing paginada por produto. Leitura exclusivamente server-side.
create or replace function public.search_pricing_decision_product_ids(
  p_view text default 'alerts',
  p_state text default 'open',
  p_severity text default null,
  p_decision text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 30
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select greatest(p_page, 1) as page,
      least(greatest(p_page_size, 1), 100) as page_size,
      statement_timestamp() as observed_at
  ),
  eligible as (
    select a.produto_id, a.severity_order, a.created_at, a.id
    from public.pricing_alerts a
    join public.produtos p on p.id = a.produto_id
    left join public.pricing_decisions d on d.id = a.latest_decision_id
    cross join input i
    where a.merged_into is null
      and p_view in ('alerts', 'decisions')
      and (p_view = 'alerts' or d.id is not null)
      and (p_state = 'all' or a.state = p_state)
      and (p_severity is null or a.severity = p_severity)
      and (
        nullif(trim(p_search), '') is null
        or p.nome ilike '%' || trim(p_search) || '%'
        or p.sku ilike '%' || trim(p_search) || '%'
        or a.item_id = upper(trim(p_search))
      )
      and (
        p_decision is null
        or (p_decision = 'expired' and d.operation_id is null and
          (d.state = 'expired' or (d.state in ('pending','deferred','approved') and d.expires_at <= i.observed_at)))
        or (p_decision <> 'expired' and d.state = p_decision and
          (d.state not in ('pending','deferred','approved') or d.expires_at > i.observed_at or d.operation_id is not null))
      )
  ),
  grouped as (
    select produto_id, min(severity_order) as priority, min(created_at) as opened_at, min(id::text) as tie_id
    from eligible group by produto_id
  ),
  paged as (
    select g.produto_id,
      row_number() over (order by g.priority, g.opened_at, g.tie_id) as ord
    from grouped g
    order by g.priority, g.opened_at, g.tie_id
    offset (select (page - 1) * page_size from input)
    limit (select page_size from input)
  ),
  counters as (
    select
      count(distinct a.produto_id) filter (where a.state = 'open' and a.merged_into is null) as affected_products,
      count(*) filter (where a.state = 'open' and a.merged_into is null) as open_alerts,
      count(distinct a.produto_id) filter (where a.merged_into is null and d.id is not null
        and (d.state in ('pending','deferred','approved'))
        and (d.expires_at > statement_timestamp() or d.operation_id is not null)) as pending_decisions
    from public.pricing_alerts a
    left join public.pricing_decisions d on d.id = a.latest_decision_id
  )
  select jsonb_build_object(
    'productIds', coalesce((select jsonb_agg(produto_id order by ord) from paged), '[]'::jsonb),
    'total', (select count(*) from grouped),
    'affectedProductCount', affected_products,
    'openAlertCount', open_alerts,
    'pendingDecisionCount', pending_decisions
  )
  from counters;
$$;

revoke all on function public.search_pricing_decision_product_ids(text,text,text,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.search_pricing_decision_product_ids(text,text,text,text,text,integer,integer)
  to service_role;

comment on function public.search_pricing_decision_product_ids(text,text,text,text,text,integer,integer) is
  'Pagina a central por produto e devolve somente IDs/contadores; detalhes permanecem no backend autenticado.';
