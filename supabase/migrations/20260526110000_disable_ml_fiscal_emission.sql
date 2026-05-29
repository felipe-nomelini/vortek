-- Corte definitivo de emissão fiscal via Mercado Livre.
-- Brasil NFe permanece como única fonte fiscal ativa.

-- 1) Normaliza provedor fiscal padrão para brasilnfe
update public.configuracoes
set nfe_provider_default = 'brasilnfe'
where coalesce(lower(nfe_provider_default), '') <> 'brasilnfe';

-- 2) Marca origem fiscal para registros históricos sem provider
update public.pedidos
set nfe_provider = case
  when lower(coalesce(nfe_provider, '')) = 'brasilnfe' then 'brasilnfe'
  when lower(coalesce(nfe_provider, '')) = 'mercadolivre' then 'mercadolivre_legacy'
  when nfe_provider is null and nfe_chave is not null and nfe_external_id is not null then 'brasilnfe'
  when nfe_provider is null and nfe_chave is not null then 'mercadolivre_legacy'
  else nfe_provider
end
where nfe_chave is not null
  and (
    nfe_provider is null
    or lower(nfe_provider) = 'mercadolivre'
  );
