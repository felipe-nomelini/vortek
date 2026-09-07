import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  CommercialPricingConfiguration,
} from "@/lib/commercial-pricing";

type ServiceClient = SupabaseClient<Database>;

function finiteNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} inválido`);
  return parsed;
}

export async function loadCommercialPricingConfiguration(
  client: ServiceClient,
): Promise<CommercialPricingConfiguration> {
  const configurationResult = await client
    .from("configuracoes")
    .select("pricing_ml_fee_fallback_rate,pricing_unspecified_shipping_cost,product_inactive_cost_threshold")
    .maybeSingle();

  if (configurationResult.error) {
    throw new Error(`Falha ao carregar parâmetros comerciais: ${configurationResult.error.message}`);
  }
  if (!configurationResult.data) throw new Error("Configuração comercial não encontrada");

  const mlFeeFallbackRate = finiteNumber(
    configurationResult.data.pricing_ml_fee_fallback_rate,
    "Taxa fallback do Mercado Livre",
  );
  const unspecifiedShippingCost = finiteNumber(
    configurationResult.data.pricing_unspecified_shipping_cost,
    "Frete não informado",
  );
  const inactiveCostThreshold = finiteNumber(
    configurationResult.data.product_inactive_cost_threshold,
    "Limite de inativação por custo",
  );
  if (mlFeeFallbackRate < 0 || mlFeeFallbackRate >= 1) {
    throw new Error("Taxa fallback do Mercado Livre deve estar entre 0% e menos de 100%");
  }
  if (unspecifiedShippingCost < 0 || inactiveCostThreshold <= 0) {
    throw new Error("Proteções comerciais inválidas");
  }


  return {
    mlFeeFallbackRate,
    unspecifiedShippingCost,
    inactiveCostThreshold,
  };
}
