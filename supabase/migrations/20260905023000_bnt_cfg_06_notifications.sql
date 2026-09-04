-- BNT-CFG-06: event policies and recipients for operational notifications.
-- Rollback: application code can return to the legacy global push flag. Keep
-- the additive push tables and normalized WhatsApp rows to preserve settings.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.push_alert_settings (
  alert_type text primary key,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_alert_settings_type_check check (
    alert_type in ('new_sale', 'new_question', 'claim_opened')
  )
);

create table if not exists public.push_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null references public.push_alert_settings(alert_type) on delete cascade,
  recipient_role public.user_role,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint push_alert_recipients_one_target_check check (
    num_nonnulls(recipient_role, user_id) = 1
  )
);

create unique index if not exists push_alert_recipients_role_unique
  on public.push_alert_recipients (alert_type, recipient_role)
  where recipient_role is not null;

create unique index if not exists push_alert_recipients_user_unique
  on public.push_alert_recipients (alert_type, user_id)
  where user_id is not null;

create index if not exists push_alert_recipients_user_id_idx
  on public.push_alert_recipients (user_id)
  where user_id is not null;

insert into public.push_alert_settings (alert_type, enabled)
select event_type, coalesce((select notificacoes_push from public.configuracoes limit 1), false)
from unnest(array['new_sale', 'new_question', 'claim_opened']::text[]) event_type
on conflict (alert_type) do nothing;

insert into public.push_alert_recipients (alert_type, recipient_role)
select event_type, recipient_role
from unnest(array['new_sale', 'new_question', 'claim_opened']::text[]) event_type
cross join unnest(array['admin', 'gerente']::public.user_role[]) recipient_role
on conflict do nothing;

-- Convert the legacy one-row-per-event shape into one canonical row per
-- WhatsApp recipient. `all` is expanded into the eight explicit event types.
create temporary table bnt_cfg_06_whatsapp_settings on commit drop as
with normalized as (
  select
    id,
    case
      when regexp_replace(phone, '\D', '', 'g') like '55%'
        then regexp_replace(phone, '\D', '', 'g')
      else '55' || regexp_replace(phone, '\D', '', 'g')
    end as canonical_phone,
    alert_type,
    enabled,
    created_at,
    updated_at
  from public.whatsapp_alert_settings
), validated as (
  select *
  from normalized
  where canonical_phone ~ '^55[0-9]{10,11}$'
)
select
  min(id::text)::uuid as id,
  'Destinatário ••••' || right(canonical_phone, 4) as recipient_name,
  canonical_phone as phone,
  bool_or(enabled) as enabled,
  case
    when bool_or(alert_type = 'all') then array[
      'new_sale', 'new_question', 'critical_error', 'integration_status',
      'weekly_sales_report', 'monthly_sales_report', 'claim_opened',
      'ml_label_released'
    ]::text[]
    else array_agg(distinct alert_type order by alert_type)
  end as event_types,
  min(created_at) as created_at,
  max(updated_at) as updated_at
from validated
group by canonical_phone;

do $bnt_cfg_06_phone_validation$
begin
  if exists (
    select 1
    from public.whatsapp_alert_settings
    where case
      when regexp_replace(phone, '\D', '', 'g') like '55%'
        then regexp_replace(phone, '\D', '', 'g')
      else '55' || regexp_replace(phone, '\D', '', 'g')
    end !~ '^55[0-9]{10,11}$'
  ) then
    raise exception 'whatsapp_alert_settings contains an invalid phone';
  end if;
end;
$bnt_cfg_06_phone_validation$;

truncate table public.whatsapp_alert_settings;

alter table public.whatsapp_alert_settings
  drop constraint if exists whatsapp_alert_settings_alert_type_phone_key;
alter table public.whatsapp_alert_settings
  drop column if exists alert_type;
alter table public.whatsapp_alert_settings
  add column if not exists recipient_name text,
  add column if not exists event_types text[];

insert into public.whatsapp_alert_settings (
  id, recipient_name, phone, enabled, event_types, created_at, updated_at
)
select id, recipient_name, phone, enabled, event_types, created_at, updated_at
from bnt_cfg_06_whatsapp_settings;

alter table public.whatsapp_alert_settings
  alter column recipient_name set not null,
  alter column event_types set not null;

alter table public.whatsapp_alert_settings
  add constraint whatsapp_alert_settings_phone_unique unique (phone),
  add constraint whatsapp_alert_settings_name_check check (
    length(btrim(recipient_name)) between 1 and 120
  ),
  add constraint whatsapp_alert_settings_phone_check check (
    phone ~ '^55[0-9]{10,11}$'
  ),
  add constraint whatsapp_alert_settings_events_check check (
    cardinality(event_types) between 1 and 8
    and event_types <@ array[
      'new_sale', 'new_question', 'critical_error', 'integration_status',
      'weekly_sales_report', 'monthly_sales_report', 'claim_opened',
      'ml_label_released'
    ]::text[]
  );

create or replace function public.save_notification_configuration(
  p_push jsonb,
  p_whatsapp jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $bnt_cfg_06_save$
declare
  item jsonb;
  event_name text;
  role_name text;
  selected_user_id uuid;
begin
  if jsonb_typeof(p_push) <> 'array'
    or jsonb_array_length(p_push) <> 3
    or (
      select count(distinct value->>'event_type')
      from jsonb_array_elements(p_push)
    ) <> 3
    or exists (
      select 1
      from jsonb_array_elements(p_push)
      where value->>'event_type' not in ('new_sale', 'new_question', 'claim_opened')
    ) then
    raise exception 'invalid push notification policy';
  end if;

  delete from public.push_alert_recipients;
  for item in select value from jsonb_array_elements(p_push)
  loop
    event_name := item->>'event_type';
    update public.push_alert_settings
    set enabled = coalesce((item->>'enabled')::boolean, false), updated_at = now()
    where alert_type = event_name;

    for role_name in
      select value from jsonb_array_elements_text(coalesce(item->'recipient_roles', '[]'::jsonb))
    loop
      insert into public.push_alert_recipients (alert_type, recipient_role)
      values (event_name, role_name::public.user_role);
    end loop;

    for selected_user_id in
      select value::uuid from jsonb_array_elements_text(coalesce(item->'user_ids', '[]'::jsonb))
    loop
      insert into public.push_alert_recipients (alert_type, user_id)
      values (event_name, selected_user_id);
    end loop;
  end loop;

  if jsonb_typeof(p_whatsapp) <> 'array' then
    raise exception 'invalid WhatsApp recipients';
  end if;

  delete from public.whatsapp_alert_settings;
  insert into public.whatsapp_alert_settings (
    id, recipient_name, phone, enabled, event_types, created_at, updated_at
  )
  select
    coalesce(nullif(value->>'id', '')::uuid, gen_random_uuid()),
    btrim(value->>'recipient_name'),
    value->>'phone',
    coalesce((value->>'enabled')::boolean, false),
    array(
      select event_type
      from jsonb_array_elements_text(value->'event_types') event_type
      order by event_type
    ),
    now(),
    now()
  from jsonb_array_elements(p_whatsapp);
end;
$bnt_cfg_06_save$;

alter table public.push_alert_settings enable row level security;
alter table public.push_alert_recipients enable row level security;
alter table public.whatsapp_alert_settings enable row level security;

revoke all on table public.push_alert_settings from public, anon, authenticated, service_role;
revoke all on table public.push_alert_recipients from public, anon, authenticated, service_role;
revoke all on table public.whatsapp_alert_settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.push_alert_settings to service_role;
grant select, insert, update, delete on table public.push_alert_recipients to service_role;
grant select, insert, update, delete on table public.whatsapp_alert_settings to service_role;

revoke all on function public.save_notification_configuration(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_notification_configuration(jsonb, jsonb) to service_role;

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
      'configuracoes.ml_default_warranty',
      'fornecedores.dslite_catalog_xml_url',
      'fornecedores.dropshipping_retired_at',
      'pricing_cost_tiers.policy', 'ml_quantity_pricing_tiers.policy',
      'notificacoes.push.policy', 'notificacoes.whatsapp.recipients',
      'integracoes.client_id', 'integracoes.client_secret', 'integracoes.url',
      'integracoes.access_token', 'integracoes.refresh_token', 'integracoes.conectado',
      'integracoes.mercadolivre.client_id',
      'integracoes.mercadolivre.client_secret',
      'integracoes.mercadolivre.oauth_tokens',
      'integracoes.mercadolivre.conectado',
      'usuarios.nome', 'usuarios.email', 'usuarios.cargo', 'usuarios.avatar_url',
      'usuarios.senha', 'usuarios.ativo'
    )
  );

comment on table public.push_alert_settings is
  'Global enablement of each supported browser push event.';
comment on table public.push_alert_recipients is
  'Roles and explicit active users selected for each browser push event.';
comment on table public.whatsapp_alert_settings is
  'Canonical operational WhatsApp recipients and the event types each receives.';

notify pgrst, 'reload schema';
