-- BNT-CFG-05: Mercado Livre administration and category-aware warranty defaults.
-- Rollback: keep the additive columns while application code depends on them.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.configuracoes
  add column if not exists ml_default_warranty_type_id text not null default '2230279',
  add column if not exists ml_default_warranty_duration integer not null default 12,
  add column if not exists ml_default_warranty_unit text not null default 'meses';

alter table public.configuracoes
  drop constraint if exists configuracoes_ml_default_warranty_type_id_check;
alter table public.configuracoes
  add constraint configuracoes_ml_default_warranty_type_id_check
  check (ml_default_warranty_type_id in ('2230279', '2230280'));

alter table public.configuracoes
  drop constraint if exists configuracoes_ml_default_warranty_duration_check;
alter table public.configuracoes
  add constraint configuracoes_ml_default_warranty_duration_check
  check (ml_default_warranty_duration between 1 and 1200);

alter table public.configuracoes
  drop constraint if exists configuracoes_ml_default_warranty_unit_check;
alter table public.configuracoes
  add constraint configuracoes_ml_default_warranty_unit_check
  check (ml_default_warranty_unit in ('dias', 'meses', 'anos'));

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

comment on column public.configuracoes.ml_default_warranty_type_id is
  'Tipo de garantia padrão, aplicado somente quando aceito pelos termos de venda da categoria do Mercado Livre.';
comment on column public.configuracoes.ml_default_warranty_duration is
  'Duração positiva da garantia padrão dos anúncios Mercado Livre.';
comment on column public.configuracoes.ml_default_warranty_unit is
  'Unidade da garantia padrão: dias, meses ou anos.';

notify pgrst, 'reload schema';
