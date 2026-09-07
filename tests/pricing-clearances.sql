-- Execute exclusivamente em DEV, dentro de BEGIN/ROLLBACK.
do $$
declare p uuid; actor uuid; g uuid; h uuid; cid uuid; cid2 uuid; entry_id uuid; outgoing_id uuid;
 cmd jsonb; stock jsonb; a jsonb; b jsonb; pair jsonb; evaluation jsonb; eval_id uuid; offer_id uuid; kit uuid; kit_group uuid;
 t timestamptz:=clock_timestamp()-interval '20 minutes'; n integer; op uuid:=gen_random_uuid();
begin
 select id into actor from public.profiles where cargo='admin' limit 1;
 insert into public.produtos(sku,nome) values('TEST-CLEARANCE-06','TEST rollback clearance') returning id into p;
 insert into public.estoque_interno_movimentacoes(produto_id,tipo,quantidade,motivo,situacao_estoque,created_at)
 values(p,'entrada_compra',10,'TEST','liberado',t) returning id into entry_id;
 a:=jsonb_build_object('anchorItemId','MLB990060001','anchorVariationId','','state','verified','synchronized',false,
 'members',jsonb_build_array(jsonb_build_object('itemId','MLB990060001','variationId','','catalog',false)),
 'reasons','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('condition','valid','reference','TEST','collectedAt',t)));
 b:=jsonb_set(jsonb_set(a,'{anchorItemId}','"MLB990060002"'),'{members}',jsonb_build_array(jsonb_build_object('itemId','MLB990060002','variationId','','catalog',true)));
 pair:=jsonb_set(jsonb_set(a,'{synchronized}','true'),'{members}',(a->'members')||(b->'members'));
 perform public.reconcile_ml_pricing_groups(9900601,p,t,true,jsonb_build_array(a,b));
 select id into g from public.ml_pricing_groups where seller_id=9900601 and anchor_item_id='MLB990060001';
 select id into h from public.ml_pricing_groups where seller_id=9900601 and anchor_item_id='MLB990060002';
 stock:=public.get_internal_clearance_stock(p);
 if (stock->>'capacity')::integer<>10 then raise exception 'wrong_initial_stock'; end if;
 cmd:=jsonb_build_object('commandId',gen_random_uuid(),'action','activate','groupId',g,'groupVersion',1,'quantity',5,'maxLossCents',200,'acceptLoss',true,'endsAt',null,'reason','TEST','stockFingerprint',stock->>'fingerprint');
 evaluation:='{"current":{"status":"inconclusive","memory":null,"reasons":[]},"revalidation":null}';
 begin perform public.manage_internal_stock_clearance(p,gen_random_uuid(),cmd,evaluation); raise exception 'permission_escaped';
 exception when others then if sqlerrm<>'clearance_permission_denied' then raise; end if; end;
 begin perform public.manage_internal_stock_clearance(p,actor,jsonb_set(cmd,'{acceptLoss}','false'),evaluation); raise exception 'loss_confirmation_escaped';
 exception when others then if sqlerrm<>'clearance_invalid_command' then raise; end if; end;
 begin perform public.manage_internal_stock_clearance(p,actor,jsonb_set(cmd,'{quantity}','11'),evaluation); raise exception 'stock_escaped';
 exception when others then if sqlerrm<>'clearance_stock_insufficient' then raise; end if; end;
 cid:=public.manage_internal_stock_clearance(p,actor,cmd,evaluation);
 if public.manage_internal_stock_clearance(p,actor,cmd,evaluation)<>cid then raise exception 'retry_duplicated'; end if;
 if (select count(*) from public.pricing_events where clearance_id=cid)<>1 then raise exception 'event_duplicated'; end if;
 begin perform public.manage_internal_stock_clearance(p,actor,jsonb_set(cmd,'{quantity}','4'),evaluation); raise exception 'idempotency_escaped';
 exception when others then if sqlerrm<>'clearance_idempotency_conflict' then raise; end if; end;
 if public.internal_clearance_available(cid)<>5 then raise exception 'scope_quantity_wrong'; end if;
 if (public.get_internal_clearance_stock(p)->>'capacity')::integer<>0 then raise exception 'overlap_not_blocked'; end if;
 insert into public.estoque_interno_movimentacoes(produto_id,tipo,quantidade,motivo,situacao_estoque,created_at)
 values(p,'entrada_compra',100,'TEST replenishment','liberado',t+interval '1 minute');
 if public.internal_clearance_available(cid)<>5 then raise exception 'replenishment_inherited'; end if;
 insert into public.estoque_interno_movimentacoes(produto_id,tipo,quantidade,motivo,estado_envio_interno)
 values(p,'saida_envio_interno',3,'TEST','reservado') returning id into outgoing_id;
 if public.internal_clearance_available(cid)<>2 then raise exception 'reservation_ignored'; end if;
 update public.estoque_interno_movimentacoes set estado_envio_interno='despachado',despachado_em=clock_timestamp() where id=outgoing_id;
 if public.internal_clearance_available(cid)<>2 then raise exception 'dispatch_double_counted'; end if;
 update public.estoque_interno_movimentacoes set estornada_em=clock_timestamp(),estorno_motivo='TEST' where id=outgoing_id;
 if public.internal_clearance_available(cid)<>5 then raise exception 'reversal_not_restored'; end if;
 -- Missing entry is zero, never treated as all authorized units available.
 update public.estoque_interno_movimentacoes set situacao_estoque='revisao' where id=entry_id;
 if public.internal_clearance_available(cid)<>0 then raise exception 'blocked_entry_available'; end if;
 update public.estoque_interno_movimentacoes set situacao_estoque='liberado' where id=entry_id;
 -- Explicit context is required even for manual changes while authorization exists.
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,null,null,10000,null,null); raise exception 'missing_context_escaped';
 exception when others then if sqlerrm<>'clearance_explicit_context_required' then raise; end if; end;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,null,10000,'supplier',1); raise exception 'supplier_escaped';
 exception when others then if sqlerrm<>'clearance_internal_only' then raise; end if; end;
 begin perform public.assert_pricing_governance_allows(g,'scheduled_job',null,cid,null,10000,'internal',1); raise exception 'automation_escaped';
 exception when others then if sqlerrm<>'clearance_manual_only' then raise; end if; end;
 select evaluation_id into eval_id from public.internal_stock_clearance where id=cid;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'inconclusive_escaped';
 exception when others then if sqlerrm<>'clearance_economy_inconclusive' then raise; end if; end;
 -- Shared authorization survives merge, split and incomplete observation, without doubling budget.
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '2 minutes',true,jsonb_build_array(pair));
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '3 minutes',true,jsonb_build_array(a,b));
 if (select count(*) from public.internal_stock_clearance_groups where clearance_id=cid)<>2 then raise exception 'transfer_missing'; end if;
 if (select count(*) from public.internal_stock_clearance where produto_id=p)<>1 then raise exception 'budget_duplicated'; end if;
 if public.internal_clearance_available(cid)<>5 then raise exception 'shared_budget_changed'; end if;
 select count(*) into n from public.pricing_events where clearance_id=cid;
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '4 minutes',true,jsonb_build_array(a,b));
 if (select count(*) from public.pricing_events where clearance_id=cid)<>n then raise exception 'refresh_duplicated_event'; end if;
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '5 minutes',false,'[]');
 if (select count(*) from public.internal_stock_clearance_groups where clearance_id=cid)<>2 then raise exception 'incomplete_erased_links'; end if;
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '6 minutes',true,jsonb_build_array(a,b));
 -- Limite financeiro no contrato SQL: cenário conhecido e controlado, sem HTTP.
 insert into public.produto_fornecedor_ofertas(produto_id,dslite_fornecedor_id,dslite_produto_id,sku_oferta,nome,custo,estoque)
 values(p,'TEST-CLEARANCE','TEST-CLEARANCE','TEST-CLEARANCE','TEST',100,5) returning id into offer_id;
 evaluation:=jsonb_build_object('current',jsonb_build_object('status','estimated','memory',jsonb_build_object(
   'revenueCents',10000,'resultCents',-200,'context',jsonb_build_object('productId',p,'mlItemId','MLB990060001'),
   'cost',jsonb_build_object('source','offer','sourceId',offer_id,'amountCents',10000,'condition','known'),
   'fee',jsonb_build_object('source','ml_live','condition','known'),'shipping',jsonb_build_object('source','ml_live','condition','known'))),
   'revalidation',jsonb_build_object('status','queried'));
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,evaluation,'TEST') returning id into eval_id;
 perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1);
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_set(evaluation,'{current,memory,resultCents}','-201'),'TEST') returning id into eval_id;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'loss_limit_escaped';
 exception when others then if sqlerrm<>'clearance_loss_exceeded' then raise; end if; end;
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,evaluation,'TEST') returning id into eval_id;
 update public.produto_fornecedor_ofertas set custo=101 where id=offer_id;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'cost_change_escaped';
 exception when others then if sqlerrm<>'clearance_economy_changed' then raise; end if; end;
 update public.produto_fornecedor_ofertas set custo=100 where id=offer_id;
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,jsonb_set(evaluation,'{current,memory,shipping,condition}','"stale"'),'TEST') returning id into eval_id;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'stale_shipping_escaped';
 exception when others then if sqlerrm<>'clearance_economy_inconclusive' then raise; end if; end;
 insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint) values(p,actor,evaluation,'TEST') returning id into eval_id;
 perform public.persist_ml_pricing_observations('anuncios_ml',jsonb_build_array(jsonb_build_object('ml_item_id','MLB990060001','produto_id',p,'sku','TEST-CLEARANCE-06','titulo','TEST','preco_ml',100,'status','ativo')) ,clock_timestamp());
 perform public.prepare_pricing_operation(op,eval_id,g,(select current_version from public.ml_pricing_groups where id=g),'MLB990060001',10000,'manual',actor,'TEST',null,null,cid,'internal',1);
 perform public.transition_pricing_operation(op,'requested');
 perform public.transition_pricing_operation(op,'inconclusive');
 -- Expiry is server-side derived without GET writes, and revocation affects all descendants.
 update public.internal_stock_clearance set starts_at=t,ends_at=t+interval '1 minute' where id=cid;
 if public.get_product_pricing_clearances(p)->0->>'state'<>'expired' then raise exception 'expiry_missing'; end if;
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'expiry_escaped';
 exception when others then if sqlerrm<>'clearance_not_active' then raise; end if; end;
 perform public.manage_internal_stock_clearance(p,actor,jsonb_build_object('commandId',gen_random_uuid(),'action','revoke','groupId',g,'groupVersion',(select current_version from public.ml_pricing_groups where id=g),'reason','TEST close','clearanceId',cid));
 if (select state from public.pricing_operations where id=op)<>'inconclusive' then raise exception 'inflight_changed'; end if;
 begin perform public.assert_pricing_governance_allows(h,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'descendant_revocation_escaped';
 exception when others then if sqlerrm<>'clearance_not_active' then raise; end if; end;
 if public.manage_internal_stock_clearance(p,actor,cmd,evaluation)<>cid then raise exception 'late_retry_duplicated'; end if;
 -- Duas autorizações distintas não são somadas quando o ML une os grupos.
 cmd:=jsonb_set(jsonb_set(cmd,'{commandId}',to_jsonb(gen_random_uuid())),'{groupVersion}',to_jsonb((select current_version from public.ml_pricing_groups where id=g)));
 cmd:=jsonb_set(cmd,'{stockFingerprint}',public.get_internal_clearance_stock(p)->'fingerprint');
 cid:=public.manage_internal_stock_clearance(p,actor,cmd,evaluation);
 cmd:=jsonb_set(jsonb_set(jsonb_set(cmd,'{commandId}',to_jsonb(gen_random_uuid())),'{groupId}',to_jsonb(h)),'{groupVersion}',to_jsonb((select current_version from public.ml_pricing_groups where id=h)));
 cmd:=jsonb_set(cmd,'{stockFingerprint}',public.get_internal_clearance_stock(p)->'fingerprint');
 cid2:=public.manage_internal_stock_clearance(p,actor,cmd,evaluation);
 perform public.reconcile_ml_pricing_groups(9900601,p,t+interval '7 minutes',true,jsonb_build_array(pair));
 begin perform public.assert_pricing_governance_allows(g,'manual',actor,cid,eval_id,10000,'internal',1); raise exception 'merge_conflict_escaped';
 exception when others then if sqlerrm<>'clearance_group_conflict' then raise; end if; end;
 perform public.manage_internal_stock_clearance(p,actor,jsonb_build_object('commandId',gen_random_uuid(),'action','complete','groupId',g,'groupVersion',(select current_version from public.ml_pricing_groups where id=g),'reason','TEST completed','clearanceId',cid));
 perform public.manage_internal_stock_clearance(p,actor,jsonb_build_object('commandId',gen_random_uuid(),'action','complete','groupId',g,'groupVersion',(select current_version from public.ml_pricing_groups where id=g),'reason','TEST completed','clearanceId',cid2));
 if (select state from public.internal_stock_clearance where id=cid2)<>'completed' then raise exception 'completion_missing'; end if;
 -- Kit: recorte dos componentes, sem saldo fictício do pai.
 insert into public.produtos(sku,nome) values('TEST-CLEARANCE-KIT','TEST KIT') returning id into kit;
 insert into public.produto_kits(produto_id,fornecedor_dslite_id,sku_origem) values(kit,'TEST-CLEARANCE','TEST KIT');
 insert into public.produto_kit_componentes(kit_produto_id,componente_produto_id,quantidade) values(kit,p,2);
 stock:=public.get_internal_clearance_stock(kit);
 if (stock->>'capacity')::integer<>55 then raise exception 'kit_capacity_wrong'; end if;
 perform public.reconcile_ml_pricing_groups(9900602,kit,t,true,jsonb_build_array(jsonb_set(jsonb_set(a,'{anchorItemId}','"MLB990060003"'),'{members}',jsonb_build_array(jsonb_build_object('itemId','MLB990060003','variationId','','catalog',false)))));
 select id into kit_group from public.ml_pricing_groups where seller_id=9900602;
 cmd:=jsonb_build_object('commandId',gen_random_uuid(),'action','activate','groupId',kit_group,'groupVersion',1,'quantity',3,'maxLossCents',0,'acceptLoss',false,'endsAt',null,'reason','TEST kit','stockFingerprint',stock->>'fingerprint');
 cid:=public.manage_internal_stock_clearance(kit,actor,cmd,evaluation);
 if public.internal_clearance_available(cid)<>3 then raise exception 'kit_scope_wrong'; end if;
 update public.produto_kit_componentes set quantidade=3 where kit_produto_id=kit;
 begin perform public.assert_pricing_governance_allows(kit_group,'manual',actor,cid,null,10000,'internal',1); raise exception 'kit_change_escaped';
 exception when others then if sqlerrm<>'clearance_composition_changed' then raise; end if; end;
 update public.produto_kits set ativo=false where produto_id=kit;
 -- Leitura e encerramento continuam possíveis mesmo após invalidar a composição.
 perform public.get_product_pricing_clearances(kit);
 perform public.manage_internal_stock_clearance(kit,actor,jsonb_build_object('commandId',gen_random_uuid(),'action','revoke','groupId',kit_group,'groupVersion',1,'reason','TEST invalid kit','clearanceId',cid));
 if has_table_privilege('authenticated','public.internal_stock_clearance','SELECT') or has_table_privilege('service_role','public.internal_stock_clearance','UPDATE')
   or has_function_privilege('anon','public.manage_internal_stock_clearance(uuid,uuid,jsonb,jsonb)','EXECUTE') then raise exception 'clearance_grants_unsafe'; end if;
 raise notice 'V2-06 SQL lifecycle, stock, permission, idempotency and group tests passed';
end $$;
