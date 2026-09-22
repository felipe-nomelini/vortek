begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ui_read_model_global_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'fornecedores' then
      if new.ativo is not distinct from old.ativo
         and new.status_dslite is not distinct from old.status_dslite
         and new.dropshipping is not distinct from old.dropshipping
         and new.dropshipping_retired_at is not distinct from old.dropshipping_retired_at then
        return new;
      end if;
    elsif tg_table_name = 'configuracoes' then
      if new.pricing_ml_fee_fallback_rate is not distinct from old.pricing_ml_fee_fallback_rate
         and new.pricing_unspecified_shipping_cost is not distinct from old.pricing_unspecified_shipping_cost
         and new.simples_inicio_atividade is not distinct from old.simples_inicio_atividade
         and new.simples_aliquota_confirmada is not distinct from old.simples_aliquota_confirmada
         and new.simples_aliquota_confirmada_em is not distinct from old.simples_aliquota_confirmada_em then
        return new;
      end if;
    end if;
  end if;

  perform public.request_ui_read_model_rebuild(tg_table_name||'_global_change');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

commit;
