import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { evaluateProductPricing, persistPricingEvaluation, resolveNewListingQuoteContext, resolvePricingProduct } from '@/services/pricing-context';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user)
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.productId !== 'string' || (body.price !== undefined && (!Number.isFinite(body.price) || body.price <= 0)))
        return NextResponse.json({ error: 'Entradas inválidas' }, { status: 422 });
    const client = createServiceClient();
    try {
        if (body.itemId) {
            const link = await client.from('anuncios_ml').select('produto_id').eq('ml_item_id', body.itemId).eq('produto_id', body.productId).maybeSingle();
            if (link.error || !link.data)
                return NextResponse.json({ error: 'Vínculo do anúncio inconclusivo' }, { status: 422 });
        }
        let context;
        if (!body.itemId && body.categoryId && body.listingType) {
            const resolved = await resolvePricingProduct(client, body.productId);
            context = await resolveNewListingQuoteContext(resolved.product, String(body.categoryId), String(body.listingType)) ?? undefined;
        }
        const objective = ['target', 'floor', 'break_even'].includes(body.objective) ? body.objective : body.price === undefined ? 'target' : undefined;
        const evaluation = await evaluateProductPricing(client, { productId: body.productId, price: body.price, itemId: body.itemId, context, objective, requireLive: true });
        if (!evaluation.memory)
            return NextResponse.json({ success: false, status: 'INCONCLUSIVO', reason: evaluation.failure }, { status: 422 });
        const evaluationId = await persistPricingEvaluation(client, { ...evaluation, memory: evaluation.memory, scenario: objective ?? 'manual', itemId: body.itemId });
        return NextResponse.json({ success: true, evaluationId, memory: evaluation.memory, autonomy: 'REQUIRES_CONFIRMATION' });
    }
    catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 422 });
    }
}
