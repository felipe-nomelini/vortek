-- Follow-up to the DEV rehearsal: informational alerts must not precede P0.
alter table public.pricing_alerts add column severity_order smallint
 generated always as (case severity when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end) stored;
create index pricing_alerts_priority on public.pricing_alerts(state,severity_order,created_at,id) where merged_into is null;
