-- Independent DEV only; the caller MUST wrap this test in BEGIN/ROLLBACK.
do $$
declare p uuid; actor uuid; e uuid; d uuid; op uuid:=gen_random_uuid(); oid uuid; ctx jsonb; memory jsonb; r jsonb;
begin
 select id into p from public.produtos where ml_item_id is null
   and not exists(select 1 from public.ml_pricing_groups g where g.produto_id=produtos.id and g.state<>'retired') limit 1;
 select id into actor from public.profiles where cargo='admin' limit 1;
 if p is null or actor is null then raise exception 'publication_test_fixture_missing'; end if;
 update public.produtos set ativo=true where id=p;
 memory:='{"revenueCents":11000,"margin":0.10,"band":{"floor":0.07},"resultCents":1100}';
 ctx:=jsonb_build_object('operationKind','listing_create','sellerId','9901530','itemId',null,'groupId',null,'groupVersion',null,
   'previousPriceCents',null,'priceCents',11000,'executable',true,'fingerprint','PUB_TEST','expiresAt',clock_timestamp()+interval '15 minutes',
   'clearance',null,'preparation',jsonb_build_object('capacity',1,'payload',jsonb_build_object('price',110,'currency_id','BRL','available_quantity',1)));
 insert into public.pricing_evaluations(produto_id,actor_id,fingerprint,result)
 values(p,actor,'PUB_TEST',jsonb_build_object('decisionContext',ctx,'current',jsonb_build_object('memory',memory),'revalidation',jsonb_build_object('status','queried'))) returning id into e;
 d:=public.prepare_pricing_decision(gen_random_uuid(),e,actor,'Criação de teste');
 if d<>public.prepare_pricing_decision(gen_random_uuid(),e,actor,'Mesmo anúncio') then raise exception 'duplicate_creation_proposal'; end if;
 if (select item_id from public.pricing_alerts where latest_decision_id=d) is not null then raise exception 'fabricated_item_id'; end if;
 r:=public.manage_pricing_decision(d,gen_random_uuid(),actor,'approve','Aprovar um anúncio',e);
 if r->>'state'<>'approved' then raise exception 'publication_approval_failed'; end if;
 oid:=public.consume_pricing_decision(d,op,actor,e);
 if oid<>public.consume_pricing_decision(d,op,actor,e) then raise exception 'publication_consumption_not_idempotent'; end if;
 if (select ml_item_id from public.anuncios_ml_outbox where id=oid) is not null then raise exception 'fabricated_outbox_item'; end if;
 if (select group_id from public.pricing_operations where id=op) is not null then raise exception 'fabricated_group'; end if;
 if not public.claim_pricing_decision_dispatch(op,e) then raise exception 'creation_not_claimed'; end if;
 if public.claim_pricing_decision_dispatch(op,e) then raise exception 'creation_claimed_twice'; end if;
 begin perform public.capture_pricing_created_item(op,'MLB990153001','WRONG');raise exception 'wrong_seller_accepted';exception when others then if sqlerrm<>'publication_capture_invalid' then raise;end if;end;
 perform public.capture_pricing_created_item(op,'MLB990153001','9901530');
 perform public.capture_pricing_created_item(op,'MLB990153001','9901530');
 if (select ml_item_id from public.anuncios_ml_outbox where id=oid)<>'MLB990153001' then raise exception 'remote_id_not_durable'; end if;
 if (select count(*) from public.pricing_events where operation_id=op and evidence->>'remoteIdentityCaptured'='true')<>1 then raise exception 'duplicate_identity_capture';end if;
 begin perform public.capture_pricing_created_item(op,'MLB990153002','9901530');raise exception 'remote_id_replaced';exception when others then if sqlerrm<>'publication_remote_identity_conflict' then raise;end if;end;
 perform public.transition_pricing_operation(op,'inconclusive');
 if public.claim_pricing_decision_dispatch(op,e) then raise exception 'ambiguous_creation_repeated';end if;
 begin perform public.transition_pricing_operation(op,'failed');raise exception 'ambiguous_creation_released';exception when others then if sqlerrm<>'publication_effect_inconclusive' then raise;end if;end;
 begin perform public.transition_pricing_operation(op,'confirmed','{}');raise exception 'creation_without_proof';exception when others then if sqlerrm<>'publication_confirmation_missing' then raise;end if;end;
 perform public.reconcile_ml_pricing_groups(9901530,p,clock_timestamp(),true,jsonb_build_array(jsonb_build_object(
   'anchorItemId','MLB990153001','anchorVariationId','','state','verified','synchronized',false,
   'members',jsonb_build_array(jsonb_build_object('itemId','MLB990153001','variationId','','catalog',false)),
   'reasons','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('condition','valid','reference','TEST','collectedAt',clock_timestamp())))));
 perform public.transition_pricing_operation(op,'confirmed',jsonb_build_object('item_id','MLB990153001','seller_id','9901530','price_cents',11000,'observed_at',clock_timestamp(),'outcome','readback_verified','listing_verified',true));
 if (select group_id from public.pricing_operations where id=op) is null then raise exception 'confirmed_creation_group_missing'; end if;
 if (select state from public.pricing_alerts where latest_decision_id=d)<>'resolved' then raise exception 'creation_alert_unresolved';end if;
 if has_function_privilege('authenticated','public.capture_pricing_created_item(uuid,text,text)','EXECUTE')
   or has_table_privilege('service_role','public.pricing_operations','UPDATE') then raise exception 'unsafe_creation_grants';end if;
 raise notice 'Publication: typed target, approval, dedupe, claim, capture, ambiguous effect and confirmation passed';
end $$;
