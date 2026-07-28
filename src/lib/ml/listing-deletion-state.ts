export type MlItemState = {
  id?: string | null;
  status?: string | null;
  sub_status?: unknown;
};

function normalizeSubStatus(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

export function isMlListingDeleted(item: MlItemState | null | undefined): boolean {
  return normalizeSubStatus(item?.sub_status).includes('deleted');
}

export function isMlListingDeletionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = (payload as Record<string, unknown>).delete_listing;
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function isMlListingUnderReviewForbidden(item: MlItemState): boolean {
  return String(item.status || '').trim().toLowerCase() === 'under_review'
    && normalizeSubStatus(item.sub_status).includes('forbidden');
}
