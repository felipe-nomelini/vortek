import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { enqueuePricingReanalysis, runPricingReanalysisJob } from '@/services/pricing-reanalysis';

const input = z.object({ productId: z.string().uuid(), commandId: z.string().uuid() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

/** Atualiza vínculo e diagnóstico de um produto. Não prepara proposta nem escreve no ML. */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe somente o produto e o identificador do comando.' }, 422);
  try {
    const queued = await enqueuePricingReanalysis({
      productId: parsed.data.productId,
      commandId: parsed.data.commandId,
      actorId: auth.userId,
      source: 'manual',
    });
    const result = await runPricingReanalysisJob(queued.jobId, { force: true });
    if (result.state === 'completo') return json({ success: true, ...result, replayed: queued.replayed || result.replayed });
    if (result.state === 'pendente' || result.state === 'rodando' || result.state === 'on_hold')
      return json({ success: false, ...result, replayed: queued.replayed || result.replayed }, 202);
    return json({ ...result, error: 'A reanálise não foi concluída. Nenhuma alteração foi enviada ao Mercado Livre.' }, 503);
  } catch {
    return json({ error: 'Não foi possível registrar a reanálise.' }, 503);
  }
}
