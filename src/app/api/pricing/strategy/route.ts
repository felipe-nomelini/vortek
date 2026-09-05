import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { recordPricingEvent } from '@/services/pricing-context';
export async function POST(request: Request) {
    const auth = await requireAdminUser(await createClient());
    if (!auth.ok)
        return auth.response;
    const b = await request.json().catch(() => ({}));
    const expiry = Date.parse(b.validUntil);
    if (!['functional', 'clearance'].includes(b.kind) || !b.reason?.trim() || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 30 * 86400000 || !Number.isFinite(b.minimumPrice) || b.minimumPrice <= 0 || !Number.isFinite(b.minimumMargin) || b.minimumMargin < -1 || b.minimumMargin >= 1)
        return NextResponse.json({ error: 'Estratégia exige razão, validade de até 30 dias, preço e margem mínimos explícitos' }, { status: 422 });
    const client = createServiceClient();
    const link = await client.from('anuncios_ml').select('id').eq('produto_id', b.productId).eq('ml_item_id', b.itemId).maybeSingle();
    if (link.error || !link.data)
        return NextResponse.json({ error: 'Estratégia requer anúncio existente vinculado' }, { status: 422 });
    const id = crypto.randomUUID();
    await recordPricingEvent(client, { id, event_type: 'STRATEGY_REGISTERED', produto_id: b.productId, ml_item_id: b.itemId, pricing_source: 'authorized_strategy', actor: auth.user.id, reason: b.reason.trim(), rule_id: 'M2M-PRC-01-v1', payload: { kind: b.kind, validUntil: new Date(expiry).toISOString(), minimumPrice: b.minimumPrice, minimumMargin: b.minimumMargin } });
    return NextResponse.json({ strategyId: id, impact: 'SIMULAR_E_APROVAR_PRECO_SEPARADAMENTE' });
}
