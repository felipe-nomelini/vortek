import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase';
import { verifyAgentPriceRequest } from '@/lib/ml/agent-price-auth';
import { loadPricingDetail } from '@/services/pricing-detail';
import { enqueueManualMlCommand, findManualMlCommand } from '@/services/pricing-dispatch';
import { requirePricingExecutionAccount } from '@/services/pricing-execution-access';

const uuid = z.string().uuid();
const command = z.object({ operationId: uuid, produtoId: uuid,
  mlItemId: z.string().regex(/^MLB\d+$/), priceCents: z.number().int().positive().safe(),
  checkOnly: z.boolean().optional() }).strict();
const noStore = { 'Cache-Control': 'no-store' };
const answer = (body: unknown, status: number) => NextResponse.json(body, { status, headers: noStore });

async function authenticatedActor() {
  const actorId = uuid.safeParse(process.env.ML_AGENT_PRICE_ACTOR_ID);
  if (!actorId.success) return null;
  const client = createServiceClient();
  const [account, profile] = await Promise.all([
    client.auth.admin.getUserById(actorId.data),
    client.from('profiles').select('id,cargo').eq('id', actorId.data).maybeSingle(),
  ]);
  const user = account.data.user;
  if (account.error || profile.error || !user || !profile.data
    || user.app_metadata?.bentevi_agent_scope !== 'ml_price_change'
    || !user.banned_until || Date.parse(user.banned_until) <= Date.now()
    || !['admin', 'gerente'].includes(profile.data.cargo)) return null;
  return { id: actorId.data, client };
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 4096) return answer({ error: 'Pedido inválido.' }, 413);
  const body = await request.text();
  if (body.length > 4096 || !verifyAgentPriceRequest(request, process.env.ML_AGENT_PRICE_SECRET, body))
    return answer({ error: 'Acesso não autorizado.' }, 401);
  let json: unknown;
  try { json = JSON.parse(body); }
  catch { return answer({ error: 'Pedido inválido.' }, 422); }
  const parsed = command.safeParse(json);
  if (!parsed.success) return answer({ error: 'Anúncio ou preço inválido.' }, 422);
  const actor = await authenticatedActor();
  if (!actor) return answer({ error: 'Acesso técnico indisponível.' }, 503);
  const { operationId, checkOnly, ...input } = parsed.data;
  try {
    await requirePricingExecutionAccount(undefined, 'price_change');
    if (!checkOnly) {
      const existing = await findManualMlCommand({ operationId, actorId: actor.id,
        productId: input.produtoId, kind: 'price_change', itemId: input.mlItemId,
        priceCents: input.priceCents });
      if (existing) return answer(existing, 202);
    }
    const response = await loadPricingDetail(input, {
      actorId: actor.id, requireNonDecreasingProfit: true,
    });
    if (!response.ok) return answer({ error: 'Não foi possível reavaliar o anúncio.' }, 409);
    const detail = await response.json();
    if (!detail.evaluationId || detail.decisionContext?.executable !== true
      || detail.decisionContext?.requireNonDecreasingProfit !== true)
      return answer({ error: 'Preço ou lucro mudou. Nenhuma alteração foi enviada.' }, 409);
    if (checkOnly) return answer({ operationId, itemId: input.mlItemId,
      currentPriceCents: detail.decisionContext.previousPriceCents,
      priceCents: input.priceCents,
      currentProfitCents: detail.pricing?.comparisons?.actual?.memory?.resultCents,
      proposedProfitCents: detail.pricing?.current?.memory?.resultCents }, 200);
    return answer(await enqueueManualMlCommand(detail.evaluationId, operationId, actor.id), 202);
  } catch {
    return answer({ error: 'Operação não concluída. Consulte o ID antes de tentar novamente.' }, 409);
  }
}

export async function GET(request: Request) {
  if (!verifyAgentPriceRequest(request, process.env.ML_AGENT_PRICE_SECRET))
    return answer({ error: 'Acesso não autorizado.' }, 401);
  const operationId = uuid.safeParse(new URL(request.url).searchParams.get('operationId'));
  if (!operationId.success) return answer({ error: 'Operação inválida.' }, 422);
  const actor = await authenticatedActor();
  if (!actor) return answer({ error: 'Acesso técnico indisponível.' }, 503);
  const operation = await actor.client.from('pricing_operations')
    .select('id,state,item_id,previous_price_cents,new_price_cents,actor_id,rule_id')
    .eq('id', operationId.data).maybeSingle();
  if (operation.error) return answer({ error: 'Estado indisponível.' }, 503);
  if (!operation.data || operation.data.actor_id !== actor.id || operation.data.rule_id !== 'MANUAL-ML')
    return answer({ error: 'Operação não encontrada.' }, 404);
  const delivery = await actor.client.from('anuncios_ml_outbox')
    .select('status').eq('pricing_operation_id', operationId.data).maybeSingle();
  if (delivery.error) return answer({ error: 'Estado indisponível.' }, 503);
  return answer({ operationId: operation.data.id, state: operation.data.state,
    itemId: operation.data.item_id, previousPriceCents: operation.data.previous_price_cents,
    priceCents: operation.data.new_price_cents, deliveryStatus: delivery.data?.status || null }, 200);
}
