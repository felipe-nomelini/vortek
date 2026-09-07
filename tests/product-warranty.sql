-- Run on independent DEV .162 inside BEGIN / ROLLBACK. No external calls.
do $$
declare p uuid; actor uuid; fp text; c jsonb; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid(); snap jsonb;
begin
 select id into actor from public.profiles where cargo='admin' limit 1;
 insert into public.produtos(sku,nome,marca) values('TEST-WARRANTY-01','Produto garantia teste','Marca Teste') returning id into p;
 fp:=public.get_product_warranty_fingerprint(p);
 c:=jsonb_build_object('commandId',first_id,'action','review','reason','Teste de evidência','fingerprint',fp);
 if not (public.begin_product_warranty_command(p,actor,c)->>'acquired')::boolean then raise exception 'not_acquired'; end if;
 if (public.begin_product_warranty_command(p,actor,c)->>'acquired')::boolean then raise exception 'retry_acquired'; end if;
 begin perform public.begin_product_warranty_command(p,actor,c||'{"reason":"different"}'); raise exception 'conflict_escaped';
 exception when others then if sqlerrm<>'warranty_idempotency_conflict' then raise; end if; end;
 begin perform public.begin_product_warranty_command(p,actor,c||jsonb_build_object('commandId',second_id)); raise exception 'inflight_escaped';
 exception when others then if sqlerrm<>'warranty_in_progress' then raise; end if; end;
 perform public.finish_product_warranty_command(first_id,actor,'{"candidates":[{"proof":"TEST"}]}');
 perform public.finish_product_warranty_command(first_id,actor,'{"candidates":[]}');
 if jsonb_array_length((select result->'candidates' from public.product_warranty_assessments where id=first_id))<>1 then raise exception 'finish_not_idempotent'; end if;
 perform public.begin_product_warranty_command(p,actor,c||jsonb_build_object('commandId',second_id,'action','research'));
 perform public.finish_product_warranty_command(second_id,actor,'{"candidates":[],"failure":"TEST timeout"}');
 snap:=public.get_product_warranty_snapshot(p);
 if snap->'current'->>'id'<>first_id::text or snap->'latest'->>'id'<>second_id::text then raise exception 'failed_research_erased_evidence'; end if;
 perform public.begin_product_warranty_command(p,actor,c||jsonb_build_object('commandId',source_id,'action','source','url','https://marca.example.com/manual'));
 perform public.finish_product_warranty_command(source_id,actor,'{"candidates":[]}', '{"scope":"manufacturer:marca teste","host":"marca.example.com","state":"approved"}');
 if jsonb_array_length(public.get_product_warranty_snapshot(p)->'sources')<>1 then raise exception 'source_missing'; end if;
 second_id:=gen_random_uuid();
 perform public.begin_product_warranty_command(p,actor,c||jsonb_build_object('commandId',second_id,'action','research'));
 update public.produtos set nome='Produto mudou' where id=p;
 perform public.finish_product_warranty_command(second_id,actor,'{"candidates":[{"stale":true}]}');
 if (select state from public.product_warranty_assessments where id=second_id)<>'inconclusive' then raise exception 'stale_escaped'; end if;
 if public.get_product_warranty_snapshot(p)->'current'<>'null'::jsonb then raise exception 'old_context_reused'; end if;
 begin perform public.begin_product_warranty_command(p,actor,c||jsonb_build_object('commandId',gen_random_uuid())); raise exception 'old_fp_escaped';
 exception when others then if sqlerrm<>'warranty_context_changed' then raise; end if; end;
 c:=c||jsonb_build_object('fingerprint',public.get_product_warranty_fingerprint(p),'commandId',gen_random_uuid(),'action','research');
 perform public.begin_product_warranty_command(p,actor,c);
 update public.product_warranty_assessments set deadline=clock_timestamp()-interval '1 second' where id=(c->>'commandId')::uuid;
 perform public.finish_product_warranty_command((c->>'commandId')::uuid,actor,'{"candidates":[]}');
 if (select state from public.product_warranty_assessments where id=(c->>'commandId')::uuid)<>'inconclusive' then raise exception 'deadline_escaped'; end if;
 begin perform public.begin_product_warranty_command(p,gen_random_uuid(),c||jsonb_build_object('commandId',gen_random_uuid())); raise exception 'role_escaped';
 exception when others then if sqlerrm<>'warranty_permission_denied' then raise; end if; end;
 if has_table_privilege('authenticated','public.product_warranty_assessments','SELECT') or has_table_privilege('service_role','public.product_warranty_assessments','INSERT')
 or has_function_privilege('anon','public.get_product_warranty_snapshot(uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.begin_product_warranty_command(uuid,uuid,jsonb)','EXECUTE') then raise exception 'privilege_leak'; end if;
 if not (select relrowsecurity from pg_class where oid='public.warranty_sources'::regclass) then raise exception 'rls_missing'; end if;
end $$;
