import 'server-only';
import { lookup } from 'node:dns/promises';
import { testPricingExecutionAllowed } from '@/lib/ml/pricing-execution';
import { fetchMLResult } from './integration';
import { resolveSupabaseServiceUrl } from '@/lib/supabase-url';

export async function assertPricingDevDestination() {
  const url = new URL(resolveSupabaseServiceUrl());
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => a.address !== '192.168.1.162'))
    throw new Error('pricing_dev_destination_required');
}

export function assertTestPricingAccount(account: unknown, sellerId: string) {
  if (!testPricingExecutionAllowed({
    mode: process.env.ML_PRICING_EXECUTION_MODE,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    allowedSellerIds: (process.env.ML_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    account, sellerId,
  })) throw new Error('pricing_test_execution_required');
}

export async function requireTestPricingAccount(sellerId?: string) {
  if (process.env.ML_PRICING_EXECUTION_MODE !== 'test_only') throw new Error('pricing_execution_not_ready');
  await assertPricingDevDestination();
  const me = await fetchMLResult<{ id: number; site_id: string; tags: string[] }>('/users/me');
  if (!me.ok || !me.data) throw new Error('pricing_test_account_unavailable');
  assertTestPricingAccount(me.data, sellerId ?? String(me.data.id));
  return String(me.data.id);
}

/** Verify the exact token used for the mutation. No refresh/retry after an uncertain effect. */
export function testPricingTransport(sellerId: string, beforeSend?: () => Promise<void>) {
  return {
    singleAttempt: true as const,
    async validateToken(token: string) {
      await assertPricingDevDestination();
      const response = await fetch('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('pricing_test_account_unavailable');
      assertTestPricingAccount(await response.json(), sellerId);
      if (beforeSend) await beforeSend();
    },
  };
}
