-- Executar com migration carregada dentro de BEGIN ... ROLLBACK, apenas DEV .162.
do $$
declare
  p uuid; r jsonb; a jsonb; b jsonb; pair jsonb; t timestamptz:=clock_timestamp()-interval '1 hour';
  ga uuid; gb uuid; v integer;
begin
  select id into p from public.produtos limit 1;
  if p is null then raise exception 'test_requires_dev_product'; end if;
  a := '{"anchorItemId":"CFL_TEST_STANDARD","anchorVariationId":"","state":"verified","synchronized":false,"members":[{"itemId":"CFL_TEST_STANDARD","variationId":"","catalog":false}],"reasons":["TEST"],"evidence":[]}'::jsonb;
  b := '{"anchorItemId":"CFL_TEST_CATALOG","anchorVariationId":"","state":"verified","synchronized":false,"members":[{"itemId":"CFL_TEST_CATALOG","variationId":"","catalog":true}],"reasons":["TEST"],"evidence":[]}'::jsonb;
  a := jsonb_set(a,'{evidence}',jsonb_build_array(jsonb_build_object('source','mercado_livre','reference','TEST_A','collectedAt',t,'condition','valid')));
  b := jsonb_set(b,'{evidence}',jsonb_build_array(jsonb_build_object('source','mercado_livre','reference','TEST_B','collectedAt',t,'condition','valid')));
  r := public.reconcile_ml_pricing_groups(9900301,p,t,true,jsonb_build_array(a,b));
  ga := (r->'groups'->0->>'groupId')::uuid; gb := (r->'groups'->1->>'groupId')::uuid;
  if (select count(*) from public.ml_pricing_group_members where seller_id=9900301 and is_current)<>2 then raise exception 'independent_members'; end if;
  perform public.reconcile_ml_pricing_groups(9900301,p,t,true,jsonb_build_array(a,b));
  if (select current_version from public.ml_pricing_groups where id=ga)<>1 then raise exception 'idempotency'; end if;
  pair := jsonb_set(jsonb_set(a,'{members}',(a->'members')||(b->'members')),'{synchronized}','true');
  perform public.reconcile_ml_pricing_groups(9900301,p,t+interval '1 minute',true,jsonb_build_array(pair));
  if (select state from public.ml_pricing_groups where id=gb)<>'retired' then raise exception 'merge_retirement'; end if;
  if (select current_version from public.ml_pricing_groups where id=ga)<>2 then raise exception 'merge_version'; end if;
  if not (select gb=any(predecessor_ids) from public.ml_pricing_group_revisions where group_id=ga and version=2) then raise exception 'merge_history'; end if;
  perform public.reconcile_ml_pricing_groups(9900301,p,t+interval '2 minutes',false,'[]');
  if (select state from public.ml_pricing_groups where id=ga)<>'unverified' then raise exception 'failure_unverified'; end if;
  if (select count(*) from public.ml_pricing_group_members where group_id=ga and is_current)<>2 then raise exception 'failure_preserves_members'; end if;
  perform public.reconcile_ml_pricing_groups(9900301,p,t+interval '3 minutes',false,'[]');
  if (select current_version from public.ml_pricing_groups where id=ga)<>3 then raise exception 'repeated_failure_dedupe'; end if;
  r := public.reconcile_ml_pricing_groups(9900301,p,t,true,jsonb_build_array(a,b));
  if (r->>'applied')::boolean then raise exception 'stale_overwrite'; end if;
  perform public.reconcile_ml_pricing_groups(9900301,p,t+interval '4 minutes',true,jsonb_build_array(a,b));
  if (select current_version from public.ml_pricing_groups where id=ga)<>4 or (select state from public.ml_pricing_groups where id=gb)<>'verified' then raise exception 'split_identity'; end if;
  if (select count(*) from public.ml_pricing_group_members where seller_id=9900301 and is_current)<>2 then raise exception 'split_unique_members'; end if;
  begin
    perform public.reconcile_ml_pricing_groups(9900301,p,t+interval '5 minutes',true,jsonb_build_array(a,a));
    raise exception 'duplicate_should_fail';
  exception when others then if sqlerrm='duplicate_should_fail' then raise; end if; end;
  if (select current_version from public.ml_pricing_groups where id=ga)<>4 then raise exception 'atomic_failure'; end if;
  if has_table_privilege('anon','public.ml_pricing_groups','SELECT') or has_table_privilege('authenticated','public.ml_pricing_group_members','INSERT')
    or has_function_privilege('authenticated','public.reconcile_ml_pricing_groups(bigint,uuid,timestamptz,boolean,jsonb)','EXECUTE')
    or has_table_privilege('service_role','public.ml_pricing_group_revisions','UPDATE') then raise exception 'privilege_leak'; end if;
  if (select count(*) from pg_class where oid in ('public.ml_pricing_groups'::regclass,'public.ml_pricing_group_revisions'::regclass,'public.ml_pricing_group_members'::regclass) and relrowsecurity)<>3 then raise exception 'rls_missing'; end if;
  raise notice 'CFL03: idempotency, merge, split, failure, stale, atomicity and grants passed';
end $$;
