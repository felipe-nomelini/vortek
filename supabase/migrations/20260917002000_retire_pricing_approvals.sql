set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- As decisões antigas ficam acessíveis somente para auditoria. A operação é a
-- confirmação do usuário e não depende mais de proposta ou aprovação.
do $$ begin
 if exists(select 1 from public.pricing_operations where state in ('prepared','requested','inconclusive')
   and coalesce(rule_id,'') <> 'MANUAL-ML') then
   raise exception 'legacy_pricing_operation_still_open';
 end if;
end $$;

create schema if not exists bentevi_archive;
revoke all on schema bentevi_archive from public, anon, authenticated;
create table bentevi_archive.pricing_decisions_20260917 as table public.pricing_decisions;
alter table bentevi_archive.pricing_decisions_20260917 add primary key(id);
revoke all on bentevi_archive.pricing_decisions_20260917 from public, anon, authenticated;

alter table public.pricing_events drop constraint pricing_events_decision_id_fkey;
alter table public.pricing_events add constraint pricing_events_decision_history_fkey
  foreign key(decision_id) references bentevi_archive.pricing_decisions_20260917(id);
alter table public.pricing_batch_items drop constraint pricing_batch_items_decision_id_fkey;
alter table public.pricing_batch_items add constraint pricing_batch_items_decision_history_fkey
  foreign key(decision_id) references bentevi_archive.pricing_decisions_20260917(id);
alter table public.pricing_alerts drop column latest_decision_id;

drop trigger if exists pricing_operation_alert on public.pricing_events;
drop function if exists public.observe_pricing_operation_alert();
drop function if exists public.search_pricing_decision_product_ids(text,text,text,text,text,integer,integer);
drop function if exists public.claim_pricing_decision_dispatch(uuid,uuid);
drop function if exists public.consume_pricing_decision(uuid,uuid,uuid,uuid);
drop function if exists public.manage_pricing_decision(uuid,uuid,uuid,text,text,uuid,timestamptz);
drop function if exists public.prepare_pricing_decision(uuid,uuid,uuid,text);
drop table public.pricing_decisions;

notify pgrst, 'reload schema';
