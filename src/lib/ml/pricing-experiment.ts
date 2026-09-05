import { unitResult, ceilMoney } from '../../services/pricing.ts';
import type { Database } from '@/types/database';

export const HIGH_MARGIN_PRICING_EXPERIMENT_ID = 'PRICING_EXPERIMENT_HIGH_MARGIN_ZERO_TRAFFIC_2026_09';
export const HIGH_MARGIN_PRICING_EXPERIMENT_CONFIG_KEY = 'pricing_experiment_high_margin_zero_traffic_2026_09';

export type PricingExperimentCheckpoint = 'D7' | 'D15' | 'D30';
export type PricingExperimentGroupStatus =
  | 'active'
  | 'paused_loss'
  | 'execution_failed'
  | 'awaiting_director_decision';

export type PricingExperimentCheckpointResult = {
  completed_at: string;
  visits: number;
  orders: number;
  price_confirmed: boolean;
  classification: string;
};

export type PricingExperimentGroup = {
  pricing_group_id: string;
  sku: string;
  product_id: string;
  ml_item_ids: string[];
  origin_ml_item_id: string;
  title: string;
  status: PricingExperimentGroupStatus;
  started_at: string;
  baseline_price: number;
  baseline_margin_pct: number;
  experimental_price: number;
  target_margin_pct: number;
  cost: number;
  fee_amount: number;
  shipping_amount: number;
  tax_rate: number;
  baseline_visits: Record<'30' | '90' | '150', number>;
  baseline_sales: Record<'30' | '90' | '150', number>;
  checkpoints?: Partial<Record<PricingExperimentCheckpoint, PricingExperimentCheckpointResult>>;
  stopped_at?: string | null;
  stop_reason?: string | null;
  safety_pause_attempts?: number;
  last_safety_checked_at?: string | null;
  latest_safety_result?: number | null;
  latest_cost?: number | null;
  latest_fee_amount?: number | null;
  latest_shipping_amount?: number | null;
};

export type PricingExperimentState = {
  version: 1;
  experiment_id: typeof HIGH_MARGIN_PRICING_EXPERIMENT_ID;
  status: 'executing' | 'active' | 'awaiting_director_decision' | 'closed';
  started_at: string;
  monitoring_until: string;
  traffic_threshold_150d: 5;
  tax_rate: number;
  groups: PricingExperimentGroup[];
  updated_at: string;
};

type ServiceClientLike = {
  from: (table: keyof Database['public']['Tables'] | string) => any;
};

function isState(value: unknown): value is PricingExperimentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<PricingExperimentState>;
  return row.version === 1
    && row.experiment_id === HIGH_MARGIN_PRICING_EXPERIMENT_ID
    && Array.isArray(row.groups);
}

export async function getHighMarginPricingExperiment(
  client: ServiceClientLike,
): Promise<PricingExperimentState | null> {
  const { data, error } = await client
    .from('sync_runtime_config')
    .select('value')
    .eq('key', HIGH_MARGIN_PRICING_EXPERIMENT_CONFIG_KEY)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler proteção do experimento de pricing: ${error.message}`);
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(String(data.value));
    if (!isState(parsed)) throw new Error('estrutura inválida');
    return parsed;
  } catch (error: any) {
    throw new Error(`Configuração inválida do experimento de pricing: ${error?.message || 'JSON inválido'}`);
  }
}

export async function saveHighMarginPricingExperiment(
  client: ServiceClientLike,
  state: PricingExperimentState,
): Promise<void> {
  const next = { ...state, updated_at: new Date().toISOString() };
  const { error } = await client.from('sync_runtime_config').upsert({
    key: HIGH_MARGIN_PRICING_EXPERIMENT_CONFIG_KEY,
    value: JSON.stringify(next),
    updated_at: next.updated_at,
  }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao salvar proteção do experimento de pricing: ${error.message}`);
}

export function activePricingExperimentSkus(state: PricingExperimentState | null): Set<string> {
  if (!state || state.status === 'closed') return new Set();
  return new Set(
    state.groups
      .filter((group) => group.status === 'active' || group.status === 'awaiting_director_decision')
      .map((group) => String(group.sku || '').trim().toUpperCase())
      .filter(Boolean),
  );
}

export function pricingExperimentUnitResult(input: {
  price: number;
  cost: number;
  feeAmount: number;
  shippingAmount: number;
  taxRate: number;
}): number | null {
  return unitResult({ revenue: input.price, cost: input.cost, fee: input.feeAmount,
    shipping: input.shippingAmount, variableCosts: 0, tax: ceilMoney(input.price * input.taxRate) });
}
