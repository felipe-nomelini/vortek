import { approvedStrategy } from '@/services/pricing-approval';
import { fetchMLResult } from '@/services/integration';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { recordPricingEvent } from '@/services/pricing-context';
export async function POST(request: Request) {
    const auth = await requireAdminUser(await createClient());
    if (!auth.ok)
        return auth.response;
    const body = await request.json().catch(() => ({}));
    if (!body.evaluationId || typeof body.reason !== 'string' || !body.reason.trim())
        return NextResponse.json({ error: 'Avaliação e razão obrigatórias' }, { status: 422 });
    const client = createServiceClient();
    const { data: evaluation, error } = await (client as any).from('current_pricing_evaluations').select('*').eq('id', body.evaluationId).maybeSingle();
    if (error || !evaluation || evaluation.memory.result === null)
        return NextResponse.json({ error: 'Avaliação indisponível ou desatualizada' }, { status: 409 });
    if (evaluation.memory.margin < evaluation.memory.band.floor && !await approvedStrategy(client, body.strategyId, evaluation.produto_id, evaluation.price, evaluation.margin, evaluation.ml_item_id))
        return NextResponse.json({ error: 'Preço abaixo do piso exige estratégia registrada separadamente' }, { status: 422 });
    if (evaluation.memory.status === 'estimated' && body.acknowledgeEstimates !== true)
        return NextResponse.json({ error: 'Revisar e reconhecer estimativas e custos não informados', reasons: evaluation.memory.reasons }, { status: 422 });
    const live = evaluation.ml_item_id ? await fetchMLResult<any>(`/items/${encodeURIComponent(evaluation.ml_item_id)}`) : null;
    if (live && !live.ok)
        return NextResponse.json({ error: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' }, { status: 409 });
    const id = crypto.randomUUID();
    await recordPricingEvent(client, { id, event_type: 'APPROVED', produto_id: evaluation.produto_id, ml_item_id: evaluation.ml_item_id,
        pricing_group_id: evaluation.pricing_group_id, evaluation_id: evaluation.id, pricing_source: 'manual_approval', actor: auth.user.id,
        reason: body.reason.trim(), previous_price: live?.data?.price ?? null, new_price: evaluation.price, rule_id: evaluation.policy_version,
        payload: { strategyId: body.strategyId ?? null, acknowledgeEstimates: body.acknowledgeEstimates === true, reasons: evaluation.memory.reasons, autonomy: 'REQUIRES_CONFIRMATION' } });
    return NextResponse.json({ success: true, approvalId: id, evaluationId: evaluation.id, price: evaluation.price });
}
