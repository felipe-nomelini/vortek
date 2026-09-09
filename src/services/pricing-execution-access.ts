import 'server-only';
import { lookup } from 'node:dns/promises';
import { getPricingExecutionCapability, pricingExecutionAllowed } from '@/lib/ml/pricing-execution';
import { fetchMLResult } from './integration';
import { resolveSupabaseServiceUrl } from '@/lib/supabase-url';

const configuredSellerIds = () => (process.env.ML_ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

export function configuredPricingExecutionCapability() {
  return getPricingExecutionCapability({
    mode: process.env.ML_PRICING_EXECUTION_MODE,
    runtimeEnvironment: process.env.VORTEK_RUNTIME_ENVIRONMENT,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    allowedSellerIds: configuredSellerIds(),
  });
}

export async function assertPricingExecutionDestination() {
  const url = new URL(resolveSupabaseServiceUrl());
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => a.address !== '192.168.1.162'))
    throw new Error('pricing_execution_destination_required');
}

export function assertPricingExecutionAccount(account: unknown, sellerId: string) {
  if (!pricingExecutionAllowed({
    mode: process.env.ML_PRICING_EXECUTION_MODE,
    runtimeEnvironment: process.env.VORTEK_RUNTIME_ENVIRONMENT,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    allowedSellerIds: configuredSellerIds(),
    account, sellerId,
  })) throw new Error('pricing_execution_account_required');
}

export async function requirePricingExecutionAccount(sellerId?: string) {
  const capability = configuredPricingExecutionCapability();
  if (!capability.enabled) throw new Error('pricing_execution_not_ready');
  await assertPricingExecutionDestination();
  const me = await fetchMLResult<{ id: number; site_id: string; tags: string[] }>('/users/me');
  if (!me.ok || !me.data) throw new Error('pricing_execution_account_unavailable');
  const expectedSellerId = sellerId ?? String(me.data.id);
  assertPricingExecutionAccount(me.data, expectedSellerId);
  return { sellerId: String(me.data.id), capability };
}

/** Verify the exact token used for the mutation. No refresh/retry after an uncertain effect. */
export function pricingExecutionTransport(sellerId: string, beforeSend?: () => Promise<void>) {
  return {
    singleAttempt: true as const,
    async validateToken(token: string) {
      if (!configuredPricingExecutionCapability().enabled) throw new Error('pricing_execution_not_ready');
      await assertPricingExecutionDestination();
      const response = await fetch('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('pricing_execution_account_unavailable');
      assertPricingExecutionAccount(await response.json(), sellerId);
      if (beforeSend) await beforeSend();
    },
  };
}
