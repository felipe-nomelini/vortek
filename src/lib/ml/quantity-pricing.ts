// Somente leitura de descontos já existentes no Mercado Livre. Não oferece nem publica faixas.
export type QuantityPricingModel = "percentage" | "absolute";

export interface QuantityPricingTier {
  minPurchaseUnit: number;
  discountPercentage: number;
  estimatedUnitAmount: number;
  currencyId: string;
  pricingModel: QuantityPricingModel;
  id?: string | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function contextsOf(entry: any): string[] {
  return Array.isArray(entry?.conditions?.context_restrictions)
    ? entry.conditions.context_restrictions.map((value: unknown) =>
        String(value || "").toLowerCase(),
      )
    : [];
}

function isBusinessEntry(entry: any): boolean {
  const contexts = contextsOf(entry);
  return (
    contexts.includes("channel_marketplace") &&
    contexts.includes("user_type_business")
  );
}

export function extractQuantityPricingTiers(
  raw: any,
  basePrice: number,
): QuantityPricingTier[] {
  const normalizedBasePrice = normalizePositiveNumber(basePrice) || 0;
  const percentageTiers: QuantityPricingTier[] = [];
  const percentageSource = Array.isArray(raw?.price_per_quantity)
    ? raw.price_per_quantity
    : [];

  for (const entry of percentageSource) {
    if (
      !isBusinessEntry(entry) ||
      String(entry?.type || "").toLowerCase() !== "discount_percentage"
    ) {
      continue;
    }
    const minPurchaseUnit = normalizePositiveInt(
      entry?.conditions?.min_purchase_unit,
    );
    const percentage = normalizePositiveNumber(entry?.percentage);
    if (
      minPurchaseUnit === null ||
      percentage === null ||
      percentage >= 100
    ) {
      continue;
    }
    percentageTiers.push({
      id: entry?.id ? String(entry.id) : null,
      minPurchaseUnit,
      discountPercentage: round6(percentage),
      estimatedUnitAmount: round2(
        normalizedBasePrice * (1 - percentage / 100),
      ),
      currencyId: String(
        raw?.presentation?.display_currency || entry?.currency_id || "BRL",
      ),
      pricingModel: "percentage",
    });
  }

  const absoluteTiers: QuantityPricingTier[] = [];
  const absoluteSource = Array.isArray(raw?.prices) ? raw.prices : [];
  for (const entry of absoluteSource) {
    if (!isBusinessEntry(entry)) continue;
    const minPurchaseUnit = normalizePositiveInt(
      entry?.conditions?.min_purchase_unit ??
        entry?.conditions?.min_purchase_quantity,
    );
    const amount = normalizePositiveNumber(entry?.amount);
    if (minPurchaseUnit === null || amount === null) continue;
    const percentage = normalizedBasePrice > 0 && amount < normalizedBasePrice
      ? round6((1 - amount / normalizedBasePrice) * 100)
      : 0;
    absoluteTiers.push({
      id: entry?.id ? String(entry.id) : null,
      minPurchaseUnit,
      discountPercentage: percentage,
      estimatedUnitAmount: round2(amount),
      currencyId: String(entry?.currency_id || "BRL"),
      pricingModel: "absolute",
    });
  }

  return [...percentageTiers, ...absoluteTiers].sort(
    (left, right) => left.minPurchaseUnit - right.minPurchaseUnit,
  );
}

export function serializeQuantityPricingTiers(
  tiers: QuantityPricingTier[],
) {
  return tiers.map((tier) => ({
    min_purchase_unit: tier.minPurchaseUnit,
    discount_percent: tier.discountPercentage,
    amount: tier.estimatedUnitAmount,
    currency_id: tier.currencyId,
    pricing_model: tier.pricingModel,
  }));
}

/** Decisão permanente, independente do gate temporário do pricing. */
export function hasRetiredQuantityPricing(payload: Record<string, unknown>): boolean {
  const enabled = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1';
  return enabled(payload.apply_quantity_pricing) || enabled(payload.update_quantity_pricing)
    || (payload.apply_quantity_pricing === undefined && payload.update_quantity_pricing === undefined
      && Number(payload.base_price_for_quantity_pricing) > 0);
}

export function retireQuantityPricingPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  if (hasRetiredQuantityPricing(payload)) {
    result.quantity_pricing_retirement = { code: 'quantity_pricing_retired' };
  }
  delete result.apply_quantity_pricing;
  delete result.update_quantity_pricing;
  delete result.base_price_for_quantity_pricing;
  return result;
}
