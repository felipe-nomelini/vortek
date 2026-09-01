begin;

set local lock_timeout = '5s';

alter table public.estoque_recebimentos_nfe
  alter column xml_nfe drop not null,
  alter column origem_xml drop not null,
  add column if not exists modelo_documento smallint not null default 55,
  add column if not exists provider_status smallint,
  add column if not exists numero_protocolo text,
  add column if not exists valor_icms numeric(14, 2),
  add column if not exists emitente_ie text,
  add column if not exists cfops text,
  add column if not exists digest_value text,
  add column if not exists recebida_em timestamptz,
  add column if not exists snapshot_source text not null default 'operacional';

alter table public.estoque_recebimentos_nfe
  drop constraint if exists estoque_recebimentos_nfe_status_check;

alter table public.estoque_recebimentos_nfe
  add constraint estoque_recebimentos_nfe_status_check
  check (status in ('identificada', 'aguardando_conferencia', 'parcial', 'conferido'));

alter table public.estoque_recebimentos_nfe
  add constraint estoque_recebimentos_nfe_modelo_check
  check (modelo_documento = 55),
  add constraint estoque_recebimentos_nfe_provider_status_check
  check (provider_status is null or provider_status in (1, 2, 3));

alter table public.estoque_manifestacoes_nfe
  drop constraint if exists estoque_manifestacoes_nfe_pkey,
  drop constraint if exists estoque_manifestacoes_nfe_tipo_manifestacao_check;

alter table public.estoque_manifestacoes_nfe
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists recebimento_id uuid references public.estoque_recebimentos_nfe(id) on delete restrict,
  add column if not exists justificativa text,
  add column if not exists numero_sequencial integer,
  add column if not exists codigo_sefaz integer,
  add column if not exists idempotency_key text,
  add column if not exists provider_evento text,
  add column if not exists completed_at timestamptz;

update public.estoque_manifestacoes_nfe
set id = gen_random_uuid()
where id is null;

alter table public.estoque_manifestacoes_nfe
  alter column id set not null,
  add constraint estoque_manifestacoes_nfe_pkey primary key (id),
  add constraint estoque_manifestacoes_nfe_tipo_manifestacao_check
    check (tipo_manifestacao in (1, 2, 3, 4)),
  add constraint estoque_manifestacoes_nfe_justificativa_check
    check (
      tipo_manifestacao <> 4
      or char_length(trim(coalesce(justificativa, ''))) between 15 and 255
    );

create unique index estoque_manifestacoes_nfe_idempotency_key_idx
  on public.estoque_manifestacoes_nfe (idempotency_key)
  where idempotency_key is not null;

create index estoque_manifestacoes_nfe_chave_requested_idx
  on public.estoque_manifestacoes_nfe (chave_nfe, requested_at desc);

alter table public.estoque_interno_movimentacoes
  add column if not exists snapshot_source text not null default 'operacional';

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_fixture_inerte_check
  check (
    snapshot_source <> 'bnt_d05_inventory_mock'
    or estornada_em is not null
  );

create table public.brasilnfe_webhook_entregas (
  delivery_id text primary key,
  evento text not null,
  evento_em timestamptz not null,
  tentativa integer,
  modelo_documento smallint,
  chave_nfe text,
  body_sha256 text not null,
  resultado text not null check (resultado in ('processado', 'duplicado', 'ignorado_modelo', 'ignorado_destinatario')),
  recebida_em timestamptz not null default now()
);

alter table public.brasilnfe_webhook_entregas enable row level security;
revoke all on table public.brasilnfe_webhook_entregas from public, anon, authenticated;
grant select, insert on table public.brasilnfe_webhook_entregas to service_role;

create or replace function public.process_brasilnfe_incoming_webhook(
  p_delivery_id text,
  p_event text,
  p_event_at timestamptz,
  p_attempt integer,
  p_body_sha256 text,
  p_tipo_ambiente smallint,
  p_expected_recipient_cnpj text,
  p_data jsonb
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_model smallint := nullif(p_data->>'ModeloDocumento', '')::smallint;
  v_key text := regexp_replace(coalesce(p_data->>'Chave', ''), '\D', '', 'g');
  v_recipient text := regexp_replace(coalesce(p_data->>'CnpjDestinatario', ''), '\D', '', 'g');
  v_result text;
begin
  if nullif(trim(p_delivery_id), '') is null
    or p_event not in ('documento.entrada.recebida', 'documento.entrada.cancelada') then
    raise exception using errcode = '22023', message = 'invalid_brasilnfe_webhook';
  end if;

  if exists (
    select 1 from public.brasilnfe_webhook_entregas entrega
    where entrega.delivery_id = p_delivery_id
  ) then
    return 'duplicado';
  end if;

  if v_model <> 55 then
    v_result := 'ignorado_modelo';
  elsif v_recipient <> regexp_replace(coalesce(p_expected_recipient_cnpj, ''), '\D', '', 'g') then
    v_result := 'ignorado_destinatario';
  else
    v_result := 'processado';
  end if;

  insert into public.brasilnfe_webhook_entregas (
    delivery_id, evento, evento_em, tentativa, modelo_documento,
    chave_nfe, body_sha256, resultado
  ) values (
    p_delivery_id, p_event, p_event_at, p_attempt, v_model,
    nullif(v_key, ''), p_body_sha256, v_result
  );

  if v_result = 'processado' then
    if v_key !~ '^[0-9]{44}$' then
      raise exception using errcode = '22023', message = 'invalid_incoming_nfe_key';
    end if;

    insert into public.estoque_recebimentos_nfe (
      chave_nfe, tipo_ambiente, numero, emitente_cnpj, emitente_nome,
      destinatario_cnpj, emitida_em, valor_total, status, modelo_documento,
      provider_status, numero_protocolo, valor_icms, emitente_ie, cfops,
      digest_value, recebida_em, snapshot_source
    ) values (
      v_key, p_tipo_ambiente, nullif(p_data->>'Numero', ''),
      regexp_replace(coalesce(p_data->>'CnpjEmissor', ''), '\D', '', 'g'),
      coalesce(nullif(trim(p_data->>'NomeEmissor'), ''), 'Emitente não informado'),
      v_recipient, nullif(p_data->>'DtEmissao', '')::timestamptz,
      coalesce(nullif(p_data->>'Valor', '')::numeric, 0), 'identificada', 55,
      nullif(p_data->>'Status', '')::smallint, nullif(p_data->>'NumeroProtocolo', ''),
      nullif(p_data->>'ValorIcms', '')::numeric, nullif(p_data->>'IeEmissor', ''),
      nullif(p_data->>'Cfops', ''), nullif(p_data->>'DigestValue', ''),
      nullif(p_data->>'DtRecebimento', '')::timestamptz, 'brasilnfe_webhook'
    ) on conflict (chave_nfe) do update set
      numero = excluded.numero,
      emitente_cnpj = excluded.emitente_cnpj,
      emitente_nome = excluded.emitente_nome,
      destinatario_cnpj = excluded.destinatario_cnpj,
      emitida_em = excluded.emitida_em,
      valor_total = excluded.valor_total,
      provider_status = excluded.provider_status,
      numero_protocolo = excluded.numero_protocolo,
      valor_icms = excluded.valor_icms,
      emitente_ie = excluded.emitente_ie,
      cfops = excluded.cfops,
      digest_value = excluded.digest_value,
      recebida_em = excluded.recebida_em,
      updated_at = now();
  end if;

  return v_result;
end;
$$;

revoke all on function public.process_brasilnfe_incoming_webhook(text, text, timestamptz, integer, text, smallint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_brasilnfe_incoming_webhook(text, text, timestamptz, integer, text, smallint, text, jsonb)
  to service_role;

alter function public.confirm_internal_stock_receipt(uuid, jsonb, text, uuid)
  rename to confirm_internal_stock_receipt_operational;

create or replace function public.confirm_internal_stock_receipt(
  p_receipt_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_user_id uuid
) returns table (
  receipt_status text,
  product_ids uuid[],
  movements_created integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source text;
begin
  select recebimento.snapshot_source into v_source
  from public.estoque_recebimentos_nfe recebimento
  where recebimento.id = p_receipt_id;

  if v_source = 'bnt_d05_inventory_mock' then
    raise exception using errcode = 'P0001', message = 'homologation_fixture_read_only';
  end if;

  return query
  select * from public.confirm_internal_stock_receipt_operational(
    p_receipt_id, p_items, p_idempotency_key, p_user_id
  );
end;
$$;

revoke all on function public.confirm_internal_stock_receipt(uuid, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_internal_stock_receipt(uuid, jsonb, text, uuid)
  to service_role;

commit;
