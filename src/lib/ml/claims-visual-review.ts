import { getSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import { classifyClaimPriority, type ClaimDetailResponse, type ClaimListItem } from '@/lib/ml/claims';

const ENABLED_KEY = 'bnt_d19_visual_review_enabled';
const DATA_KEY = 'bnt_d19_visual_review_claims';
const EXPECTED_SOURCE = 'official-contract-synthetic' as const;
const EXPECTED_VERSION = 1;

type ClaimsVisualReviewPayload = {
  version: number;
  source: string;
  capturedAt: string;
  expiresAt: string;
  items: ClaimListItem[];
  details: Record<string, ClaimDetailResponse>;
};

export type ClaimsVisualReview = {
  capturedAt: string;
  expiresAt: string;
  items: ClaimListItem[];
  details: Record<string, ClaimDetailResponse>;
};

function isEnabled(raw: string | null): boolean {
  if (!raw) return false;
  return ['true', '1', '"true"'].includes(raw.trim().toLowerCase());
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeFixtureItem(value: unknown): value is ClaimListItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as ClaimListItem;
  return item.is_homologation_fixture === true
    && /^9900\d{6,}$/.test(item.id)
    && /^2900\d{8,}$/.test(item.order_id)
    && (item.customer_name === null || item.customer_name.startsWith('Cliente homologação'))
    && Array.isArray(item.available_actions)
    && Array.isArray(item.related_entities);
}

function isSafeFixtureDetail(value: unknown, id: string): value is ClaimDetailResponse {
  if (!value || typeof value !== 'object') return false;
  const detail = value as ClaimDetailResponse;
  return detail.claim?.id === id
    && isSafeFixtureItem(detail.claim)
    && Array.isArray(detail.messages)
    && Array.isArray(detail.actions_history)
    && Array.isArray(detail.status_history)
    && Array.isArray(detail.unavailable_sections);
}

export async function loadClaimsVisualReview(): Promise<ClaimsVisualReview | null> {
  const enabled = await getSyncRuntimeConfigValue(ENABLED_KEY);
  if (!isEnabled(enabled)) return null;

  const raw = await getSyncRuntimeConfigValue(DATA_KEY);
  if (!raw) return null;

  let payload: ClaimsVisualReviewPayload;
  try {
    payload = JSON.parse(raw) as ClaimsVisualReviewPayload;
  } catch {
    return null;
  }

  if (
    payload.version !== EXPECTED_VERSION
    || payload.source !== EXPECTED_SOURCE
    || !isIsoDate(payload.capturedAt)
    || !isIsoDate(payload.expiresAt)
    || Date.parse(payload.expiresAt) <= Date.now()
    || !Array.isArray(payload.items)
    || payload.items.length === 0
    || payload.items.some((item) => !isSafeFixtureItem(item))
    || !payload.details
    || typeof payload.details !== 'object'
    || payload.items.some((item) => !isSafeFixtureDetail(payload.details[item.id], item.id))
  ) {
    return null;
  }

  const items = payload.items.map((item) => ({
    ...item,
    priority: classifyClaimPriority({
      status: item.status,
      responsible: item.action_responsible,
      dueDate: item.due_date,
    }),
  }));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const details = Object.fromEntries(Object.entries(payload.details).map(([id, detail]) => [
    id,
    { ...detail, claim: itemsById.get(id) || detail.claim },
  ]));

  return {
    capturedAt: payload.capturedAt,
    expiresAt: payload.expiresAt,
    items,
    details,
  };
}

export function visualReviewMeta(review: ClaimsVisualReview) {
  return {
    enabled: true as const,
    source: EXPECTED_SOURCE,
    captured_at: review.capturedAt,
    expires_at: review.expiresAt,
  };
}
