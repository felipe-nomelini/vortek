import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { loadPricingTaxContext } from '@/services/pricing-tax-context';
import { simulateProductPricing } from '@/services/pricing-context';

const inputSchema = z.object({
  costCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  shippingCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  feeRate: z.number().finite().min(0).lt(1),
  priceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();

/** POST de leitura: não grava configuração, preço ou outbox. */
export async function POST(request: Request) {
  const auth = await createClient();
  const admin = await requireAdminUser(auth);
  if (!admin.ok) return admin.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: 'Parâmetros de simulação inválidos' }, { status: 422 });
  try {
    const evaluatedAt = new Date().toISOString();
    const taxContext = await loadPricingTaxContext(createServiceClient(), new Date(evaluatedAt));
    const pricing = simulateProductPricing({ ...parsed.data, evaluatedAt, taxContext });
    return NextResponse.json({ pricing, pricingTaxContext: taxContext }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ erro: 'Não foi possível carregar o contexto fiscal da simulação' }, { status: 503 });
  }
}
