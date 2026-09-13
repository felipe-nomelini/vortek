import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { loadPricingDetail } from '@/services/pricing-detail';
import { enqueueApprovedPricingDecision } from '@/services/pricing-dispatch';

const inputSchema = z.object({
  evaluationId: z.string().uuid(),
  prepareCommandId: z.string().uuid(),
  approveCommandId: z.string().uuid(),
  operationId: z.string().uuid(),
}).strict();

const AUTOMATIC_REASON = 'Alteração manual confirmada no Catálogo';
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Não foi possível identificar esta alteração.' }, 422);

  const client = createServiceClient();
  try {
    const evaluation = await client.from('pricing_evaluations')
      .select('id,produto_id,actor_id,result,created_at')
      .eq('id', parsed.data.evaluationId)
      .maybeSingle();
    if (evaluation.error || !evaluation.data) return json({ error: 'A análise de preço não foi encontrada.' }, 404);
    if (evaluation.data.actor_id !== auth.userId) return json({ error: 'Atualize a análise antes de confirmar.' }, 409);

    const context = (evaluation.data.result as any)?.decisionContext;
    if (!context?.executable || context.operationKind !== 'price_change' || !context.itemId || !context.priceCents) {
      return json({ error: 'Este preço não está liberado para alteração.' }, 409);
    }

    const prepared = await client.rpc('prepare_pricing_decision' as any, {
      p_command_id: parsed.data.prepareCommandId,
      p_evaluation_id: parsed.data.evaluationId,
      p_actor_id: auth.userId,
      p_reason: AUTOMATIC_REASON,
    });
    if (prepared.error || !prepared.data) throw new Error(prepared.error?.message || 'decision_prepare_failed');
    const decisionId = String(prepared.data);

    const freshResponse = await loadPricingDetail({
      produtoId: evaluation.data.produto_id,
      mlItemId: context.itemId,
      priceCents: Number(context.priceCents),
      ...(context.clearance ? { clearance: context.clearance } : {}),
    }, { actorId: auth.userId });
    if (!freshResponse.ok) return json({ error: 'Os dados mudaram. Atualize a análise antes de confirmar.' }, 409);
    const fresh = await freshResponse.json();
    if (!fresh?.evaluationId || fresh?.decisionContext?.executable !== true) {
      return json({ error: 'Os dados atuais não permitem esta alteração.' }, 409);
    }

    const approved = await client.rpc('manage_pricing_decision' as any, {
      p_id: decisionId,
      p_command_id: parsed.data.approveCommandId,
      p_actor_id: auth.userId,
      p_action: 'approve',
      p_reason: AUTOMATIC_REASON,
      p_fresh_evaluation_id: fresh.evaluationId,
      p_deferred_until: null,
    });
    if (approved.error) throw new Error(approved.error.message || 'decision_approve_failed');

    const queued = await enqueueApprovedPricingDecision(decisionId, parsed.data.operationId, auth.userId);
    return json({ ...queued, decisionId }, 202);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (/permission|not_allowed|not_ready|account_required/.test(code)) {
      return json({ error: 'Esta alteração não está liberada para o usuário ou ambiente atual.' }, 403);
    }
    if (/evaluation|decision_|group|governance/.test(code)) {
      return json({ error: 'Os dados mudaram. Atualize a análise antes de confirmar.' }, 409);
    }
    return json({ error: 'Não foi possível confirmar a alteração. Consulte o estado antes de tentar novamente.' }, 503);
  }
}
