import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  CommercialPricingConfiguration,
  PricingCostTier,
  QuantityPricingRange,
} from "@/lib/commercial-pricing";

type ServiceClient = SupabaseClient<Database>;

function finiteNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} inválido`);
  return parsed;
}

function validateCostTiers(rows: PricingCostTier[]): PricingCostTier[] {
  if (rows.length !== 3) throw new Error("A configuração comercial deve possuir exatamente três faixas de custo");
  const sorted = [...rows].sort((left, right) => left.position - right.position);
  let previousMax = 0;
  sorted.forEach((tier, index) => {
    if (tier.position !== index + 1) throw new Error("Posições das faixas de custo inválidas");
    if (tier.margin <= 0 || tier.margin >= 1 || tier.minProfit < 0) {
      throw new Error("Margem ou lucro mínimo inválido nas faixas de custo");
    }
    if (index === sorted.length - 1) {
      if (tier.maxCost !== null) throw new Error("A última faixa de custo deve ser ilimitada");
      return;
    }
    if (tier.maxCost === null || tier.maxCost <= previousMax) {
      throw new Error("Limites das faixas de custo devem ser crescentes");
    }
    previousMax = tier.maxCost;
  });
  return sorted;
}

function validateQuantityRanges(rows: QuantityPricingRange[]): QuantityPricingRange[] {
  if (rows.length < 1 || rows.length > 5) {
    throw new Error("A configuração comercial deve possuir de uma a cinco faixas por quantidade");
  }
  const sorted = [...rows].sort((left, right) => left.position - right.position);
  let previousQuantity = 0;
  let previousDiscount = 0;
  sorted.forEach((tier, index) => {
    if (tier.position !== index + 1) throw new Error("Posições das faixas por quantidade inválidas");
    if (tier.minPurchaseUnit < 1 || tier.minPurchaseUnit > 100 || tier.minPurchaseUnit <= previousQuantity) {
      throw new Error("Quantidades devem ser inteiras, únicas e crescentes entre 1 e 100");
    }
    if (
      tier.fallbackDiscountPercentage <= 0
      || tier.fallbackDiscountPercentage >= 100
      || tier.fallbackDiscountPercentage <= previousDiscount
    ) {
      throw new Error("Descontos por quantidade devem ser positivos e crescentes");
    }
    previousQuantity = tier.minPurchaseUnit;
    previousDiscount = tier.fallbackDiscountPercentage;
  });
  return sorted;
}

export async function loadCommercialPricingConfiguration(
  client: ServiceClient,
): Promise<CommercialPricingConfiguration> {
  const [configurationResult, costTiersResult, quantityTiersResult] = await Promise.all([
    client
      .from("configuracoes")
      .select("pricing_ml_fee_fallback_rate,pricing_unspecified_shipping_cost,product_inactive_cost_threshold")
      .maybeSingle(),
    client
      .from("pricing_cost_tiers")
      .select("position,max_cost,margin_rate,min_profit")
      .order("position", { ascending: true }),
    client
      .from("ml_quantity_pricing_tiers")
      .select("position,min_purchase_unit,discount_percentage")
      .order("position", { ascending: true }),
  ]);

  if (configurationResult.error) {
    throw new Error(`Falha ao carregar parâmetros comerciais: ${configurationResult.error.message}`);
  }
  if (costTiersResult.error) {
    throw new Error(`Falha ao carregar faixas de custo: ${costTiersResult.error.message}`);
  }
  if (quantityTiersResult.error) {
    throw new Error(`Falha ao carregar faixas por quantidade: ${quantityTiersResult.error.message}`);
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

  const costTiers = validateCostTiers((costTiersResult.data || []).map((row) => ({
    position: Number(row.position),
    maxCost: row.max_cost === null ? null : Number(row.max_cost),
    margin: Number(row.margin_rate),
    minProfit: Number(row.min_profit),
  })));
  const quantityPricingRanges = validateQuantityRanges((quantityTiersResult.data || []).map((row) => ({
    position: Number(row.position),
    minPurchaseUnit: Number(row.min_purchase_unit),
    fallbackDiscountPercentage: Number(row.discount_percentage),
  })));

  return {
    mlFeeFallbackRate,
    unspecifiedShippingCost,
    inactiveCostThreshold,
    costTiers,
    quantityPricingRanges,
  };
}
