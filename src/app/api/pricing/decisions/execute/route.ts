import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { enqueueApprovedPricingDecision } from '@/services/pricing-dispatch';

const input = z.object({ decisionId: z.string().uuid(), operationId: z.string().uuid() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe somente a decisão e a operação.' }, 422);
  try {
    return json(await enqueueApprovedPricingDecision(parsed.data.decisionId, parsed.data.operationId, auth.userId), 202);
  } catch {
    return json({ error: 'Aplicação não confirmada. Confira a operação e a validade da aprovação. Execução permitida somente na conta de teste em DEV.' }, 409);
  }
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.read');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('operationId'));
  if (!id.success) return json({ error: 'Operação inválida' }, 422);
  const client = createServiceClient();
  const row = await client.from('pricing_operations').select('id,state,item_id,previous_price_cents,new_price_cents,requested_at')
    .eq('id', id.data).maybeSingle();
  if (row.error) return json({ error: 'Operação indisponível' }, 503);
  return row.data ? json(row.data) : json({ error: 'Operação não encontrada' }, 404);
}
