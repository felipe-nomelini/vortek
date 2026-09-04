import type { QuantityPricingRange } from "@/lib/commercial-pricing";

export type QuantityPricingRecommendationSource =
  | "mercado_livre"
  | "fallback_204";

export type QuantityPricingModel = "percentage" | "absolute";

export interface QuantityPricingTier {
  minPurchaseUnit: number;
  discountPercentage: number;
  estimatedUnitAmount: number;
  currencyId: string;
  pricingModel: QuantityPricingModel;
  id?: string | null;
}

export interface QuantityPricingPreviewResult {
  ok: boolean;
  error: string | null;
  code: string | null;
  httpStatus: number | null;
  providerBody: unknown;
  source: QuantityPricingRecommendationSource | null;
  basePrice: number;
  currencyId: string;
  tiers: QuantityPricingTier[];
}

export interface QuantityPricingApplyResult {
  ok: boolean;
  error: string | null;
  code: string | null;
  httpStatus: number | null;
  providerBody: unknown;
  recommendationSource: QuantityPricingRecommendationSource | null;
  tiersExpected: QuantityPricingTier[];
  tiersFound: QuantityPricingTier[];
}

export interface QuantityPricingRequestResult<T = unknown> {
  ok: boolean;
  status: number | null;
  data: T | null;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}

export type QuantityPricingRequester = <T = unknown>(
  path: string,
  options?: RequestInit,
) => Promise<QuantityPricingRequestResult<T>>;

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

function providerFailure(
  result: QuantityPricingRequestResult,
  fallbackCode: string,
  fallbackMessage: string,
): QuantityPricingPreviewResult {
  return {
    ok: false,
    error: result.error?.message || fallbackMessage,
    code: result.error?.code || fallbackCode,
    httpStatus: result.status,
    providerBody: result.error,
    source: null,
    basePrice: 0,
    currencyId: "BRL",
    tiers: [],
  };
}

export function buildQuantityPricingPreview(
  raw: unknown,
  status: number | null,
  basePrice: number,
  configuredRanges: QuantityPricingRange[],
  currencyId = "BRL",
): QuantityPricingPreviewResult {
  const normalizedBasePrice = normalizePositiveNumber(basePrice);
  if (normalizedBasePrice === null) {
    return {
      ok: false,
      error: "Preço-base inválido para calcular preços por quantidade.",
      code: "quantity_pricing_base_price_invalid",
      httpStatus: null,
      providerBody: raw,
      source: null,
      basePrice: 0,
      currencyId,
      tiers: [],
    };
  }

  if (status === 204) {
    const tiers = configuredRanges.map((range) => ({
      minPurchaseUnit: range.minPurchaseUnit,
      discountPercentage: range.fallbackDiscountPercentage,
      estimatedUnitAmount: round2(
        normalizedBasePrice * (1 - range.fallbackDiscountPercentage / 100),
      ),
      currencyId,
      pricingModel: "percentage" as const,
    }));
    return {
      ok: true,
      error: null,
      code: null,
      httpStatus: 204,
      providerBody: raw,
      source: "fallback_204",
      basePrice: round2(normalizedBasePrice),
      currencyId,
      tiers,
    };
  }

  const recommendations = Array.isArray((raw as any)?.recommendations)
    ? (raw as any).recommendations
    : [];
  const tiers: QuantityPricingTier[] = [];

  for (const range of configuredRanges) {
    const recommendation = recommendations.find(
      (entry: any) => Number(entry?.quantity) === range.minPurchaseUnit,
    );
    if (!recommendation || recommendation.is_incoherent_quantity === true) {
      continue;
    }

    const percentage = normalizePositiveNumber(
      recommendation?.discount?.percentage,
    );
    if (percentage === null || percentage >= 100) {
      return {
        ok: false,
        error: `Percentual recomendado inválido para ${range.minPurchaseUnit} unidades.`,
        code: "quantity_pricing_recommendation_invalid",
        httpStatus: status,
        providerBody: raw,
        source: null,
        basePrice: round2(normalizedBasePrice),
        currencyId,
        tiers: [],
      };
    }

    const normalizedPercentage = round6(Math.max(
      percentage,
      range.fallbackDiscountPercentage,
    ));
    const recommendedAmount = normalizePositiveNumber(recommendation?.amount);
    tiers.push({
      minPurchaseUnit: range.minPurchaseUnit,
      discountPercentage: normalizedPercentage,
      estimatedUnitAmount: recommendedAmount === null || normalizedPercentage !== round6(percentage)
        ? round2(normalizedBasePrice * (1 - normalizedPercentage / 100))
        : round2(recommendedAmount),
      currencyId,
      pricingModel: "percentage",
    });
  }

  if (tiers.length === 0) {
    return {
      ok: false,
      error: "Mercado Livre não retornou faixas coerentes para preços por quantidade.",
      code: "quantity_pricing_recommendation_empty",
      httpStatus: status,
      providerBody: raw,
      source: null,
      basePrice: round2(normalizedBasePrice),
      currencyId,
      tiers: [],
    };
  }

  for (let index = 1; index < tiers.length; index += 1) {
    if (
      tiers[index].discountPercentage <=
      tiers[index - 1].discountPercentage
    ) {
      return {
        ok: false,
        error: "Percentuais recomendados não são progressivos por quantidade.",
        code: "quantity_pricing_recommendation_not_progressive",
        httpStatus: status,
        providerBody: raw,
        source: null,
        basePrice: round2(normalizedBasePrice),
        currencyId,
        tiers: [],
      };
    }
  }

  return {
    ok: true,
    error: null,
    code: null,
    httpStatus: status,
    providerBody: raw,
    source: "mercado_livre",
    basePrice: round2(normalizedBasePrice),
    currencyId,
    tiers,
  };
}

export async function previewItemQuantityPricing(
  requester: QuantityPricingRequester,
  itemId: string,
  basePrice: number,
  configuredRanges: QuantityPricingRange[],
  currencyId = "BRL",
): Promise<QuantityPricingPreviewResult> {
  const result = await requester<any>(
    "/prices-per-quantity/v1/recommendations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: itemId,
        range_item_quantities: configuredRanges.map(
          (range) => range.minPurchaseUnit,
        ),
        price: {
          standard_amount: round2(basePrice),
          currency: currencyId,
        },
      }),
    },
  );

  if (!result.ok) {
    const failure = providerFailure(
      result,
      "quantity_pricing_recommendation_failed",
      "Falha ao obter recomendações de preços por quantidade.",
    );
    failure.basePrice = round2(Number(basePrice) || 0);
    failure.currencyId = currencyId;
    return failure;
  }

  return buildQuantityPricingPreview(
    result.data,
    result.status,
    basePrice,
    configuredRanges,
    currencyId,
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

function extractStandardPrice(raw: any): {
  amount: number;
  currencyId: string;
} | null {
  const prices = Array.isArray(raw?.prices) ? raw.prices : [];
  const standard = prices.find((entry: any) => {
    const contexts = contextsOf(entry);
    return (
      String(entry?.type || "").toLowerCase() === "standard" &&
      !contexts.includes("user_type_business")
    );
  });
  const amount = normalizePositiveNumber(standard?.amount);
  if (amount === null) return null;
  return {
    amount: round2(amount),
    currencyId: String(
      standard?.currency_id || raw?.presentation?.display_currency || "BRL",
    ),
  };
}

function hasBusinessNetPricing(raw: any): boolean {
  return (Array.isArray(raw?.prices) ? raw.prices : []).some(
    (entry: any) =>
      isBusinessEntry(entry) &&
      String(entry?.amount_tax_inclusion_type || "").toLowerCase() === "net",
  );
}

function hasLegacyAbsolutePricing(raw: any): boolean {
  return (Array.isArray(raw?.prices) ? raw.prices : []).some(
    (entry: any) =>
      isBusinessEntry(entry) &&
      normalizePositiveInt(entry?.conditions?.min_purchase_unit) !== null &&
      String(entry?.amount_tax_inclusion_type || "").toLowerCase() !== "net",
  );
}

export function buildQuantityPricingPayload(
  tiers: QuantityPricingTier[],
  currentPrices: any,
) {
  const currentPercentageTiers = Array.isArray(
    currentPrices?.price_per_quantity,
  )
    ? currentPrices.price_per_quantity
    : [];

  return {
    price_per_quantity: tiers.map((tier) => {
      const current = currentPercentageTiers.find(
        (entry: any) =>
          isBusinessEntry(entry) &&
          Number(entry?.conditions?.min_purchase_unit) ===
            tier.minPurchaseUnit,
      );
      return {
        ...(current?.id ? { id: String(current.id) } : {}),
        type: "discount_percentage",
        percentage: tier.discountPercentage,
        conditions: {
          context_restrictions: [
            "channel_marketplace",
            "user_type_business",
          ],
          min_purchase_unit: tier.minPurchaseUnit,
          eligible: true,
        },
      };
    }),
  };
}

export function quantityPricingTiersMatch(
  found: QuantityPricingTier[],
  expected: QuantityPricingTier[],
): boolean {
  const foundPercentage = found.filter(
    (tier) => tier.pricingModel === "percentage",
  );
  if (foundPercentage.length !== expected.length) return false;
  return expected.every((tier) => {
    const match = foundPercentage.find(
      (candidate) => candidate.minPurchaseUnit === tier.minPurchaseUnit,
    );
    return Boolean(
      match &&
      Math.abs(match.discountPercentage - tier.discountPercentage) <= 0.000001,
    );
  });
}

export async function applyItemQuantityPricing(
  requester: QuantityPricingRequester,
  itemId: string,
  basePrice: number,
  configuredRanges: QuantityPricingRange[],
): Promise<QuantityPricingApplyResult> {
  const emptyResult = (
    error: string,
    code: string,
    httpStatus: number | null,
    providerBody: unknown,
    expected: QuantityPricingTier[] = [],
    source: QuantityPricingRecommendationSource | null = null,
  ): QuantityPricingApplyResult => ({
    ok: false,
    error,
    code,
    httpStatus,
    providerBody,
    recommendationSource: source,
    tiersExpected: expected,
    tiersFound: [],
  });

  const currentResult = await requester<any>(
    `/items/${encodeURIComponent(itemId)}/prices?display_version=true`,
    {
      method: "GET",
      headers: { "show-all-prices": "TRUE" },
    },
  );
  if (!currentResult.ok) {
    return emptyResult(
      currentResult.error?.message ||
        "Falha ao obter a versão atual dos preços do item.",
      currentResult.error?.code || "quantity_pricing_version_fetch_failed",
      currentResult.status,
      currentResult.error,
    );
  }

  const version = normalizePositiveInt((currentResult.data as any)?.version);
  if (version === null) {
    return emptyResult(
      "Mercado Livre não retornou a versão atual dos preços do item.",
      "quantity_pricing_version_missing",
      currentResult.status,
      currentResult.data,
    );
  }

  if (hasBusinessNetPricing(currentResult.data)) {
    return emptyResult(
      "O item possui preços líquidos B2B; a migração percentual automática foi bloqueada.",
      "quantity_pricing_net_price_incompatible",
      422,
      currentResult.data,
    );
  }

  const standardPrice = extractStandardPrice(currentResult.data);
  if (!standardPrice) {
    return emptyResult(
      "Mercado Livre não retornou um preço standard válido.",
      "quantity_pricing_standard_price_missing",
      currentResult.status,
      currentResult.data,
    );
  }

  const normalizedBasePrice = round2(Number(basePrice));
  if (
    !Number.isFinite(normalizedBasePrice) ||
    normalizedBasePrice <= 0 ||
    Math.abs(standardPrice.amount - normalizedBasePrice) >= 0.01
  ) {
    return emptyResult(
      "O preço-base mudou antes da publicação do atacado; uma nova tentativa deve usar o preço atual.",
      "quantity_pricing_base_price_conflict",
      409,
      currentResult.data,
    );
  }

  const preview = await previewItemQuantityPricing(
    requester,
    itemId,
    standardPrice.amount,
    configuredRanges,
    standardPrice.currencyId,
  );
  if (!preview.ok) {
    return emptyResult(
      preview.error || "Falha ao calcular preços por quantidade.",
      preview.code || "quantity_pricing_recommendation_failed",
      preview.httpStatus,
      preview.providerBody,
    );
  }

  const payload = buildQuantityPricingPayload(preview.tiers, currentResult.data);
  const removeLegacyAbsolute = hasLegacyAbsolutePricing(currentResult.data);
  const endpoint = `/items/${encodeURIComponent(itemId)}/prices/price-per-quantity${
    removeLegacyAbsolute ? "?remove-absolute-pxq=true" : ""
  }`;
  const publishResult = await requester<any>(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Version": String(version),
    },
    body: JSON.stringify(payload),
  });
  if (!publishResult.ok) {
    const publishCode = publishResult.status === 409
      ? "quantity_pricing_version_conflict"
      : publishResult.error?.code || "quantity_pricing_provider_rejected";
    return emptyResult(
      publishResult.error?.message ||
        "Falha ao publicar preços por quantidade percentuais.",
      publishCode,
      publishResult.status,
      publishResult.error,
      preview.tiers,
      preview.source,
    );
  }

  const verifyResult = await requester<any>(
    `/items/${encodeURIComponent(itemId)}/prices`,
    {
      method: "GET",
      headers: { "show-all-prices": "TRUE" },
    },
  );
  if (!verifyResult.ok) {
    return emptyResult(
      verifyResult.error?.message ||
        "Falha ao validar preços por quantidade após a publicação.",
      verifyResult.error?.code || "quantity_pricing_validation_failed",
      verifyResult.status,
      verifyResult.error,
      preview.tiers,
      preview.source,
    );
  }

  const tiersFound = extractQuantityPricingTiers(
    verifyResult.data,
    standardPrice.amount,
  );
  if (!quantityPricingTiersMatch(tiersFound, preview.tiers)) {
    return {
      ok: false,
      error: "Faixas percentuais não ficaram ativas após a publicação.",
      code: "quantity_pricing_not_effective",
      httpStatus: verifyResult.status,
      providerBody: verifyResult.data,
      recommendationSource: preview.source,
      tiersExpected: preview.tiers,
      tiersFound,
    };
  }

  return {
    ok: true,
    error: null,
    code: null,
    httpStatus: verifyResult.status,
    providerBody: verifyResult.data,
    recommendationSource: preview.source,
    tiersExpected: preview.tiers,
    tiersFound,
  };
}
