-- Executar dentro da transação de validação da migration, com ROLLBACK.
do $$
declare p uuid; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); e jsonb; n bigint;
begin
 select id into p from public.produtos order by id limit 1;
 if exists(select 1 from public.configuracoes where pricing_tax_config?'variableCosts') then raise exception 'LEGACY_CONFIG_ACTIVE'; end if;
 if exists(select 1 from public.current_pricing_evaluations where memory?'variableCosts') then raise exception 'LEGACY_MEMORY_CURRENT'; end if;
 e:=jsonb_build_object('id',first_id,'event_type','STRATEGY_REGISTERED','produto_id',p,'pricing_group_id','validation:canon','pricing_source','manual_pricing_override','actor','test','reason','rollback test','rule_id','VORTEK-CANON-1.0-ECON-2','payload',jsonb_build_object('kind','manual_pricing_override','untilRevoked',true,'validUntil',null));
 perform public.register_commercial_strategy(e);
 begin
  perform public.register_commercial_strategy(e||jsonb_build_object('id',second_id));
  raise exception 'DUPLICATE_OVERRIDE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'ESTRATEGIA_JA_VIGENTE' then raise; end if; end;
 perform public.register_commercial_strategy(e||jsonb_build_object('id',gen_random_uuid(),'event_type','STRATEGY_REVOKED','payload',jsonb_build_object('strategyId',first_id)));
 perform public.register_commercial_strategy(e||jsonb_build_object('id',second_id));
 if has_function_privilege('authenticated','public.register_commercial_strategy(jsonb)','EXECUTE') then raise exception 'STRATEGY_RPC_EXPOSED'; end if;
 if has_table_privilege('service_role','public.pricing_events','UPDATE') then raise exception 'AUDIT_MUTABLE'; end if;
end $$;
select 'COMMERCIAL_CANON_SQL_PASS' as evidence;
