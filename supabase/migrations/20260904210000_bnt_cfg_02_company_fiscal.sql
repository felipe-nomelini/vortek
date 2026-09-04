-- BNT-CFG-02: cadastro empresarial/fiscal estruturado e fontes únicas.
-- Rollback da aplicação: manter as colunas aditivas e o histórico. A reversão
-- do schema, se realmente necessária, deve ser feita por migration posterior.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $bnt_cfg_02$
begin
  if (select count(*) from public.empresa) > 1 then
    raise exception 'BNT-CFG-02 exige no máximo um registro em public.empresa';
  end if;
end;
$bnt_cfg_02$;

alter table public.empresa
  add column if not exists cep_fiscal text,
  add column if not exists logradouro_fiscal text,
  add column if not exists numero_fiscal text,
  add column if not exists complemento_fiscal text,
  add column if not exists bairro_fiscal text,
  add column if not exists municipio_fiscal text;

update public.configuracoes
set nfe_provider_default = 'brasilnfe'
where nfe_provider_default <> 'brasilnfe';

do $bnt_cfg_02$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'empresa_cep_fiscal_check'
      and conrelid = 'public.empresa'::regclass
  ) then
    alter table public.empresa
      add constraint empresa_cep_fiscal_check
      check (cep_fiscal is null or cep_fiscal ~ '^[0-9]{8}$');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'empresa_endereco_fiscal_completo_check'
      and conrelid = 'public.empresa'::regclass
  ) then
    alter table public.empresa
      add constraint empresa_endereco_fiscal_completo_check
      check (
        (cep_fiscal is null and logradouro_fiscal is null and numero_fiscal is null
          and complemento_fiscal is null and bairro_fiscal is null and municipio_fiscal is null)
        or
        (cep_fiscal is not null and coalesce(length(trim(logradouro_fiscal)), 0) between 1 and 200
          and coalesce(length(trim(numero_fiscal)), 0) between 1 and 30
          and (complemento_fiscal is null or length(trim(complemento_fiscal)) <= 120)
          and coalesce(length(trim(bairro_fiscal)), 0) between 1 and 120
          and coalesce(length(trim(municipio_fiscal)), 0) between 1 and 120)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'configuracoes_nfe_provider_default_check'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint configuracoes_nfe_provider_default_check
      check (nfe_provider_default = 'brasilnfe');
  end if;
end;
$bnt_cfg_02$;

create unique index if not exists empresa_singleton_idx
  on public.empresa ((true));

insert into public.configuracoes (
  id,
  margem_lucro,
  notificacoes_push,
  nfe_provider_default,
  simples_inicio_atividade
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  30,
  false,
  'brasilnfe',
  date '2026-03-23'
where not exists (select 1 from public.configuracoes);

alter table public.configuracoes
  alter column simples_inicio_atividade drop default;

alter table public.configuracoes_auditoria
  drop constraint if exists configuracoes_auditoria_chave_check;

alter table public.configuracoes_auditoria
  add constraint configuracoes_auditoria_chave_check check (
    chave in (
      'empresa.nome',
      'empresa.nickname',
      'empresa.cnpj',
      'empresa.endereco',
      'empresa.endereco_fiscal',
      'empresa.email',
      'empresa.telefone',
      'empresa.uf_fiscal',
      'empresa.cod_municipio_fiscal',
      'configuracoes.margem_lucro',
      'configuracoes.notificacoes_push',
      'configuracoes.nfe_provider_default',
      'configuracoes.simples_inicio_atividade',
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
  );

alter table public.empresa enable row level security;
alter table public.configuracoes enable row level security;

revoke all on table public.empresa from public, anon, authenticated;
revoke all on table public.configuracoes from public, anon, authenticated;
grant select, insert, update on table public.empresa to service_role;
grant select, insert, update on table public.configuracoes to service_role;

comment on column public.empresa.endereco is
  'Projecao textual derivada do endereco fiscal estruturado; nao editar independentemente.';
comment on index public.empresa_singleton_idx is
  'Garante uma unica identidade empresarial por banco/ambiente.';

notify pgrst, 'reload schema';
