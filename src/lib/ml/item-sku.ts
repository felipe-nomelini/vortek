function normalizeSku(value: unknown): string | null {
  const sku = String(value || '').trim().toUpperCase();
  return sku || null;
}

/**
 * Prioriza SELLER_SKU atual. seller_custom_field pode manter valor legado após migração de SKU.
 */
export function extractMlItemSku(item: any): string | null {
  const direct = normalizeSku(item?.seller_sku);
  if (direct) return direct;

  const attribute = Array.isArray(item?.attributes)
    ? item.attributes.find((row: any) => String(row?.id || '').toUpperCase() === 'SELLER_SKU')
    : null;
  const attributeSku = normalizeSku(attribute?.value_name || attribute?.value_id);
  if (attributeSku) return attributeSku;

  return normalizeSku(item?.seller_custom_field);
}
