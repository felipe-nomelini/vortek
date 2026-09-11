import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';
import { preparePublication, publicationInputSchema } from '@/services/publication-preparation';
import { configuredPricingExecutionCapability } from '@/services/pricing-execution-access';

export const maxDuration = 300;

// This route prepares an immutable proposal. Only the approved-operation worker POSTs /items.
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  if (!configuredPricingExecutionCapability().allowedOperations.includes('listing_create'))
    return NextResponse.json(getPricingExecutionBlock(), { status: 409 });
  const input = publicationInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Preparação inválida. Preço, logística e evidências precisam estar explícitos.' }, { status: 422 });
  try {
    const prepared = await preparePublication(input.data, auth.userId);
    const client = createServiceClient();
    const decision = await client.rpc('prepare_pricing_decision', {
      p_command_id: randomUUID(), p_evaluation_id: prepared.evaluationId, p_actor_id: auth.userId,
      p_reason: 'Preparação de um novo anúncio para confirmação humana',
    });
    if (decision.error || !decision.data) throw new Error('publication_decision_persistence_failed');
    const row = await client.from('pricing_decisions').select('alert_id').eq('id', decision.data).single();
    if (row.error || !row.data) throw new Error('publication_decision_persistence_failed');
    return NextResponse.json({ success: true, prepared: true, evaluationId: prepared.evaluationId,
      decisionId: decision.data, alertId: row.data.alert_id, pricing: prepared.pricing,
      expiresAt: prepared.decisionContext.expiresAt, priceCents: prepared.decisionContext.priceCents,
      quantity: prepared.preparation.capacity, execution: 'requires_confirmation' },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error && /^(publication|warranty|pricing)_[a-z_]+$/.test(error.message) ? error.message : 'publication_preparation_failed';
    return NextResponse.json({ code, error: 'Preparação não concluída: ' + code + '. Nenhum anúncio foi criado.' }, { status: 409 });
  }
}
