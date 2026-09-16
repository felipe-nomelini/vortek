import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';
import { preparePublication, publicationInputSchema } from '@/services/publication-preparation';
import { configuredPricingExecutionCapability } from '@/services/pricing-execution-access';
import { fetchMLResult } from '@/services/integration';

export const maxDuration = 300;

const relistInputSchema = z.object({
  action: z.literal('relist'), produtoId: z.string().uuid(), sourceItemId: z.string().regex(/^MLB\d+$/),
  priceCents: z.number().int().positive().safe(),
}).strict();

async function resolvePublicationInput(raw: unknown) {
  const shortcut = relistInputSchema.safeParse(raw);
  if (!shortcut.success) return publicationInputSchema.safeParse(raw);
  const source = await fetchMLResult<any>('/items/' + encodeURIComponent(shortcut.data.sourceItemId) + '?include_attributes=all');
  const item = source.data;
  if (!source.ok || item?.id !== shortcut.data.sourceItemId || item.status !== 'closed'
    || !Number.isSafeInteger(Math.round(Number(item.price) * 100))
    || Math.round(Number(item.price) * 100) !== shortcut.data.priceCents)
    throw new Error('publication_relist_source_invalid');
  const values = (rows: unknown) => Array.isArray(rows) ? rows.map(row => ({
    id: row?.id, ...(row?.value_id ? { value_id: String(row.value_id) } : {}),
    ...(row?.value_name ? { value_name: String(row.value_name) } : {}),
  })) : [];
  return publicationInputSchema.safeParse({ ...shortcut.data,
    categoriaId: item.category_id, listingType: item.listing_type_id,
    attributes: values(item.attributes), sale_terms: values(item.sale_terms),
    shipping: { mode: item.shipping?.mode, logisticType: item.shipping?.logistic_type,
      freeShipping: item.shipping?.free_shipping },
  });
}

// This route prepares an immutable proposal. Only the approved-operation worker POSTs /items.
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  if (!configuredPricingExecutionCapability().allowedOperations.includes('listing_create'))
    return NextResponse.json(getPricingExecutionBlock(), { status: 409 });
  try {
    const input = await resolvePublicationInput(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Preparação inválida. Preço, logística e evidências precisam estar explícitos.' }, { status: 422 });
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
