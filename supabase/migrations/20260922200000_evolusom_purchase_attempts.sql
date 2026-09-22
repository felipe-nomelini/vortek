alter table public.compras
  add column if not exists evolusom_attempt_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.compras'::regclass
      and conname = 'compras_evolusom_attempt_count_nonnegative'
  ) then
    alter table public.compras
      add constraint compras_evolusom_attempt_count_nonnegative
      check (evolusom_attempt_count >= 0);
  end if;
end $$;

-- Existing uncertain requests have at least one POST attempt and receive the
-- single automatic retry allowance introduced by the application change.
update public.compras
set evolusom_attempt_count = 1
where fornecedor_id = '133'
  and evolusom_request_state = 'uncertain'
  and evolusom_attempt_count = 0;
