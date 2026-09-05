import { requireAdminUser } from '@/lib/auth/admin';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user)
        return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number(params.get('page')) || 1);
    const client = createServiceClient() as any;
    let query = client.from('radar_oportunidades').select('*', { count: 'exact' }).order('demand_rank').order('contribution', { ascending: false, nullsFirst: false }).order('stock', { ascending: false }).order('sku').range((page - 1) * 50, page * 50 - 1);
    if (params.get('queue'))
        query = query.eq('queue', params.get('queue'));
    const result = await query;
    if (result.error)
        return NextResponse.json({ error: result.error.message }, { status: 500 });
    const ids = [...new Set<string>(result.data.flatMap((r: any) => [r.evaluation_id, r.target_evaluation_id, r.floor_evaluation_id, r.break_even_evaluation_id]).filter(Boolean))];
    const evaluations = ids.length ? await client.from('pricing_evaluations').select('id,memory,valid_until').in('id', ids) : { data: [] };
    if (evaluations.error)
        return NextResponse.json({ error: evaluations.error.message }, { status: 500 });
    const current = ids.length ? await client.from('current_pricing_evaluations').select('id').in('id', ids) : { data: [] };
    if (current.error)
        return NextResponse.json({ error: current.error.message }, { status: 500 });
    const valid = new Set(current.data.map((e: any) => e.id));
    const byId = new Map(evaluations.data.map((e: any) => [e.id, { ...e, valid: valid.has(e.id) }]));
    return NextResponse.json({ rows: result.data.map((r: any) => ({ ...r, economics: byId.get(r.evaluation_id), target: byId.get(r.target_evaluation_id), floor: byId.get(r.floor_evaluation_id), breakEven: byId.get(r.break_even_evaluation_id) })), total: result.count, autonomy: 'AUTO_OBSERVE', publication: 'REQUIRES_CONFIRMATION' });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const response = await (createServiceClient() as any).rpc('review_radar_candidate', {p_id:body.id,p_expected_stage:body.expectedStage,p_stage:body.stage,p_actor:auth.user.id,p_reason:body.reason});
  if (response.error) return NextResponse.json({error:response.error.message},{status:409});
  return NextResponse.json({success:true,mlMutations:0});
}
