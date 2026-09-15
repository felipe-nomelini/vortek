do $$
declare
  function_definition text;
  old_guard constant text := 'or snapshot_row.produto_id is distinct from product_id';
  new_guard constant text := 'or (snapshot_row.produto_id is not null and snapshot_row.produto_id is distinct from product_id)';
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_ml_catalog_identity_projection(uuid,uuid,text,uuid,jsonb)'::regprocedure
  ) into function_definition;

  if function_definition is null or pg_catalog.strpos(function_definition, old_guard) = 0 then
    raise exception 'apply_ml_catalog_identity_projection_guard_not_found';
  end if;

  execute pg_catalog.replace(function_definition, old_guard, new_guard);
end;
$$;

revoke all on function public.apply_ml_catalog_identity_projection(uuid,uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_ml_catalog_identity_projection(uuid,uuid,text,uuid,jsonb)
  to service_role;

notify pgrst, 'reload schema';
