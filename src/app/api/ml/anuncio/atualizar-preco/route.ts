import { resolveMlPricingGroup } from '@/services/ml-pricing-group';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { verifyPricingApproval } from '@/services/pricing-approval';
import { persistPricingEvaluation, recordPricingEvent } from '@/services/pricing-context';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { fetchMLResult } from '@/services/integration';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';

export async function POST(request: Request) {
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!body.produtoId || !body.mlItemId || !body.approvalId || !Number.isFinite(body.targetPrice) || body.targetPrice <= 0) return NextResponse.json({ error: 'Simule e aprove o preço antes de aplicar', code: 'PRICING_APPROVAL_REQUIRED' }, { status: 422 });
  const client = createServiceClient();
  const { data: listing, error } = await (client as any).from('anuncios_ml').select('*').eq('produto_id',body.produtoId).eq('ml_item_id',body.mlItemId).maybeSingle();
  if (error || !listing) return NextResponse.json({ error: 'Vínculo do anúncio inconclusivo' }, { status: 422 });
  const groupItem = await fetchMLResult<any>(`/items/${encodeURIComponent(body.mlItemId)}`);
  if (!groupItem.ok) return NextResponse.json({error:'INCONCLUSIVO_FONTE_ML_INDISPONIVEL'}, {status:409});
  const initialGroup = await resolveMlPricingGroup(client,groupItem.data);
  if (!initialGroup.complete) return NextResponse.json({error:'VINCULO_INCONCLUSIVO'}, {status:409});
  const groupId = initialGroup.groupId;
  const domain = `pricing:${groupId}`;
  const lock = await acquireDomainLock({ domain, ownerTask: 'manual_pricing', ttlSeconds: 300 });
  if (!lock.acquired) return NextResponse.json({ error: 'Grupo com alteração em andamento' }, { status: 409 });
  try {
    const { approval, evaluation, group } = await verifyPricingApproval(client, { approvalId: body.approvalId, productId: body.produtoId, itemId: body.mlItemId, price: body.targetPrice });
    if (group?.groupId !== groupId) throw new Error('GRUPO_ALTERADO_DURANTE_APROVACAO');
    const live = await fetchMLResult<any>(`/items/${encodeURIComponent(body.mlItemId)}`);
    if (!live.ok || !['active','paused'].includes(live.data?.status)) throw new Error('ESTADO_ML_INDISPONIVEL');
    const previousPrice = Number(live.data.price);
    await recordPricingEvent(client, { event_type:'APPLY_REQUESTED', produto_id:body.produtoId,ml_item_id:body.mlItemId,pricing_group_id:groupId,evaluation_id:approval.evaluation_id,pricing_source:'manual',actor:auth.user.id,reason:approval.reason,previous_price:previousPrice,new_price:body.targetPrice,rule_id:evaluation.runtime.policy.version,dedupe_key:`apply:${approval.id}`,payload:{approvalId:approval.id} });
    const response = previousPrice === body.targetPrice ? live : await fetchMLResult<any>(`/items/${encodeURIComponent(body.mlItemId)}`, { method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({price:body.targetPrice}) });
    const readback = response.ok ? await fetchMLResult<any>(`/items/${encodeURIComponent(body.mlItemId)}`) : response;
    const confirmed = response.ok && readback.ok && Number(readback.data?.price) === body.targetPrice;
    await recordPricingEvent(client, { event_type:confirmed?'APPLIED':'APPLY_INCONCLUSIVE',produto_id:body.produtoId,ml_item_id:body.mlItemId,pricing_group_id:groupId,evaluation_id:approval.evaluation_id,pricing_source:'manual',actor:auth.user.id,reason:approval.reason,previous_price:previousPrice,new_price:body.targetPrice,rule_id:evaluation.runtime.policy.version,payload:{approvalId:approval.id,remoteStatus:readback.status} });
    if (!confirmed) return NextResponse.json({ success:false,error:'Alteração não confirmada; conferir estado remoto antes de nova tentativa' },{status:502});
    for (const member of group?.itemIds ?? []) {
      if (member === body.mlItemId) continue;
      const remote = await fetchMLResult<any>(`/items/${encodeURIComponent(member)}`);
      if (!remote.ok || Number(remote.data.price)!==body.targetPrice) throw new Error('PAR_SINCRONIZADO_NAO_CONFIRMADO: conferir grupo antes de nova alteração');
      const memberReconcile = await reconcileAnuncioMlFromItem(client,remote.data,'publish_reconcile');
      if (!memberReconcile.ok) throw new Error('RECONCILIACAO_DO_GRUPO_PENDENTE');
    }
    const reconciled = await reconcileAnuncioMlFromItem(client,readback.data,'publish_reconcile');
    if (!reconciled.ok) throw new Error('Preço remoto confirmado; reconciliação local pendente');
    const saved = await client.from('produtos').update({custom_price:body.targetPrice}).eq('id',body.produtoId).select('*').single();
    if (saved.error) throw new Error('Preço remoto confirmado; persistência local pendente');
    await persistPricingEvaluation(client,{...evaluation,product:saved.data,memory:evaluation.memory!,scenario:'current',itemId:body.mlItemId,groupId});
    return NextResponse.json({success:true,price_updated:true,queued_publish:false,basePrice:body.targetPrice,message:'Preço aprovado e confirmado no Mercado Livre.'});
  } catch (error: any) { return NextResponse.json({success:false,error:error.message},{status:409}); }
  finally { await releaseDomainLock({domain,ownerToken:lock.ownerToken}); }
}
