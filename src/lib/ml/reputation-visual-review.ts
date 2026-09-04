import { getSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import {
  getReputationThresholds,
  isReputationLevelId,
  type ReputationMetric,
  type SellerReputationResponse,
} from '@/lib/ml/seller-reputation';

const ENABLED_KEY = 'bnt_d18_visual_review_enabled';
const DATA_KEY = 'bnt_d18_visual_review_reputation';
const EXPECTED_SOURCE = 'official-contract-synthetic';
const EXPECTED_VERSION = 1;

type ReputationVisualReviewPayload = {
  version: number;
  source: string;
  capturedAt: string;
  expiresAt: string;
  response: SellerReputationResponse;
};

function isEnabled(raw: string | null) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === '"true"';
}

function isIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNullableFiniteNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isMetric(value: unknown): value is ReputationMetric {
  if (!value || typeof value !== 'object') return false;
  const metric = value as ReputationMetric;
  return isNullableFiniteNumber(metric.rate)
    && isNullableFiniteNumber(metric.percent)
    && isNullableFiniteNumber(metric.value)
    && (metric.period === null || typeof metric.period === 'string')
    && metric.excluded === null;
}

function isSafeResponse(value: unknown): value is SellerReputationResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as SellerReputationResponse;
  const user = response.user;
  const reputation = response.seller_reputation;
  const metrics = response.metrics;
  const transactions = response.transactions;

  return response.conectado === true
    && response.precisaReconectar === false
    && response.indisponivel === false
    && typeof user?.id === 'string'
    && user.id.startsWith('bnt-d18-')
    && typeof user.nickname === 'string'
    && user.permalink === null
    && user.site_id === 'MLB'
    && isReputationLevelId(reputation?.level_id)
    && reputation?.real_level === null
    && reputation?.protection_end_date === null
    && Boolean(metrics)
    && isMetric(metrics?.claims)
    && isMetric(metrics?.delayed_handling_time)
    && isMetric(metrics?.cancellations)
    && typeof metrics?.sales_completed === 'number'
    && metrics.sales_completed >= 0
    && typeof transactions?.total === 'number'
    && typeof transactions.completed === 'number'
    && typeof transactions.canceled === 'number';
}

export async function loadReputationVisualReview(): Promise<SellerReputationResponse | null> {
  const enabled = await getSyncRuntimeConfigValue(ENABLED_KEY);
  if (!isEnabled(enabled)) return null;

  const raw = await getSyncRuntimeConfigValue(DATA_KEY);
  if (!raw) return null;

  let payload: ReputationVisualReviewPayload;
  try {
    payload = JSON.parse(raw) as ReputationVisualReviewPayload;
  } catch {
    return null;
  }

  if (
    payload.version !== EXPECTED_VERSION
    || payload.source !== EXPECTED_SOURCE
    || !isIsoDate(payload.capturedAt)
    || !isIsoDate(payload.expiresAt)
    || Date.parse(payload.expiresAt) <= Date.now()
    || !isSafeResponse(payload.response)
  ) {
    return null;
  }

  return {
    ...payload.response,
    updated_at: payload.capturedAt,
    thresholds: getReputationThresholds(payload.response.user?.site_id),
    visual_review: {
      enabled: true,
      source: EXPECTED_SOURCE,
      captured_at: payload.capturedAt,
      expires_at: payload.expiresAt,
    },
  };
}
