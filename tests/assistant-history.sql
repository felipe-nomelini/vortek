-- Run in an explicit transaction, then ROLLBACK. Synthetic identities only.
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000a02','ai02-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000a03','ai02-other@example.invalid');
insert into public.profiles(id,nome,cargo) values
 ('00000000-0000-4000-8000-000000000a02','AI02 synthetic owner','admin'),('00000000-0000-4000-8000-000000000a03','AI02 synthetic other','admin')
 on conflict(id) do update set cargo='admin';
insert into public.assistant_conversations(id,user_id) values
 ('00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000a02');
do $$ declare r jsonb; begin
 r:=public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b02','Pergunta sintética');
 if (r->>'created')::boolean is not true then raise exception 'claim failed'; end if;
 r:=public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b02','Pergunta sintética');
 if (r->>'created')::boolean is not false then raise exception 'dedupe failed'; end if;
 begin
   perform public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b02','Pergunta diferente');
   raise exception 'conflict accepted';
 exception when raise_exception then if sqlerrm<>'assistant_idempotency_conflict' then raise; end if; end;
 begin
   perform public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b03','Outra pergunta');
   raise exception 'concurrency accepted';
 exception when raise_exception then if sqlerrm<>'assistant_busy' then raise; end if; end;
 begin
   perform public.delete_assistant_conversation('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02');
   raise exception 'active deletion accepted';
 exception when raise_exception then if sqlerrm<>'assistant_busy' then raise; end if; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a02',true);
do $$ begin
 if (select count(*) from public.assistant_conversations)<>1 then raise exception 'owner read failed'; end if;
 if (select count(*) from public.assistant_messages)<>2 then raise exception 'owner messages failed'; end if;
 begin
   insert into public.assistant_conversations(user_id) values('00000000-0000-4000-8000-000000000a02');
   raise exception 'direct write accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b04','Forbidden');
   raise exception 'rpc accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a03',true);
do $$ begin
 if exists(select 1 from public.assistant_conversations) or exists(select 1 from public.assistant_messages) then raise exception 'cross-owner leak'; end if;
end $$;
reset role;
update public.profiles set cargo='visualizador' where id='00000000-0000-4000-8000-000000000a02';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000a02',true);
do $$ begin if exists(select 1 from public.assistant_messages) then raise exception 'revoked role leak'; end if; end $$;
reset role;
set local role anon;
do $$ begin
 begin perform count(*) from public.assistant_messages; raise exception 'anon accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare r jsonb; mid uuid; begin
 select id into mid from public.assistant_messages where role='assistant' and request_id='00000000-0000-4000-8000-000000000b02';
 update public.assistant_messages set state='cancel_requested' where id=mid;
 r:=public.finish_assistant_message('00000000-0000-4000-8000-000000000a02',mid,'concluido','Must not persist','{"text":"must not persist"}'::jsonb);
 if r->>'state'<>'cancelado' or r->>'content'<>'' or r->>'answer' is not null then raise exception 'late cancellation persisted'; end if;
 r:=public.finish_assistant_message('00000000-0000-4000-8000-000000000a02',mid,'concluido','retry','{}');
 if r is not null then raise exception 'terminal overwritten'; end if;
 r:=public.begin_assistant_message('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000b03','Após cancelar');
 mid:=(r->'message'->>'id')::uuid;
 update public.assistant_messages set deadline_at=now()-interval '1 second' where id=mid;
 r:=public.finish_assistant_message('00000000-0000-4000-8000-000000000a02',mid,'concluido','Late','{}');
 if r->>'state'<>'tempo_esgotado' or r->>'content'<>'' then raise exception 'late timeout persisted'; end if;
 perform public.delete_assistant_conversation('00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000c02');
 if exists(select 1 from public.assistant_messages where user_id='00000000-0000-4000-8000-000000000a02') then raise exception 'cascade failed'; end if;
 r:=public.finish_assistant_message('00000000-0000-4000-8000-000000000a02',mid,'concluido','Late after deletion','{}');
 if r is not null then raise exception 'deleted message recreated'; end if;
end $$;
