-- Somente DEV, sob BEGIN/ROLLBACK. Não executar como migration.
do $$
declare p uuid; actor uuid; g uuid; h uuid; protected_id uuid; child_id uuid; cmd uuid:=gen_random_uuid();
 t timestamptz:=clock_timestamp()-interval '30 minutes'; a jsonb; b jsonb; pair jsonb; n integer; evaluation uuid; op uuid:=gen_random_uuid(); manual_op uuid:=gen_random_uuid();
begin
 select id into p from public.produtos limit 1;
 select id into actor from public.profiles where cargo='admin' limit 1;
 if p is null or actor is null then raise exception 'test_fixture_prerequisites_missing'; end if;
 a:=jsonb_build_object('anchorItemId','MLB990050001','anchorVariationId','','state','verified','synchronized',false,
   'members',jsonb_build_array(jsonb_build_object('itemId','MLB990050001','variationId','','catalog',false)),
   'reasons','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('condition','valid','reference','TEST','collectedAt',t)));
 b:=jsonb_set(jsonb_set(a,'{anchorItemId}','"MLB990050002"'),'{members}',jsonb_build_array(jsonb_build_object('itemId','MLB990050002','variationId','','catalog',true)));
 pair:=jsonb_set(jsonb_set(a,'{synchronized}','true'),'{members}',(a->'members')||(b->'members'));
 perform public.reconcile_ml_pricing_groups(9900501,p,t,true,jsonb_build_array(a,b));
 select id into g from public.ml_pricing_groups where seller_id=9900501 and anchor_item_id='MLB990050001';
 select id into h from public.ml_pricing_groups where seller_id=9900501 and anchor_item_id='MLB990050002';
 if exists(select 1 from public.manual_pricing_overrides where group_id in (g,h)) then raise exception 'implicit_override'; end if;
 perform public.persist_ml_pricing_observations('anuncios_ml',jsonb_build_array(jsonb_build_object('ml_item_id','MLB990050001','produto_id',p,'sku','OVERRIDE_TEST','titulo','Override test','preco_ml',100,'status','ativo')),t);
 insert into public.pricing_evaluations(produto_id,fingerprint,result) values(p,'OVERRIDE_TEST','{}') returning id into evaluation;
 perform public.prepare_pricing_operation(op,evaluation,g,1,'MLB990050001',11000,'scheduled_job',null,'TEST');
 protected_id:=public.manage_manual_pricing_override(cmd,p,g,1,'activate',actor,'Proteção teste');
 perform public.manage_manual_pricing_override(cmd,p,g,1,'activate',actor,'Proteção teste');
 if (select count(*) from public.pricing_events where command_id=cmd)<>1 then raise exception 'command_not_idempotent'; end if;
 begin perform public.manage_manual_pricing_override(cmd,p,g,1,'activate',actor,'Outro motivo'); raise exception 'idempotency_not_checked';
 exception when others then if sqlerrm<>'override_idempotency_conflict' then raise; end if; end;
 begin perform public.manage_manual_pricing_override(gen_random_uuid(),p,g,99,'revoke',actor,'Teste',protected_id); raise exception 'version_not_checked';
 exception when others then if sqlerrm<>'override_group_changed' then raise; end if; end;
 begin perform public.manage_manual_pricing_override(gen_random_uuid(),p,g,1,'revoke',gen_random_uuid(),'Teste',protected_id); raise exception 'permission_not_checked';
 exception when others then if sqlerrm<>'override_permission_denied' then raise; end if; end;
 begin perform public.transition_pricing_operation(op,'requested'); raise exception 'prepared_operation_escaped';
 exception when others then if sqlerrm<>'manual_pricing_override_active' then raise; end if; end;
 perform public.transition_pricing_operation(op,'failed'); -- Antes do envio: sem efeito externo.
 begin perform public.prepare_pricing_operation(gen_random_uuid(),evaluation,g,1,'MLB990050001',11000,'scheduled_job',null,'TEST'); raise exception 'automatic_prepare_escaped';
 exception when others then if sqlerrm<>'manual_pricing_override_active' then raise; end if; end;
 perform public.prepare_pricing_operation(manual_op,evaluation,g,1,'MLB990050001',11000,'manual',actor,'TEST');
 perform public.transition_pricing_operation(manual_op,'requested');
 perform public.transition_pricing_operation(manual_op,'inconclusive');
 perform public.manage_manual_pricing_override(gen_random_uuid(),p,g,1,'revoke',actor,'Remover teste',protected_id);
 if (select state from public.pricing_operations where id=manual_op)<>'inconclusive' then raise exception 'inflight_mutated'; end if;
 protected_id:=public.manage_manual_pricing_override(gen_random_uuid(),p,g,1,'activate',actor,'Reativação explícita');
 -- Observação continua funcionando com override e não é reprecificação.
 perform public.persist_ml_pricing_observations('anuncios_ml','[{"ml_item_id":"MLB990050001","preco_ml":101}]',t+interval '1 minute');
 if (select preco_ml from public.anuncios_ml where ml_item_id='MLB990050001')<>101 then raise exception 'observation_blocked'; end if;
 -- União amplia proteção; nenhuma aprovação comercial ou preço deriva dela.
 perform public.reconcile_ml_pricing_groups(9900501,p,t+interval '2 minutes',true,jsonb_build_array(pair));
 if not exists(select 1 from public.pricing_events where group_id=g and kind='override_propagated') then raise exception 'union_not_audited'; end if;
 -- Separação propaga ao grupo filho anteriormente sem proteção.
 perform public.reconcile_ml_pricing_groups(9900501,p,t+interval '3 minutes',true,jsonb_build_array(a,b));
 select id into child_id from public.manual_pricing_overrides where group_id=h and state='active';
 if child_id is null then raise exception 'split_not_protected'; end if;
 if (select actor_id from public.manual_pricing_overrides where id=child_id) is not null then raise exception 'propagation_fabricated_actor'; end if;
 select count(*) into n from public.pricing_events where kind='override_propagated' and produto_id=p;
 perform public.reconcile_ml_pricing_groups(9900501,p,t+interval '4 minutes',true,jsonb_build_array(a,b));
 if (select count(*) from public.pricing_events where kind='override_propagated' and produto_id=p)<>n then raise exception 'refresh_duplicated'; end if;
 perform public.manage_manual_pricing_override(gen_random_uuid(),p,h,(select current_version from public.ml_pricing_groups where id=h),'revoke',actor,'Somente filho',child_id);
 perform public.reconcile_ml_pricing_groups(9900501,p,t+interval '5 minutes',true,jsonb_build_array(a,b));
 if exists(select 1 from public.manual_pricing_overrides where group_id=h and state='active') then raise exception 'revoked_resurrected'; end if;
 if not exists(select 1 from public.manual_pricing_overrides where group_id=g and state='active') then raise exception 'sibling_revoked'; end if;
 perform public.reconcile_ml_pricing_groups(9900501,p,t+interval '6 minutes',false,'[]');
 if not exists(select 1 from public.manual_pricing_overrides where group_id=g and state='active') then raise exception 'incomplete_lost_override'; end if;
 if exists(select 1 from public.manual_pricing_overrides where group_id=h and state='active') then raise exception 'incomplete_invented_override'; end if;
 -- Uma exceção depois da RPC deve reverter proteção e evento em conjunto.
 select count(*) into n from public.pricing_events where kind='override_revoked' and group_id=g;
 begin
   perform public.manage_manual_pricing_override(gen_random_uuid(),p,g,(select current_version from public.ml_pricing_groups where id=g),'revoke',actor,'Rollback teste',protected_id);
   raise exception 'rollback_probe';
 exception when others then if sqlerrm<>'rollback_probe' then raise; end if; end;
 if not exists(select 1 from public.manual_pricing_overrides where id=protected_id and state='active') or (select count(*) from public.pricing_events where kind='override_revoked' and group_id=g)<>n then raise exception 'audit_not_atomic'; end if;
 if has_table_privilege('service_role','public.manual_pricing_overrides','UPDATE') or has_function_privilege('authenticated','public.manage_manual_pricing_override(uuid,uuid,uuid,integer,text,uuid,text,uuid)','EXECUTE') then raise exception 'unsafe_grants'; end if;
 if (select preco_ml from public.anuncios_ml where ml_item_id='MLB990050001')<>101 then raise exception 'override_changed_price'; end if;
 raise notice 'Pricing overrides regression passed';
end $$;
