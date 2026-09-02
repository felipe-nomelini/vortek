export const ML_DYNAMIC_STANDARD_PRICE_TAG = 'dynamic_standard_price';

export function hasMlAutomaticPrice(item: unknown) {
  const tags = Array.isArray((item as { tags?: unknown[] } | null)?.tags)
    ? (item as { tags: unknown[] }).tags
    : [];
  return tags.some((tag) => String(tag || '').trim().toLowerCase() === ML_DYNAMIC_STANDARD_PRICE_TAG);
}
