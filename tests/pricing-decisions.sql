-- Execute only on independent DEV, inside BEGIN/ROLLBACK.
do $$
declare p uuid; actor uuid; g uuid; ev uuid; fresh uuid; old_ev uuid; ctx jsonb; observation jsonb;
 a uuid; d uuid; cmd uuid; response jsonb; n bigint; op uuid:=gen_random_uuid(); outbox uuid; other uuid; ungrouped uuid; merged_alert uuid; old_group_alert uuid;
begin
 select id into p from public.produtos limit 1;
 select id into actor from public.profiles where cargo='admin' limit 1;
 if p is null or actor is null then raise exception 'test_fixture_missing'; end if;
 perform public.reconcile_ml_pricing_groups(9901301,p,clock_timestamp(),true,jsonb_build_array(jsonb_build_object(
   'anchorItemId','MLB990130001','anchorVariationId','','state','verified','synchronized',false,
   'members',jsonb_build_array(jsonb_build_object('itemId','MLB990130001','variationId','','catalog',false)),
   'reasons','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('condition','valid','reference','TEST','collectedAt',clock_timestamp())))));
 select id into g from public.ml_pricing_groups where seller_id=9901301 and anchor_item_id='MLB990130001';
 perform public.persist_ml_pricing_observations('anuncios_ml',jsonb_build_array(jsonb_build_object('ml_item_id','MLB990130001','produto_id',p,'sku','DECISION_TEST','titulo','TEST','preco_ml',100,'status','ativo')),clock_timestamp());
 ctx:=jsonb_build_object('sellerId','9901301','itemId','MLB990130001','groupId',g,'groupVersion',1,'previousPriceCents',10000,'priceCents',11000,'fingerprint','TEST_A','executable',true,'reasons','[]'::jsonb,'clearance',null,'expiresAt',clock_timestamp()+interval '15 minutes');
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_build_object('decisionContext',ctx),'TEST') returning id into ev;
 observation:='[{"rule":"buy_box_economy","severity":"P1","active":true,"title":"Teste","reason":"Motivo"}]';
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_build_object('decisionContext',jsonb_set(ctx,'{groupId}','null')),'UNGROUPED') returning id into ungrouped;
 perform public.sync_pricing_alerts(ungrouped,observation);
 select id into merged_alert from public.pricing_alerts where seller_id='9901301' and group_id is null;
 perform public.sync_pricing_alerts(ev,observation);perform public.sync_pricing_alerts(ev,observation);
 select id into a from public.pricing_alerts where seller_id='9901301' and rule_id='buy_box_economy' and group_id=g;
 if (select merged_into from public.pricing_alerts where id=merged_alert) is distinct from a then raise exception 'group_consolidation_failed'; end if;
 if (select count(*) from public.pricing_events where alert_id=merged_alert)<>2 then raise exception 'merged_history_lost';end if;
 if (select count(*) from public.pricing_events where alert_id=a)<>1 then raise exception 'duplicate_observation_event'; end if;
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint)
 values(p,actor,jsonb_build_object('decisionContext',jsonb_set(ctx,'{groupId}','null')),'UNGROUPED_GROUP') returning id into ungrouped;
 perform public.sync_pricing_alerts(ungrouped,'[{"rule":"pricing_group","severity":"P1","active":true,"title":"Grupo pendente","reason":"Pendente"}]');
 select id into old_group_alert from public.pricing_alerts where seller_id='9901301' and group_id is null and rule_id='pricing_group';
 perform public.sync_pricing_alerts(ev,'[{"rule":"pricing_group","severity":"P1","active":false,"title":"Grupo confirmado","reason":"Confirmado"}]');
 if (select state from public.pricing_alerts where id=old_group_alert)<>'resolved'
   or (select merged_into from public.pricing_alerts where id=old_group_alert) is not null
   or not exists(select 1 from public.pricing_events where alert_id=old_group_alert and kind='alert_resolved')
   then raise exception 'inactive_verified_group_did_not_resolve_item_alert'; end if;
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint,created_at) values(p,actor,jsonb_build_object('decisionContext',ctx),'TEST',clock_timestamp()-interval '1 hour') returning id into old_ev;
 perform public.sync_pricing_alerts(old_ev,jsonb_set(observation,'{0,active}','false'));
 if (select state from public.pricing_alerts where id=a)<>'open' then raise exception 'late_observation_resolved'; end if;
 perform public.sync_pricing_alerts(ev,jsonb_set(observation,'{0,active}','false'));
 perform public.sync_pricing_alerts(ev,observation);
 if (select count(*) from public.pricing_events where alert_id=a)<>3 then raise exception 'lifecycle_missing'; end if;
 cmd:=gen_random_uuid();d:=public.prepare_pricing_decision(cmd,ev,actor,'Teste manual');
 if d<>public.prepare_pricing_decision(cmd,ev,actor,'Teste manual') then raise exception 'prepare_duplicate'; end if;
 begin perform public.prepare_pricing_decision(cmd,ev,actor,'Mudança no comando');raise exception 'missing_conflict'; exception when others then if sqlerrm<>'decision_idempotency_conflict' then raise;end if;end;
 begin perform public.prepare_pricing_decision(gen_random_uuid(),ev,gen_random_uuid(),'Teste');raise exception 'missing_permissions';exception when others then if sqlerrm<>'decision_permission_denied' then raise;end if;end;
 cmd:=gen_random_uuid();response:=public.manage_pricing_decision(d,cmd,actor,'defer','Rever depois',null,clock_timestamp()+interval '1 hour');
 if response->>'state'<>'deferred' then raise exception 'defer_failed'; end if;
 begin perform public.manage_pricing_decision(d,gen_random_uuid(),actor,'defer','Data inválida',null,clock_timestamp()-interval '1 hour');raise exception 'invalid_date_accepted';exception when others then if sqlerrm<>'decision_invalid_deferral' then raise;end if;end;
 cmd:=gen_random_uuid();response:=public.manage_pricing_decision(d,cmd,actor,'approve','Aprovado',ev);
 if response->>'state'<>'approved' or (response->>'executionBlocked')::boolean is not true then raise exception 'approval_state_wrong'; end if;
 if (public.manage_pricing_decision(d,cmd,actor,'approve','Aprovado',null)->>'replayed')::boolean is not true then raise exception 'approval_replay_failed'; end if;
 if exists(select 1 from public.pricing_operations where group_id=g) then raise exception 'approval_applied'; end if;
 outbox:=public.consume_pricing_decision(d,op,actor,ev);
 if outbox<>public.consume_pricing_decision(d,op,actor,ev) then raise exception 'consumption_not_idempotent'; end if;
 begin perform public.consume_pricing_decision(d,gen_random_uuid(),actor,ev);raise exception 'double_consumption';exception when others then if sqlerrm<>'decision_already_consumed' then raise;end if;end;
 if (select count(*) from public.anuncios_ml_outbox where pricing_operation_id=op)<>1 then raise exception 'duplicate_outbox'; end if;
 begin perform public.claim_pricing_decision_dispatch(op,old_ev);raise exception 'stale_dispatch_accepted';exception when others then if sqlerrm<>'decision_evaluation_invalid' then raise;end if;end;
 if not public.claim_pricing_decision_dispatch(op,ev) then raise exception 'dispatch_not_claimed'; end if;
 if public.claim_pricing_decision_dispatch(op,ev) then raise exception 'duplicate_dispatch'; end if;
 perform public.transition_pricing_operation(op,'inconclusive');
 if public.claim_pricing_decision_dispatch(op,ev) then raise exception 'uncertain_dispatch_repeated'; end if;
 begin perform public.transition_pricing_operation(op,'confirmed','{}');raise exception 'confirmation_without_readback';exception when others then if sqlerrm<>'pricing_confirmation_missing' then raise;end if;end;
 begin perform public.prepare_pricing_operation(gen_random_uuid(),ev,g,1,'MLB990130001',12000,'manual',actor,'Concorrente');raise exception 'parallel_operation_accepted';exception when unique_violation then null;end;
 perform public.transition_pricing_operation(op,'confirmed',jsonb_build_object('reference','items/MLB990130001','outcome','readback_verified','item_id','MLB990130001','price_cents',11000,'observed_at',clock_timestamp(),
   'members',jsonb_build_array(jsonb_build_object('item_id','MLB990130001','variation_id','','price_cents',11000))));
 if (select state from public.pricing_alerts where seller_id='9901301' and rule_id='pricing_operation')<>'resolved' then raise exception 'operation_alert_unresolved'; end if;
 if (select state from public.pricing_alerts where latest_decision_id=d)<>'resolved' then raise exception 'applied_proposal_unresolved'; end if;
 ctx:=jsonb_set(ctx,'{fingerprint}','"TEST_B"');
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_build_object('decisionContext',ctx),'TEST') returning id into fresh;
 other:=public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Outro cenário');
 response:=public.manage_pricing_decision(other,gen_random_uuid(),actor,'approve','Antiga evidência',ev);
 if response->>'state'<>'invalidated' then raise exception 'material_change_accepted';end if;
 other:=public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Reavaliado');
 response:=public.manage_pricing_decision(other,gen_random_uuid(),actor,'reject','Não aplicar');
 if response->>'state'<>'rejected' then raise exception 'rejection_failed';end if;
 if (select state from public.pricing_alerts where latest_decision_id=other)<>'resolved' then raise exception 'rejected_proposal_unresolved';end if;
 if other<>public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Mesmo cenário') then raise exception 'rejection_resurrected';end if;
 if (select state from public.pricing_alerts where latest_decision_id=other)<>'resolved' then raise exception 'rejected_alert_reopened';end if;
 ctx:=jsonb_set(ctx,'{fingerprint}','"TEST_C"');
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_build_object('decisionContext',ctx),'TEST') returning id into fresh;
 other:=public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Validade');
 update public.pricing_decisions set expires_at=clock_timestamp()-interval '1 minute' where id=other;
 response:=public.manage_pricing_decision(other,gen_random_uuid(),actor,'approve','Expirada',fresh);
 if response->>'state'<>'expired' then raise exception 'expiration_ignored';end if;
 -- A local failure before any HTTP consumes its approval, but does not trap the next proposal.
 ctx:=jsonb_set(ctx,'{fingerprint}','"TEST_RETRY"');
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_build_object('decisionContext',ctx),'TEST') returning id into fresh;
 other:=public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Falha antes de enviar');
 perform public.manage_pricing_decision(other,gen_random_uuid(),actor,'approve','Aprovar',fresh);
 op:=gen_random_uuid();perform public.consume_pricing_decision(other,op,actor,fresh);
 perform public.transition_pricing_operation(op,'failed');
 if other=public.prepare_pricing_decision(gen_random_uuid(),fresh,actor,'Nova revisão após falha local') then raise exception 'failed_approval_reused'; end if;
 if has_table_privilege('service_role','public.pricing_decisions','UPDATE') or has_table_privilege('authenticated','public.pricing_alerts','SELECT')
  or has_function_privilege('authenticated','public.claim_pricing_decision_dispatch(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.consume_pricing_decision(uuid,uuid,uuid,uuid)','EXECUTE') then raise exception 'unsafe_grants'; end if;
 if (select preco_ml from public.anuncios_ml where ml_item_id='MLB990130001')<>100 then raise exception 'test_changed_listing_price';end if;
 raise notice 'Pricing decisions: lifecycle, replay, permissions, invalidation, expiry, outbox and readback passed';
end $$;
