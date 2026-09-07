import type { EconomicComponent, EconomicMarketQuote } from '@/types/pricing';
import { calculateEconomicFeeCents } from './pricing-economy';

export type MarketContext = {
  sellerId: string; itemId: string | null; categoryId: string; catalogProductId: string | null; listingType: string;
  condition: string; mode: string; logisticType: string; freeShipping: boolean;
  dimensions: string | null; currency: 'BRL'; quantity: 1;
};
export type QuoteFetch = (path: string) => Promise<{ ok: boolean; data?: any }>;

export function marketContextKey(context: MarketContext) { return JSON.stringify(context); }

/** Ausência não vira zero; só montantes explícitos são aceitos. */
export function quoteMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const n = Math.round(value * 100);
  return Number.isSafeInteger(n) ? n : null;
}

export async function readMarketQuote(input: {
  fetch: QuoteFetch; context: MarketContext; priceCents: number;
  fallbackRate: number; unspecifiedShippingCost: number;
}): Promise<EconomicMarketQuote> {
  const { context: c, priceCents, fetch } = input;
  const key = marketContextKey(c);
  const component = (amount: number | null, sourceId: string, source: EconomicComponent['source'], estimated: boolean): EconomicComponent => ({
    amountCents: amount, sourceId, source, condition: amount === null ? 'missing' : estimated ? 'estimated' : 'known',
    observedAt: new Date().toISOString(), expiresAt: null, basis: 'unit', quantity: 1,
    marketContextKey: key, quotedPriceCents: source === 'ml_live' ? priceCents : null,
  });
  let shipping = component(null, 'ml.shipping_quote', 'ml_live', true);
  let billableWeight: number | null = null;
  if (c.mode === 'not_specified') {
    shipping = component(quoteMoney(input.unspecifiedShippingCost), 'configuracoes.pricing_unspecified_shipping_cost', 'fallback', true);
  } else if (c.itemId || c.dimensions) {
    const params = new URLSearchParams({ item_price: String(priceCents / 100), currency_id: 'BRL',
      category_id: c.categoryId, listing_type_id: c.listingType, mode: c.mode,
      logistic_type: c.logisticType, condition: c.condition, free_shipping: String(c.freeShipping), verbose: 'true' });
    if (c.dimensions) params.set('dimensions', c.dimensions);
    else if (c.itemId) params.set('item_id', c.itemId);
    const result = await fetch(`/users/${encodeURIComponent(c.sellerId)}/shipping_options/free?${params}`);
    const coverage = result.ok ? result.data?.coverage?.all_country : null;
    if (coverage?.currency_id === 'BRL') {
      shipping = component(quoteMoney(coverage.list_cost), 'ml.shipping_options.free.coverage.all_country', 'ml_live', true);
      billableWeight = Number.isSafeInteger(coverage.billable_weight) && coverage.billable_weight > 0 ? coverage.billable_weight : null;
    }
  }
  const params = new URLSearchParams({ price: String(priceCents / 100),
    ...(c.catalogProductId ? { catalog_product_id: c.catalogProductId } : { category_id: c.categoryId }),
    listing_type_id: c.listingType, currency_id: 'BRL', logistic_type: c.logisticType, shipping_mode: c.mode });
  if (billableWeight !== null) params.set('billable_weight', String(billableWeight));
  const result = await fetch(`/sites/MLB/listing_prices?${params}`);
  const rows = Array.isArray(result.data) ? result.data.flat() : result.data ? [result.data] : [];
  const matches = result.ok ? rows.filter(row => row?.listing_type_id === c.listingType && row?.currency_id === 'BRL') : [];
  const row = matches.length === 1 ? matches[0] : null;
  const amount = quoteMoney(row?.sale_fee_amount);
  const percent = row?.sale_fee_details?.percentage_fee;
  const rate = typeof percent === 'number' && percent >= 0 && percent < 100 ? percent / 100 : null;
  const fixed = quoteMoney(row?.sale_fee_details?.fixed_fee);
  if (amount !== null) return { fee: component(amount, 'ml.listing_prices.sale_fee_amount', 'ml_live', false),
    shipping, feeRate: rate, fixedFeeCents: fixed };
  return { fee: component(calculateEconomicFeeCents(priceCents, input.fallbackRate, 0),
    'configuracoes.pricing_ml_fee_fallback_rate', 'fallback', true), shipping,
    feeRate: input.fallbackRate, fixedFeeCents: 0 };
}
