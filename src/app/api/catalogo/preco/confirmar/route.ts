import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadPricingDetail } from '@/services/pricing-detail';
import { enqueueManualMlCommand, findManualMlCommand } from '@/services/pricing-dispatch';

const input = z.object({ operationId: z.string().uuid(), produtoId: z.string().uuid(),
  mlItemId: z.string().regex(/^MLB\d+$/), priceCents: z.number().int().positive().safe(),
  disableAutomaticPricing: z.boolean().optional() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Escolha o anúncio e informe um preço válido.' }, 422);
  const { operationId, ...detailInput } = parsed.data;
  try {
    const previous = await findManualMlCommand({ operationId, actorId: auth.userId,
      productId: detailInput.produtoId, kind: 'price_change', itemId: detailInput.mlItemId,
      priceCents: detailInput.priceCents });
    if (previous) return json(previous, 202);
    const response = await loadPricingDetail(detailInput, { actorId: auth.userId });
    if (!response.ok) return json({ error: 'Os dados mudaram. Confira o anúncio novamente.' }, 409);
    const detail = await response.json();
    if (!detail.evaluationId || detail.decisionContext?.executable !== true)
      return json({ error: 'O anúncio ou o preço mudou. Confira novamente.' }, 409);
    return json(await enqueueManualMlCommand(detail.evaluationId, operationId, auth.userId), 202);
  } catch {
    return json({ error: 'Não foi possível confirmar a alteração. Consulte o estado do anúncio antes de tentar novamente.' }, 409);
  }
}
