alter table public.fornecedores
  add column if not exists dslite_id text,
  add column if not exists apelido text not null default '',
  add column if not exists status_dslite text not null default '',
  add column if not exists crossdocking text not null default '',
  add column if not exists dropshipping text not null default '',
  add column if not exists payload_dslite jsonb not null default '{}'::jsonb,
  add column if not exists dslite_ultima_sync timestamptz,
  add column if not exists ativo boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fornecedores_dslite_id_key'
  ) then
    alter table public.fornecedores
      add constraint fornecedores_dslite_id_key unique (dslite_id);
  end if;
end
$$;
