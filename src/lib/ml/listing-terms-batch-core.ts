export const ML_UNDER_70_THRESHOLD = 70;
export const ML_CLASSIC_LISTING_TYPE = 'gold_special';

export type MlListingTermsItem = {
  id?: string | null;
  status?: string | null;
  sub_status?: unknown;
  price?: unknown;
  listing_type_id?: string | null;
  shipping?: { free_shipping?: boolean | null } | null;
  tags?: unknown;
  title?: string | null;
  sold_quantity?: unknown;
  available_quantity?: unknown;
  user_product_id?: string | null;
  catalog_product_id?: string | null;
  catalog_listing?: boolean | null;
  last_updated?: string | null;
};

export type MlListingTermsClassification = {
  target: boolean;
  needsListingType: boolean;
  needsBuyerPaidShipping: boolean;
  blockedByMandatoryFreeShipping: boolean;
  reason:
    | 'target'
    | 'already_compliant'
    | 'not_active'
    | 'price_not_positive'
    | 'price_not_below_threshold'
    | 'mandatory_free_shipping';
};

function normalizedTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

export function isMlListingDeletedForBatch(item: MlListingTermsItem): boolean {
  return Array.isArray(item.sub_status)
    && item.sub_status.some((entry) => String(entry || '').trim().toLowerCase() === 'deleted');
}

export function classifyMlListingUnder70(
  item: MlListingTermsItem,
  threshold = ML_UNDER_70_THRESHOLD,
): MlListingTermsClassification {
  if (String(item.status || '').trim().toLowerCase() !== 'active') {
    return {
      target: false,
      needsListingType: false,
      needsBuyerPaidShipping: false,
      blockedByMandatoryFreeShipping: false,
      reason: 'not_active',
    };
  }

  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      target: false,
      needsListingType: false,
      needsBuyerPaidShipping: false,
      blockedByMandatoryFreeShipping: false,
      reason: 'price_not_positive',
    };
  }
  if (price >= threshold) {
    return {
      target: false,
      needsListingType: false,
      needsBuyerPaidShipping: false,
      blockedByMandatoryFreeShipping: false,
      reason: 'price_not_below_threshold',
    };
  }

  const needsListingType = String(item.listing_type_id || '').trim() !== ML_CLASSIC_LISTING_TYPE;
  const needsBuyerPaidShipping = item.shipping?.free_shipping !== false;
  const blockedByMandatoryFreeShipping = normalizedTags(item.tags).includes('mandatory_free_shipping');
  if (blockedByMandatoryFreeShipping && needsBuyerPaidShipping) {
    return {
      target: true,
      needsListingType,
      needsBuyerPaidShipping,
      blockedByMandatoryFreeShipping,
      reason: 'mandatory_free_shipping',
    };
  }

  return {
    target: true,
    needsListingType,
    needsBuyerPaidShipping,
    blockedByMandatoryFreeShipping: false,
    reason: needsListingType || needsBuyerPaidShipping ? 'target' : 'already_compliant',
  };
}

export function batchManifestState(item: MlListingTermsItem) {
  return {
    id: String(item.id || '').trim(),
    status: String(item.status || '').trim().toLowerCase(),
    sub_status: Array.isArray(item.sub_status)
      ? item.sub_status.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean).sort()
      : [],
    price: Number.isFinite(Number(item.price)) ? Math.round(Number(item.price) * 100) / 100 : null,
    listing_type_id: String(item.listing_type_id || '').trim() || null,
    free_shipping: typeof item.shipping?.free_shipping === 'boolean' ? item.shipping.free_shipping : null,
    title: String(item.title || '').trim() || null,
    sold_quantity: Number.isFinite(Number(item.sold_quantity)) ? Number(item.sold_quantity) : null,
    available_quantity: Number.isFinite(Number(item.available_quantity)) ? Number(item.available_quantity) : null,
    user_product_id: String(item.user_product_id || '').trim() || null,
    catalog_product_id: String(item.catalog_product_id || '').trim() || null,
    catalog_listing: item.catalog_listing === true,
    last_updated: String(item.last_updated || '').trim() || null,
  };
}

export function preservesUntouchedListingFields(before: MlListingTermsItem, after: MlListingTermsItem): boolean {
  return Number(before.price) === Number(after.price)
    && Number(before.available_quantity) === Number(after.available_quantity)
    && String(before.title || '').trim() === String(after.title || '').trim();
}

export function hasActiveMixedPriceGroup(items: MlListingTermsItem[], threshold = ML_UNDER_70_THRESHOLD): boolean {
  const activePrices = items
    .filter((item) => String(item.status || '').trim().toLowerCase() === 'active')
    .map((item) => Number(item.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  return activePrices.some((price) => price < threshold)
    && activePrices.some((price) => price >= threshold);
}
