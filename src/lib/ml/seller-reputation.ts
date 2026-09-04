export const REPUTATION_LEVEL_IDS = [
  '1_red',
  '2_orange',
  '3_yellow',
  '4_light_green',
  '4_light_blue',
  '5_green',
] as const;

export type ReputationLevelId = (typeof REPUTATION_LEVEL_IDS)[number];
export type ReputationMetricKey = 'claims' | 'delayed_handling_time' | 'cancellations';
export type ReputationBand = 'leaders' | 'green' | 'yellow' | 'orange' | 'red' | 'unknown';

export type ReputationMetricThresholds = {
  leaders: number;
  green: number;
  yellow: number;
  orange: number;
};

export type ReputationThresholdSet = {
  site_id: 'MLB';
  unit: 'percent';
  metrics: Record<ReputationMetricKey, ReputationMetricThresholds>;
};

export type ReputationMetric = {
  rate: number | null;
  percent: number | null;
  value: number | null;
  period: string | null;
  excluded: {
    real_value: number | null;
    real_rate: number | null;
    real_percent: number | null;
  } | null;
};

export type SellerReputationResponse = {
  conectado: boolean;
  precisaReconectar: boolean;
  indisponivel?: boolean;
  erro?: string;
  updated_at?: string;
  user?: {
    id: number | string;
    nickname: string | null;
    permalink: string | null;
    registration_date: string | null;
    site_id: string | null;
  };
  seller_reputation?: {
    level_id: ReputationLevelId | null;
    power_seller_status: string | null;
    real_level: ReputationLevelId | null;
    protection_end_date: string | null;
  };
  transactions?: {
    total: number;
    completed: number;
    canceled: number;
    period: string | null;
    ratings: {
      positive: number | null;
      neutral: number | null;
      negative: number | null;
    };
  };
  metrics?: {
    claims: ReputationMetric;
    delayed_handling_time: ReputationMetric;
    cancellations: ReputationMetric;
    sales_completed: number | null;
    period: string | null;
  };
  thresholds?: ReputationThresholdSet | null;
  visual_review?: {
    enabled: true;
    source: 'official-contract-synthetic';
    captured_at: string;
    expires_at: string;
  };
};

const MLB_THRESHOLDS: ReputationThresholdSet = {
  site_id: 'MLB',
  unit: 'percent',
  metrics: {
    claims: { leaders: 1, green: 2, yellow: 4.5, orange: 8 },
    cancellations: { leaders: 0.5, green: 1.5, yellow: 3.5, orange: 4 },
    delayed_handling_time: { leaders: 6, green: 10, yellow: 18, orange: 22 },
  },
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeReputationMetric(raw: unknown): ReputationMetric {
  const metric = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const excludedRaw = metric.excluded && typeof metric.excluded === 'object'
    ? metric.excluded as Record<string, unknown>
    : null;
  const rate = finiteNumber(metric.rate);
  const realRate = finiteNumber(excludedRaw?.real_rate);

  return {
    rate,
    percent: rate === null ? null : rate * 100,
    value: finiteNumber(metric.value),
    period: typeof metric.period === 'string' && metric.period.trim()
      ? metric.period.trim()
      : null,
    excluded: excludedRaw
      ? {
          real_value: finiteNumber(excludedRaw.real_value),
          real_rate: realRate,
          real_percent: realRate === null ? null : realRate * 100,
        }
      : null,
  };
}

export function getReputationThresholds(siteId: string | null | undefined): ReputationThresholdSet | null {
  return siteId === 'MLB' ? MLB_THRESHOLDS : null;
}

export function classifyReputationMetric(
  percent: number | null | undefined,
  thresholds: ReputationMetricThresholds | null | undefined,
): ReputationBand {
  if (percent === null || percent === undefined || !Number.isFinite(percent) || !thresholds) {
    return 'unknown';
  }
  if (percent <= thresholds.leaders) return 'leaders';
  if (percent <= thresholds.green) return 'green';
  if (percent <= thresholds.yellow) return 'yellow';
  if (percent <= thresholds.orange) return 'orange';
  return 'red';
}

export function isReputationLevelId(value: unknown): value is ReputationLevelId {
  return typeof value === 'string' && (REPUTATION_LEVEL_IDS as readonly string[]).includes(value);
}
