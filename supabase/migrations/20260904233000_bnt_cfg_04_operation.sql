-- BNT-CFG-04: typed operational settings for products, stock and fulfillment.
-- Rollback: keep the additive columns while application code depends on them.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.configuracoes
  add column if not exists order_operational_delay_minutes integer not null default 60,
  add column if not exists internal_stock_return_address_id text,
  add column if not exists internal_stock_return_zip_code text;

alter table public.configuracoes
  drop constraint if exists configuracoes_order_operational_delay_minutes_check;
alter table public.configuracoes
  add constraint configuracoes_order_operational_delay_minutes_check
  check (order_operational_delay_minutes between 5 and 1440);

alter table public.configuracoes
  drop constraint if exists configuracoes_internal_stock_return_address_id_check;
alter table public.configuracoes
  add constraint configuracoes_internal_stock_return_address_id_check
  check (
    internal_stock_return_address_id is null
    or length(btrim(internal_stock_return_address_id)) between 1 and 80
  );

alter table public.configuracoes
  drop constraint if exists configuracoes_internal_stock_return_zip_code_check;
alter table public.configuracoes
  add constraint configuracoes_internal_stock_return_zip_code_check
  check (
    internal_stock_return_zip_code is null
    or internal_stock_return_zip_code ~ '^\d{8}$'
  );

update public.configuracoes
set
  internal_stock_return_address_id = coalesce(internal_stock_return_address_id, '1634853936'),
  internal_stock_return_zip_code = coalesce(internal_stock_return_zip_code, '21011550')
where id = '00000000-0000-0000-0000-000000000001'::uuid;

alter table public.fornecedores
  add column if not exists dropshipping_retired_at timestamptz,
  add column if not exists dslite_catalog_xml_url text;

-- The feed URL is write-only outside the service role. Preserve read access to
-- every other supplier column without exposing the secret through PostgREST.
revoke select on table public.fornecedores from anon, authenticated;
do $bnt_cfg_04_supplier_columns$
declare
  v_column record;
begin
  for v_column in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fornecedores'
      and column_name <> 'dslite_catalog_xml_url'
  loop
    execute format(
      'grant select (%I) on public.fornecedores to anon, authenticated',
      v_column.column_name
    );
  end loop;
end;
$bnt_cfg_04_supplier_columns$;

alter table public.fornecedores
  drop constraint if exists fornecedores_dslite_catalog_xml_url_check;
alter table public.fornecedores
  add constraint fornecedores_dslite_catalog_xml_url_check check (
    dslite_catalog_xml_url is null
    or (
      length(dslite_catalog_xml_url) <= 2048
      and dslite_catalog_xml_url ~ '^https://app\.dslite\.com\.br/getXMLCrossdocking/'
    )
  );

insert into public.fornecedores (
  dslite_id, nome, apelido, ativo, status_dslite, dropshipping_retired_at
)
values (
  '134', 'Fornecedor DSLite 134 (aposentado)', 'DSLite 134', false, 'aposentado', now()
)
on conflict (dslite_id) do update
set
  ativo = false,
  dropshipping_retired_at = coalesce(public.fornecedores.dropshipping_retired_at, excluded.dropshipping_retired_at);

update public.fornecedores
set
  ativo = false,
  dropshipping_retired_at = coalesce(dropshipping_retired_at, now())
where dslite_id = '2';

do $bnt_cfg_04_xml$
declare
  v_raw text;
  v_feeds jsonb;
  v_entry record;
  v_updated integer;
begin
  select value into v_raw
  from public.sync_runtime_config
  where key = 'dslite_catalog_xml_urls';

  if v_raw is null then
    return;
  end if;

  begin
    v_feeds := v_raw::jsonb;
  exception when others then
    raise exception 'dslite_catalog_xml_urls contém JSON inválido; migration interrompida';
  end;

  if jsonb_typeof(v_feeds) <> 'object' then
    raise exception 'dslite_catalog_xml_urls deve ser um objeto JSON; migration interrompida';
  end if;

  for v_entry in select key, value from jsonb_each_text(v_feeds)
  loop
    if v_entry.value !~ '^https://app\.dslite\.com\.br/getXMLCrossdocking/' then
      raise exception 'URL XML inválida para fornecedor DSLite %; migration interrompida', v_entry.key;
    end if;

    update public.fornecedores
    set dslite_catalog_xml_url = v_entry.value
    where dslite_id = v_entry.key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Fornecedor DSLite % do XML não existe; migration interrompida', v_entry.key;
    end if;
  end loop;

  delete from public.sync_runtime_config
  where key = 'dslite_catalog_xml_urls';
end;
$bnt_cfg_04_xml$;

alter table public.configuracoes_auditoria
  drop constraint if exists configuracoes_auditoria_chave_check;
alter table public.configuracoes_auditoria
  add constraint configuracoes_auditoria_chave_check check (
    chave in (
      'empresa.nome', 'empresa.nickname', 'empresa.cnpj', 'empresa.endereco',
      'empresa.endereco_fiscal', 'empresa.email', 'empresa.telefone',
      'empresa.uf_fiscal', 'empresa.cod_municipio_fiscal',
      'configuracoes.margem_lucro', 'configuracoes.notificacoes_push',
      'configuracoes.nfe_provider_default', 'configuracoes.simples_inicio_atividade',
      'configuracoes.simples_aliquota_confirmada',
      'configuracoes.simples_aliquota_confirmada_em',
      'configuracoes.pricing_ml_fee_fallback_rate',
      'configuracoes.pricing_unspecified_shipping_cost',
      'configuracoes.product_inactive_cost_threshold',
      'configuracoes.order_operational_delay_minutes',
      'configuracoes.internal_stock_return_address',
      'fornecedores.dslite_catalog_xml_url',
      'fornecedores.dropshipping_retired_at',
      'pricing_cost_tiers.policy', 'ml_quantity_pricing_tiers.policy',
      'integracoes.client_id', 'integracoes.client_secret', 'integracoes.url',
      'integracoes.access_token', 'integracoes.refresh_token', 'integracoes.conectado',
      'usuarios.nome', 'usuarios.email', 'usuarios.cargo', 'usuarios.avatar_url',
      'usuarios.senha', 'usuarios.ativo'
    )
  );

comment on column public.configuracoes.order_operational_delay_minutes is
  'Tempo até um pedido em preparação entrar na fila de atenção operacional.';
comment on column public.configuracoes.internal_stock_return_address_id is
  'ID do default_return_address validado na conta Mercado Livre conectada.';
comment on column public.fornecedores.dropshipping_retired_at is
  'Aposentadoria operacional permanente do fornecedor no fluxo de dropshipping.';
comment on column public.fornecedores.dslite_catalog_xml_url is
  'URL confidencial e write-only do feed XML de reconciliação DSLite.';

notify pgrst, 'reload schema';
