import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { processRadarBatch } from '@/services/opportunity-radar';
export const maxDuration = 300;
export async function POST(request: Request) {
    const key = request.headers.get('x-api-key');
    if (!key || key !== process.env.API_SECRET_KEY)
        return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.syncJobId)
        return NextResponse.json({ error: 'Job obrigatório' }, { status: 422 });
    const lock = await acquireDomainLock({ domain: 'radar:ml', ownerTask: 'sync_ml_radar', ownerJobId: body.syncJobId, ttlSeconds: 300 });
    if (!lock.acquired)
        return NextResponse.json({ code: 'domain_lock_conflict' }, { status: 409 });
    try {
        return NextResponse.json(await processRadarBatch(createServiceClient() as any, body.syncJobId, lock.ownerToken));
    }
    catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    finally {
        await releaseDomainLock({ domain: 'radar:ml', ownerToken: lock.ownerToken });
    }
}
