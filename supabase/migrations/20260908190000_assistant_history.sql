-- BNT-AI-02. Apply only to the independent supabase-dev at 192.168.1.162.
create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa' check (length(title) between 1 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id, user_id)
);
create index assistant_conversations_owner_date on public.assistant_conversations(user_id, updated_at desc, id);
create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null, user_id uuid not null,
  request_id uuid not null, role text not null check (role in ('user','assistant')),
  content text not null default '' check (length(content) <= 24000),
  state text not null check (state in ('running','cancel_requested','concluido','sem_dados','esclarecimento_necessario',
    'fonte_indisponivel','autenticacao_necessaria','acesso_negado','modelo_indisponivel','limite_atingido','ocupado',
    'tempo_esgotado','cancelado','provedor_indisponivel','resposta_invalida','ambiente_bloqueado','entrada_invalida')),
  answer jsonb, created_at timestamptz not null default now(), deadline_at timestamptz,
  foreign key(conversation_id,user_id) references public.assistant_conversations(id,user_id) on delete cascade,
  unique(user_id,request_id,role),
  check ((role='assistant') or (state='concluido' and answer is null and deadline_at is null)),
  check (answer is null or (role='assistant' and state not in ('running','cancel_requested')))
);
create index assistant_messages_conversation_date on public.assistant_messages(conversation_id,created_at,id);
create unique index assistant_one_active_per_owner on public.assistant_messages(user_id)
  where state in ('running','cancel_requested');
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_conversations, public.assistant_messages from public, anon, authenticated;
grant select on public.assistant_conversations, public.assistant_messages to authenticated;
grant all on public.assistant_conversations, public.assistant_messages to service_role;
create policy assistant_conversations_read_own on public.assistant_conversations for select to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and cargo='admin'));
create policy assistant_messages_read_own on public.assistant_messages for select to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and cargo='admin'));

-- Server-only operations: ownership is resolved from validated Auth, never model/client authority.
create function public.begin_assistant_message(p_user uuid,p_conversation uuid,p_request uuid,p_question text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing public.assistant_messages; result public.assistant_messages;
begin
  perform pg_advisory_xact_lock(hashtextextended('assistant:'||p_user::text,0));
  if length(trim(p_question)) not between 1 and 4000 then raise exception 'assistant_invalid'; end if;
  perform 1 from public.assistant_conversations where id=p_conversation and user_id=p_user for update;
  if not found then raise exception 'assistant_not_found'; end if;
  update public.assistant_messages set state=case when state='cancel_requested' then 'cancelado' else 'tempo_esgotado' end
    where user_id=p_user and state in ('running','cancel_requested') and deadline_at<=clock_timestamp();
  select * into existing from public.assistant_messages where user_id=p_user and request_id=p_request and role='user';
  if found then
    if existing.conversation_id<>p_conversation or existing.content<>p_question then raise exception 'assistant_idempotency_conflict'; end if;
    select * into result from public.assistant_messages where user_id=p_user and request_id=p_request and role='assistant';
    return jsonb_build_object('created',false,'message',to_jsonb(result)-'user_id');
  end if;
  if exists(select 1 from public.assistant_messages where user_id=p_user and state in ('running','cancel_requested')) then
    raise exception 'assistant_busy';
  end if;
  insert into public.assistant_messages(conversation_id,user_id,request_id,role,content,state)
    values(p_conversation,p_user,p_request,'user',p_question,'concluido');
  insert into public.assistant_messages(conversation_id,user_id,request_id,role,state,deadline_at)
    values(p_conversation,p_user,p_request,'assistant','running',clock_timestamp()+interval '120 seconds') returning * into result;
  update public.assistant_conversations set updated_at=clock_timestamp(),
    title=case when title='Nova conversa' then left(p_question,100) else title end where id=p_conversation and user_id=p_user;
  return jsonb_build_object('created',true,'message',to_jsonb(result)-'user_id');
end $$;
create function public.finish_assistant_message(p_user uuid,p_message uuid,p_state text,p_content text,p_answer jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.assistant_messages;
begin
  if p_state in ('running','cancel_requested') then raise exception 'assistant_invalid'; end if;
  update public.assistant_messages set
    state=case when state='cancel_requested' then 'cancelado' when deadline_at<=clock_timestamp() then 'tempo_esgotado' else p_state end,
    content=case when state='cancel_requested' or deadline_at<=clock_timestamp() then '' else p_content end,
    answer=case when state='cancel_requested' or deadline_at<=clock_timestamp() then null else p_answer end
    where id=p_message and user_id=p_user and role='assistant' and state in ('running','cancel_requested') returning * into result;
  return case when result.id is null then null else to_jsonb(result)-'user_id' end;
end $$;
create function public.delete_assistant_conversation(p_user uuid,p_conversation uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('assistant:'||p_user::text,0));
  if exists(select 1 from public.assistant_messages where conversation_id=p_conversation and user_id=p_user
    and state in ('running','cancel_requested') and deadline_at>clock_timestamp()) then raise exception 'assistant_busy'; end if;
  delete from public.assistant_conversations where id=p_conversation and user_id=p_user;
end $$;
revoke all on function public.begin_assistant_message(uuid,uuid,uuid,text),public.finish_assistant_message(uuid,uuid,text,text,jsonb),public.delete_assistant_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_assistant_message(uuid,uuid,uuid,text),public.finish_assistant_message(uuid,uuid,text,text,jsonb),public.delete_assistant_conversation(uuid,uuid) to service_role;
notify pgrst,'reload schema';
