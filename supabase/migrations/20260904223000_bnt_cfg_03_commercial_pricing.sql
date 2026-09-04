-- BNT-CFG-03: fonte única para parâmetros comerciais e de precificação.
-- Salvar esta configuração não recalcula produtos nem publica alterações no ML.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.configuracoes
  add column if not exists pricing_ml_fee_fallback_rate numeric(7,6) not null default 0.15,
  add column if not exists pricing_unspecified_shipping_cost numeric(12,2) not null default 30,
  add column if not exists product_inactive_cost_threshold numeric(12,2) not null default 2000;

create table if not exists public.pricing_cost_tiers (
  position smallint primary key,
  max_cost numeric(12,2),
  margin_rate numeric(7,6) not null,
  min_profit numeric(12,2) not null,
  updated_at timestamptz not null default now(),
  constraint pricing_cost_tiers_position_check check (position between 1 and 3),
  constraint pricing_cost_tiers_max_cost_check check (max_cost is null or max_cost > 0),
  constraint pricing_cost_tiers_margin_rate_check check (margin_rate > 0 and margin_rate < 1),
  constraint pricing_cost_tiers_min_profit_check check (min_profit >= 0),
  constraint pricing_cost_tiers_last_unlimited_check check (
    (position = 3 and max_cost is null) or (position < 3 and max_cost is not null)
  )
);

create table if not exists public.ml_quantity_pricing_tiers (
  position smallint primary key,
  min_purchase_unit smallint not null unique,
  discount_percentage numeric(9,6) not null,
  updated_at timestamptz not null default now(),
  constraint ml_quantity_pricing_tiers_position_check check (position between 1 and 5),
  constraint ml_quantity_pricing_tiers_quantity_check check (min_purchase_unit between 1 and 100),
  constraint ml_quantity_pricing_tiers_discount_check check (
    discount_percentage > 0 and discount_percentage < 100
  )
);

insert into public.pricing_cost_tiers (position, max_cost, margin_rate, min_profit)
values
  (1, 400, 0.15, 20),
  (2, 1000, 0.20, 60),
  (3, null, 0.25, 150)
on conflict (position) do nothing;

insert into public.ml_quantity_pricing_tiers (
  position,
  min_purchase_unit,
  discount_percentage
)
values
  (1, 3, 3),
  (2, 5, 4),
  (3, 10, 5)
on conflict (position) do nothing;

do $bnt_cfg_03$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'configuracoes_pricing_ml_fee_fallback_rate_check'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint configuracoes_pricing_ml_fee_fallback_rate_check
      check (pricing_ml_fee_fallback_rate >= 0 and pricing_ml_fee_fallback_rate < 1);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'configuracoes_pricing_unspecified_shipping_cost_check'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint configuracoes_pricing_unspecified_shipping_cost_check
      check (pricing_unspecified_shipping_cost >= 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'configuracoes_product_inactive_cost_threshold_check'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint configuracoes_product_inactive_cost_threshold_check
      check (product_inactive_cost_threshold > 0);
  end if;
end;
$bnt_cfg_03$;

create or replace function public.save_commercial_pricing_configuration(
  p_ml_fee_fallback_rate numeric,
  p_unspecified_shipping_cost numeric,
  p_inactive_cost_threshold numeric,
  p_cost_tiers jsonb,
  p_quantity_tiers jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $bnt_cfg_03$
declare
  v_cost_count integer;
  v_quantity_count integer;
begin
  if p_ml_fee_fallback_rate < 0 or p_ml_fee_fallback_rate >= 1 then
    raise exception 'Taxa fallback do ML inválida';
  end if;
  if p_unspecified_shipping_cost < 0 or p_inactive_cost_threshold <= 0 then
    raise exception 'Proteções comerciais inválidas';
  end if;
  if jsonb_typeof(p_cost_tiers) <> 'array' or jsonb_array_length(p_cost_tiers) <> 3 then
    raise exception 'São obrigatórias exatamente três faixas de custo';
  end if;
  if jsonb_typeof(p_quantity_tiers) <> 'array'
    or jsonb_array_length(p_quantity_tiers) < 1
    or jsonb_array_length(p_quantity_tiers) > 5 then
    raise exception 'São obrigatórias de uma a cinco faixas por quantidade';
  end if;

  with tiers as (
    select
      (entry->>'position')::smallint as position,
      nullif(entry->>'maxCost', '')::numeric as max_cost,
      (entry->>'marginRate')::numeric as margin_rate,
      (entry->>'minProfit')::numeric as min_profit
    from jsonb_array_elements(p_cost_tiers) entry
  )
  select count(*) into v_cost_count
  from tiers tier
  where tier.position between 1 and 3
    and tier.margin_rate > 0 and tier.margin_rate < 1
    and tier.min_profit >= 0
    and ((tier.position = 3 and tier.max_cost is null)
      or (tier.position < 3 and tier.max_cost > 0));

  if v_cost_count <> 3
    or (select count(distinct (entry->>'position')::smallint) from jsonb_array_elements(p_cost_tiers) entry) <> 3
    or exists (
    select 1
    from (
      select
        (entry->>'position')::smallint as position,
        nullif(entry->>'maxCost', '')::numeric as max_cost
      from jsonb_array_elements(p_cost_tiers) entry
    ) tier
    left join (
      select
        (entry->>'position')::smallint as position,
        nullif(entry->>'maxCost', '')::numeric as max_cost
      from jsonb_array_elements(p_cost_tiers) entry
    ) previous on previous.position = tier.position - 1
    where tier.position > 1 and tier.position < 3 and tier.max_cost <= previous.max_cost
  ) then
    raise exception 'Faixas de custo inválidas ou sobrepostas';
  end if;

  with tiers as (
    select
      (entry->>'position')::smallint as position,
      (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
      (entry->>'discountPercentage')::numeric as discount_percentage
    from jsonb_array_elements(p_quantity_tiers) entry
  )
  select count(*) into v_quantity_count
  from tiers tier
  where tier.position between 1 and 5
    and tier.min_purchase_unit between 1 and 100
    and tier.discount_percentage > 0 and tier.discount_percentage < 100;

  if v_quantity_count <> jsonb_array_length(p_quantity_tiers)
    or (select count(distinct (entry->>'position')::smallint) from jsonb_array_elements(p_quantity_tiers) entry) <> v_quantity_count
    or (select sum((entry->>'position')::smallint) from jsonb_array_elements(p_quantity_tiers) entry)
      <> (v_quantity_count * (v_quantity_count + 1) / 2)
    or exists (
      select 1
      from (
        select
          (entry->>'position')::smallint as position,
          (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
          (entry->>'discountPercentage')::numeric as discount_percentage
        from jsonb_array_elements(p_quantity_tiers) entry
      ) tier
      left join (
        select
          (entry->>'position')::smallint as position,
          (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
          (entry->>'discountPercentage')::numeric as discount_percentage
        from jsonb_array_elements(p_quantity_tiers) entry
      ) previous on previous.position = tier.position - 1
      where tier.position > 1
        and (tier.min_purchase_unit <= previous.min_purchase_unit
          or tier.discount_percentage <= previous.discount_percentage)
    ) then
    raise exception 'Faixas por quantidade devem ser sequenciais e progressivas';
  end if;

  update public.configuracoes
  set
    pricing_ml_fee_fallback_rate = p_ml_fee_fallback_rate,
    pricing_unspecified_shipping_cost = p_unspecified_shipping_cost,
    product_inactive_cost_threshold = p_inactive_cost_threshold,
    updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001'::uuid;
  if not found then raise exception 'Configuração principal não encontrada'; end if;

  delete from public.pricing_cost_tiers;
  insert into public.pricing_cost_tiers (position, max_cost, margin_rate, min_profit, updated_at)
  select
    (entry->>'position')::smallint,
    nullif(entry->>'maxCost', '')::numeric,
    (entry->>'marginRate')::numeric,
    (entry->>'minProfit')::numeric,
    now()
  from jsonb_array_elements(p_cost_tiers) entry;

  delete from public.ml_quantity_pricing_tiers;
  insert into public.ml_quantity_pricing_tiers (
    position, min_purchase_unit, discount_percentage, updated_at
  )
  select
    (entry->>'position')::smallint,
    (entry->>'minPurchaseUnit')::smallint,
    (entry->>'discountPercentage')::numeric,
    now()
  from jsonb_array_elements(p_quantity_tiers) entry;
end;
$bnt_cfg_03$;

revoke all on function public.save_commercial_pricing_configuration(
  numeric, numeric, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_commercial_pricing_configuration(
  numeric, numeric, numeric, jsonb, jsonb
) to service_role;

create or replace function private.commercial_ml_fee_fallback()
returns numeric
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $bnt_cfg_03$
declare
  v_rate numeric;
begin
  select pricing_ml_fee_fallback_rate into v_rate
  from public.configuracoes
  where id = '00000000-0000-0000-0000-000000000001'::uuid;
  if v_rate is null then raise exception 'Configuração comercial indisponível'; end if;
  return v_rate;
end;
$bnt_cfg_03$;

create or replace function private.rule_02_projected_price(
  p_custom_price numeric,
  p_cost numeric,
  p_shipping numeric,
  p_ml_fee numeric,
  p_tax_rate numeric
) returns numeric
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $bnt_cfg_03$
declare
  v_margin numeric;
  v_min_profit numeric;
  v_fee numeric;
begin
  if p_custom_price is not null then return round(p_custom_price * 100) / 100; end if;

  select margin_rate, min_profit into v_margin, v_min_profit
  from public.pricing_cost_tiers
  where max_cost is null or coalesce(p_cost, 0) <= max_cost
  order by position
  limit 1;
  if v_margin is null or v_min_profit is null then
    raise exception 'Faixas comerciais indisponíveis';
  end if;

  v_fee := coalesce(p_ml_fee, private.commercial_ml_fee_fallback());
  if 1 - (p_tax_rate + v_fee) <= 0 then return null; end if;

  return round(greatest(
    (coalesce(p_cost, 0) + coalesce(p_shipping, 0) + coalesce(p_cost, 0) * v_margin)
      / (1 - (p_tax_rate + v_fee)),
    (coalesce(p_cost, 0) + coalesce(p_shipping, 0) + v_min_profit)
      / (1 - (p_tax_rate + v_fee))
  ) * 100) / 100;
end;
$bnt_cfg_03$;

revoke all on function private.commercial_ml_fee_fallback() from public, anon, authenticated;
revoke all on function private.rule_02_projected_price(
  numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;

-- As duas RPCs de produtos já possuem o cálculo consolidado. Substituímos
-- somente o fallback residual da taxa ML, preservando assinaturas e filtros.
do $bnt_cfg_03$
declare
  v_signature regprocedure;
  v_definition text;
  v_replaced text;
begin
  foreach v_signature in array array[
    'public.search_produtos_paginated(numeric,text,text[],boolean,text,text,text,numeric,numeric,text,integer,integer,text,text)'::regprocedure,
    'public.search_produtos_resumo(numeric,text,text[],boolean,text,text,text,numeric,numeric,text)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_signature);
    v_replaced := replace(v_definition, 'coalesce(filtered.ml_fee, 0.15)', 'coalesce(filtered.ml_fee, private.commercial_ml_fee_fallback())');
    v_replaced := replace(v_replaced, 'coalesce(b.ml_fee, 0.15)', 'coalesce(b.ml_fee, private.commercial_ml_fee_fallback())');
    if v_replaced = v_definition then
      raise exception 'Fallback SQL esperado não encontrado em %', v_signature;
    end if;
    execute v_replaced;
  end loop;
end;
$bnt_cfg_03$;

alter table public.pricing_cost_tiers enable row level security;
alter table public.ml_quantity_pricing_tiers enable row level security;
revoke all on table public.pricing_cost_tiers from public, anon, authenticated, service_role;
revoke all on table public.ml_quantity_pricing_tiers from public, anon, authenticated, service_role;
grant select on table public.pricing_cost_tiers to service_role;
grant select on table public.ml_quantity_pricing_tiers to service_role;

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
      'pricing_cost_tiers.policy', 'ml_quantity_pricing_tiers.policy',
      'integracoes.client_id', 'integracoes.client_secret', 'integracoes.url',
      'integracoes.access_token', 'integracoes.refresh_token', 'integracoes.conectado',
      'usuarios.nome', 'usuarios.email', 'usuarios.cargo', 'usuarios.avatar_url',
      'usuarios.senha', 'usuarios.ativo'
    )
  );

comment on column public.configuracoes.margem_lucro is
  'Campo legado obsoleto. A precificação usa public.pricing_cost_tiers.';
comment on table public.pricing_cost_tiers is
  'Fonte única das três faixas comerciais de margem e lucro mínimo.';
comment on table public.ml_quantity_pricing_tiers is
  'Política local mínima/fallback para preços por quantidade do Mercado Livre.';

notify pgrst, 'reload schema';
