import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { PRICING_POLICY } from '@/services/pricing-policy';
import { loadGroupStrategies, strategyIsCurrent } from '@/services/pricing-strategy';
import { resolveMlPricingGroup } from '@/services/ml-pricing-group';
import { fetchMLResult } from '@/services/integration';

export async function GET(request: Request) {
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  const productId = new URL(request.url).searchParams.get('productId');
  const client = createServiceClient();
  const rows = await (client as any).from('anuncios_ml').select('ml_item_id,pricing_group_id').eq('produto_id', productId!);
  if (rows.error) return NextResponse.json({error:rows.error.message},{status:500});
  const groups = [...new Set((rows.data ?? []).map((r:any) => r.pricing_group_id || `item:${r.ml_item_id}`))];
  const strategies = (await Promise.all(groups.map(g => loadGroupStrategies(client,String(g))))).flat();
  return NextResponse.json({groups,strategies});
}
export async function POST(request: Request) {
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => ({}));
  if (!b.reason?.trim() || !b.productId || !b.itemId) return NextResponse.json({error:'Produto, anúncio e motivo são obrigatórios'},{status:422});
  const client = createServiceClient();
  const link = await client.from('anuncios_ml').select('id').eq('produto_id',b.productId).eq('ml_item_id',b.itemId).maybeSingle();
  if (link.error || !link.data) return NextResponse.json({error:'Anúncio não vinculado ao produto'},{status:422});
  const item = await fetchMLResult<any>(`/items/${encodeURIComponent(b.itemId)}`);
  if (!item.ok) return NextResponse.json({error:'VINCULO_INCONCLUSIVO'},{status:409});
  const group = await resolveMlPricingGroup(client,item.data);
  if (!group.complete) return NextResponse.json({error:'VINCULO_INCONCLUSIVO'},{status:409});
  const members = await client.from('anuncios_ml').select('ml_item_id,produto_id').in('ml_item_id',group.itemIds);
  if(members.error || members.data?.length !== group.itemIds.length || members.data.some(r=>r.produto_id!==b.productId)) return NextResponse.json({error:'GRUPO_ECONOMICO_DIVERGENTE'},{status:409});
  const id = crypto.randomUUID();
  const recordStrategy = async (event: any) => { const result = await (client as any).rpc('register_commercial_strategy',{p_event:event}); if(result.error) throw new Error(result.error.message); };
  try {
  if (b.action === 'revoke') {
    const strategies = await loadGroupStrategies(client,group.groupId);
    if (!strategies.some((s:any) => s.id === b.strategyId)) return NextResponse.json({error:'Estratégia não vigente neste grupo'},{status:409});
    await recordStrategy({id,event_type:'STRATEGY_REVOKED',produto_id:b.productId,ml_item_id:b.itemId,pricing_group_id:group.groupId,pricing_source:'manual_strategy',actor:auth.user.id,reason:b.reason.trim(),rule_id:PRICING_POLICY.version,dedupe_key:`strategy-revoke:${b.strategyId}`,payload:{strategyId:b.strategyId}});
  } else {
    if (!['functional','clearance','manual_pricing_override'].includes(b.kind)) return NextResponse.json({error:'Estratégia inválida'},{status:422});
    const override = b.kind === 'manual_pricing_override';
    const payload = {kind:b.kind,untilRevoked:override || b.untilRevoked === true,validUntil:override || b.untilRevoked === true ? null : b.validUntil,minimumPrice:override ? null : b.minimumPrice,minimumMargin:override ? null : b.minimumMargin};
    if (!strategyIsCurrent(payload) || (!override && (!Number.isFinite(b.minimumPrice) || b.minimumPrice <= 0 || !Number.isFinite(b.minimumMargin) || b.minimumMargin >= 1))) return NextResponse.json({error:'Informe validade autorizada, preço e margem mínimos; ou autorização até revogação'},{status:422});
    const active = await loadGroupStrategies(client,group.groupId);
    if (active.some((s:any)=>s.payload.kind === b.kind)) return NextResponse.json({error:'Já existe estratégia deste tipo vigente no grupo; revogue antes de substituir'},{status:409});
    await recordStrategy({id,event_type:'STRATEGY_REGISTERED',produto_id:b.productId,ml_item_id:b.itemId,pricing_group_id:group.groupId,pricing_source:override?'manual_pricing_override':b.kind==='clearance'?'internal_stock_clearance':'authorized_strategy',actor:auth.user.id,reason:b.reason.trim(),rule_id:PRICING_POLICY.version,payload});
  }
  return NextResponse.json({strategyId:id,pricingGroupId:group.groupId,impact:'SEM_ALTERACAO_REMOTA_DE_PRECO'});
  } catch(error:any) { return NextResponse.json({error:error.message},{status:409}); }
}
