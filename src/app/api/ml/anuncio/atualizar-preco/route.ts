import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadPricingDetail } from '@/services/pricing-detail';
import { enqueueManualMlCommand, findManualMlCommand } from '@/services/pricing-dispatch';

const input = z.object({ operationId: z.string().uuid(), produtoId: z.string().uuid(),
  mlItemId: z.string().regex(/^MLB\d+$/), priceCents: z.number().int().positive().safe(),
  disableAutomaticPricing: z.boolean().optional() }).strict();

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Escolha o anúncio e informe um preço válido.' }, { status: 422 });
  const { operationId, ...detailInput } = parsed.data;
  try {
    const previous = await findManualMlCommand({ operationId, actorId: auth.userId,
      productId: detailInput.produtoId, kind: 'price_change', itemId: detailInput.mlItemId,
      priceCents: detailInput.priceCents });
    if (previous) return NextResponse.json({ success: true, ...previous }, { status: 202 });
    const response = await loadPricingDetail(detailInput, { actorId: auth.userId });
    if (!response.ok) return NextResponse.json({ error: 'Não foi possível conferir o anúncio. Atualize a página.' }, { status: 409 });
    const detail = await response.json();
    if (!detail.evaluationId || detail.decisionContext?.executable !== true)
      return NextResponse.json({ error: 'O anúncio ou o preço mudou. Atualize a página e confira novamente.' }, { status: 409 });
    const queued = await enqueueManualMlCommand(detail.evaluationId, operationId, auth.userId);
    return NextResponse.json({ success: true, ...queued }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Não foi possível confirmar a alteração. Confira o estado do anúncio antes de tentar novamente.' }, { status: 409 });
  }
}
