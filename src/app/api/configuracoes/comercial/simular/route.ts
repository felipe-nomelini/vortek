import { NextResponse } from 'next/server';
import { commercialSimulationSchema, type CommercialSimulationDto } from '@/lib/configuracoes/contracts';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { loadPricingTaxContext } from '@/services/pricing-tax-context';
import { simulateProductPricing } from '@/services/pricing-context';

/** POST de leitura: não grava configuração, preço ou outbox. */
export async function POST(request: Request) {
  const auth = await createClient();
  const admin = await requireAdminUser(auth);
  if (!admin.ok) return admin.response;
  const parsed = commercialSimulationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: 'Parâmetros de simulação inválidos' }, { status: 422 });
  try {
    const evaluatedAt = new Date().toISOString();
    const taxContext = await loadPricingTaxContext(createServiceClient(), new Date(evaluatedAt));
    const pricing = simulateProductPricing({ ...parsed.data, evaluatedAt, taxContext });
    return NextResponse.json({ pricing, pricingTaxContext: taxContext } satisfies CommercialSimulationDto, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ erro: 'Não foi possível carregar o contexto fiscal da simulação' }, { status: 503 });
  }
}
