import { commercialDiagnosis } from '../../services/pricing';
import { evaluateProductPricing, loadPricingRuntime, persistPricingEvaluation, recordPricingEvent } from '../../services/pricing-context';
import { resolveAutomaticPricingProductIds } from './automatic-pricing-selection';
import { getProtectedPricingExperimentSkus } from './pricing-experiment';

type ServiceClientLike = { from: (table: string) => any };
export type CostSnapshot = { productId: string; previous: { custo: number }; next: { custo: number } };
export type AutomaticPricingResult = { productsUpdated: number; outboxEnqueued: number; skipped: number; proposals?: number; errors: Array<{ productId: string; message: string }> };

/** M2M: eventos automáticos produzem propostas, sem alterar custom_price ou outbox. */
export async function enqueueAutomaticPricesForCostChanges(client: ServiceClientLike, snapshots: CostSnapshot[], options: { forceProductIds?: string[] } = {}): Promise<AutomaticPricingResult> {
  const result: AutomaticPricingResult = { productsUpdated: 0, outboxEnqueued: 0, skipped: 0, proposals: 0, errors: [] };
  const ids = resolveAutomaticPricingProductIds(snapshots, options.forceProductIds);
  if (!ids.length) return result;
  const runtime = await loadPricingRuntime(client);
  const protectedSkus = await getProtectedPricingExperimentSkus(client);
  for (const productId of ids) {
    try {
      const { data: product, error } = await client.from('produtos').select('id,sku,ativo,ml_item_id').eq('id', productId).single();
      if (error) throw new Error(error.message);
      if (!product.ativo || !product.ml_item_id || protectedSkus.has(product.sku)) { result.skipped++; continue; }
      const current = await evaluateProductPricing(client,{productId,itemId:product.ml_item_id,runtime,requireLive:true});
      if(!current.memory||current.memory.result===null)throw new Error('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
      const currentId=await persistPricingEvaluation(client,{...current,memory:current.memory,scenario:'current',itemId:product.ml_item_id});
      const listing=await client.from('anuncios_ml').select('vendidos,visitas').eq('ml_item_id',product.ml_item_id).maybeSingle();
      if(listing.error)throw new Error(listing.error.message);
      const diagnosis=commercialDiagnosis(current.memory,{sales:listing.data?.vendidos??null,visits:listing.data?.visitas??null,completeWindow:false});
      if(diagnosis==='MARGEM_PREMIUM_VALIDADA_PELO_MERCADO'){
        await recordPricingEvent(client,{event_type:'MAINTAIN',produto_id:productId,ml_item_id:product.ml_item_id,evaluation_id:currentId,pricing_source:'supplier_cost_change',actor:'job:automatic_pricing',reason:diagnosis,previous_price:current.memory.price,new_price:current.memory.price,rule_id:runtime.policy.version});
        result.skipped++;continue;
      }
      const evaluation = await evaluateProductPricing(client, { productId, itemId: product.ml_item_id, objective: 'target', runtime, requireLive: true });
      if (!evaluation.memory) throw new Error(evaluation.failure ?? 'ECONOMIA_INCONCLUSIVA');
      const evaluationId = await persistPricingEvaluation(client, { ...evaluation, memory: evaluation.memory, scenario: 'target', itemId: product.ml_item_id });
      await recordPricingEvent(client, {
        event_type: 'PROPOSED', produto_id: productId, ml_item_id: product.ml_item_id, evaluation_id: evaluationId,
        pricing_source: 'supplier_cost_change', actor: 'job:automatic_pricing', reason: 'Mudança de custo; aguarda aprovação',
        previous_price: evaluation.product.custom_price, new_price: evaluation.memory.price, rule_id: runtime.policy.version,
        dedupe_key: `cost:${productId}:${evaluation.offer?.updated_at}:${runtime.policy.version}`,
        payload: { autonomy: 'REQUIRES_CONFIRMATION', diagnostics: evaluation.memory.diagnostics },
      });
      result.proposals!++;
    } catch (error: any) { result.errors.push({ productId, message: error?.message ?? 'Falha no pricing' }); }
  }
  return result;
}
