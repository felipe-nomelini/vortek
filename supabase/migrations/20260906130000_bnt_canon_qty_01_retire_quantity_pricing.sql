-- BNT-CANON-QTY-01. Preserva faixas/auditoria históricas; retira somente o writer.
drop function public.save_commercial_pricing_configuration(numeric,numeric,numeric,jsonb);

create function public.save_commercial_pricing_configuration(
  p_ml_fee_fallback_rate numeric,
  p_unspecified_shipping_cost numeric,
  p_inactive_cost_threshold numeric
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if p_ml_fee_fallback_rate is null or p_ml_fee_fallback_rate < 0 or p_ml_fee_fallback_rate >= 1 then
    raise exception 'Taxa fallback do ML inválida';
  end if;
  if p_unspecified_shipping_cost is null or p_inactive_cost_threshold is null
    or p_unspecified_shipping_cost < 0 or p_inactive_cost_threshold <= 0 then
    raise exception 'Proteções comerciais inválidas';
  end if;

  update public.configuracoes
  set pricing_ml_fee_fallback_rate = p_ml_fee_fallback_rate,
      pricing_unspecified_shipping_cost = p_unspecified_shipping_cost,
      product_inactive_cost_threshold = p_inactive_cost_threshold,
      updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001'::uuid;
  if not found then raise exception 'Configuração principal não encontrada'; end if;
end;
$function$;

revoke all on function public.save_commercial_pricing_configuration(numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.save_commercial_pricing_configuration(numeric,numeric,numeric) to service_role;
comment on table public.ml_quantity_pricing_tiers is
  'Histórico legado. Desconto por quantidade aposentado pelo Cânon Comercial; sem consumidor ou escrita operacional.';
-- RLS, grants de somente leitura e chaves antigas da auditoria são preservados.
notify pgrst, 'reload schema';
