-- Execute somente em ambiente autorizado e dentro de BEGIN/ROLLBACK.
do $$
declare
  collected timestamptz := clock_timestamp();
  points jsonb;
  result jsonb;
begin
  select jsonb_agg(jsonb_build_object('date', day::date, 'visits', 1) order by day)
    into points
  from generate_series(date '2026-04-14', date '2026-09-10', interval '1 day') day;

  result := public.persist_ml_listing_visit_window(
    9900909,
    'MLB990090901',
    date '2026-04-14',
    date '2026-09-11',
    true,
    points,
    collected,
    null
  );

  if result ->> 'complete' <> 'true'
    or (select count(*) from public.ml_listing_visit_days where seller_id = 9900909 and ml_item_id = 'MLB990090901') <> 150
    or not exists (
      select 1 from public.ml_listing_visit_coverage
      where seller_id = 9900909 and ml_item_id = 'MLB990090901'
        and complete and coverage_start = date '2026-04-14' and coverage_end = date '2026-09-11'
    )
  then
    raise exception 'visit_window_not_persisted';
  end if;

  perform public.persist_ml_listing_visit_window(
    9900909,
    'MLB990090901',
    date '2026-04-14',
    date '2026-09-11',
    false,
    '[]'::jsonb,
    collected + interval '1 second',
    'temporary_failure'
  );

  if not exists (
    select 1 from public.ml_listing_visit_coverage
    where seller_id = 9900909 and ml_item_id = 'MLB990090901'
      and complete and last_error_code = 'temporary_failure'
  ) then
    raise exception 'failed_attempt_erased_successful_coverage';
  end if;

  perform public.persist_ml_listing_visit_window(
    9900909,
    'MLB990090903',
    date '2026-04-14',
    date '2026-09-11',
    false,
    '[]'::jsonb,
    collected + interval '2 seconds',
    'concurrent_failure'
  );
  perform public.persist_ml_listing_visit_window(
    9900909,
    'MLB990090903',
    date '2026-04-14',
    date '2026-09-11',
    true,
    points,
    collected + interval '1 second',
    null
  );

  if not exists (
    select 1 from public.ml_listing_visit_coverage
    where seller_id = 9900909 and ml_item_id = 'MLB990090903'
      and complete
      and last_success_at = collected + interval '1 second'
      and last_attempt_at = collected + interval '2 seconds'
      and last_error_code = 'concurrent_failure'
  ) then
    raise exception 'valid_concurrent_success_lost';
  end if;

  begin
    perform public.persist_ml_listing_visit_window(
      9900909,
      'MLB990090902',
      date '2026-04-14',
      date '2026-09-11',
      true,
      points - 0,
      collected,
      null
    );
    raise exception 'incomplete_points_accepted';
  exception when others then
    if sqlerrm <> 'incomplete_visit_points' then raise; end if;
  end;

  if has_table_privilege('authenticated', 'public.ml_listing_visit_days', 'SELECT')
    or has_table_privilege('authenticated', 'public.ml_listing_visit_coverage', 'SELECT')
    or has_function_privilege(
      'authenticated',
      'public.persist_ml_listing_visit_window(bigint,text,date,date,boolean,jsonb,timestamptz,text)',
      'EXECUTE'
    )
  then
    raise exception 'unsafe_performance_grants';
  end if;

  if has_table_privilege('service_role', 'public.ml_listing_visit_days', 'INSERT')
    or has_table_privilege('service_role', 'public.ml_listing_visit_days', 'UPDATE')
    or has_table_privilege('service_role', 'public.ml_listing_visit_coverage', 'INSERT')
    or has_table_privilege('service_role', 'public.ml_listing_visit_coverage', 'UPDATE')
  then
    raise exception 'service_role_can_bypass_performance_rpc';
  end if;

  raise notice 'Pricing performance: persistence, coverage and privileges passed';
end $$;
