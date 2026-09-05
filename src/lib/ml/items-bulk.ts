export const ML_ITEMS_BULK_MAX_IDS = 20;

export type MlItemsBulkRow<T = Record<string, unknown>> = {
  id?: string | number | null;
  status_code?: number | null;
  body?: T | null;
};

function normalizeValues(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function buildMlItemsBulkPath(itemIds: string[], attributes: string[] = []) {
  const normalizedIds = normalizeValues(itemIds);
  if (!normalizedIds.length) throw new Error('ml_items_bulk_ids_required');
  if (normalizedIds.length > ML_ITEMS_BULK_MAX_IDS) throw new Error('ml_items_bulk_max_20_ids');

  const normalizedAttributes = normalizeValues(
    attributes.map((attribute) => attribute.replace(/^body\./, '')),
  ).filter((attribute) => attribute !== 'id');
  const idsParam = normalizedIds.map(encodeURIComponent).join(',');
  const attributesParam = normalizedAttributes
    .map((attribute) => encodeURIComponent(`body.${attribute}`))
    .join(',');

  return `/items/bulk?ids=${idsParam}${attributesParam ? `&attributes=${attributesParam}` : ''}`;
}

export function getMlItemsBulkBody<T extends Record<string, unknown>>(
  row: MlItemsBulkRow<T> | null | undefined,
): (T & { id: string }) | null {
  const id = String(row?.id || '').trim();
  if (row?.status_code !== 200 || !id || !row.body || typeof row.body !== 'object') return null;
  return { ...row.body, id };
}
