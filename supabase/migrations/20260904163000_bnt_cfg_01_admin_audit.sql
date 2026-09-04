-- BNT-CFG-01: append-only audit trail for administrative configuration changes.
-- Rollback: keep the additive table when reverting application code so existing
-- history is preserved. Drop it only in DEV with explicit authorization and
-- after exporting any required audit evidence.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.configuracoes_auditoria (
  id uuid primary key default gen_random_uuid(),
  dominio text not null,
  chave text not null,
  acao text not null,
  alvo_id text,
  autor_id uuid not null,
  autor_nome text not null,
  valor_anterior jsonb,
  valor_novo jsonb,
  created_at timestamptz not null default now(),
  constraint configuracoes_auditoria_dominio_check check (
    dominio in (
      'empresa_fiscal',
      'comercial_precificacao',
      'produtos_estoque_fulfillment',
      'mercado_livre_anuncios',
      'notificacoes',
      'integracoes',
      'dashboard_tv',
      'usuarios_permissoes',
      'sistema_jobs'
    )
  ),
  constraint configuracoes_auditoria_acao_check check (
    acao in ('created', 'updated', 'enabled', 'disabled', 'secret_set', 'secret_removed', 'removed')
  ),
  constraint configuracoes_auditoria_chave_check check (
    chave in (
      'empresa.nome',
      'empresa.nickname',
      'empresa.cnpj',
      'empresa.endereco',
      'empresa.email',
      'empresa.telefone',
      'empresa.uf_fiscal',
      'empresa.cod_municipio_fiscal',
      'configuracoes.margem_lucro',
      'configuracoes.notificacoes_push',
      'configuracoes.nfe_provider_default',
      'configuracoes.simples_aliquota_confirmada',
      'configuracoes.simples_aliquota_confirmada_em',
      'integracoes.client_id',
      'integracoes.client_secret',
      'integracoes.url',
      'integracoes.access_token',
      'integracoes.refresh_token',
      'integracoes.conectado',
      'usuarios.nome',
      'usuarios.email',
      'usuarios.cargo',
      'usuarios.avatar_url',
      'usuarios.senha',
      'usuarios.ativo'
    )
  ),
  constraint configuracoes_auditoria_alvo_check check (alvo_id is null or length(alvo_id) between 1 and 200),
  constraint configuracoes_auditoria_autor_nome_check check (length(autor_nome) between 1 and 200),
  constraint configuracoes_auditoria_valor_anterior_check check (
    valor_anterior is null or jsonb_typeof(valor_anterior) = 'object'
  ),
  constraint configuracoes_auditoria_valor_novo_check check (
    valor_novo is null or jsonb_typeof(valor_novo) = 'object'
  ),
  constraint configuracoes_auditoria_snapshots_check check (
    valor_anterior is not null or valor_novo is not null
  )
);

create index if not exists configuracoes_auditoria_created_at_idx
  on public.configuracoes_auditoria (created_at desc);

create index if not exists configuracoes_auditoria_dominio_created_at_idx
  on public.configuracoes_auditoria (dominio, created_at desc);

alter table public.configuracoes_auditoria enable row level security;

revoke all on table public.configuracoes_auditoria from public, anon, authenticated;
revoke all on table public.configuracoes_auditoria from service_role;
grant select, insert on table public.configuracoes_auditoria to service_role;

comment on table public.configuracoes_auditoria is
  'Append-only history of administrative configuration changes. Secret values are forbidden.';
comment on column public.configuracoes_auditoria.autor_id is
  'Auth user UUID snapshot without foreign key so history survives account removal.';

notify pgrst, 'reload schema';
