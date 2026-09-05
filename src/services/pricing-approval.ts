import { evaluateProductPricing, type MlQuoteContext } from './pricing-context';
import { fetchMLResult } from './integration';
import { resolveMlPricingGroup } from './ml-pricing-group';
import { getProtectedPricingExperimentSkus } from '../lib/ml/pricing-experiment';
import type { EconomicMemory } from './pricing.ts';
type Client = {
    from: (table: string) => any;
};
export const economicSignature = (m: EconomicMemory) => JSON.stringify({ price: m.price, cost: m.cost, offer: m.offerId, supplier: m.supplierId, fee: m.fee.amount, feeContext: m.fee.contextKey, shipping: m.shipping.amount, shippingContext: m.shipping.contextKey, variable: m.variableCosts.amount, tax: m.tax.rate, taxStatus: m.tax.status, month: m.tax.referenceMonth, policy: m.policyVersion });
export async function approvedStrategy(client: Client, id: string | undefined, productId: string, price: number, margin: number, itemId?: string) {
    if (!id || !itemId)
        return null;
    const result = await client.from('pricing_events').select('*').eq('id', id).eq('event_type', 'STRATEGY_REGISTERED').eq('produto_id', productId).eq('ml_item_id', itemId).maybeSingle();
    if (result.error || !result.data)
        return null;
    const strategy = result.data;
    if (Date.parse(strategy.payload.validUntil) <= Date.now() || price < strategy.payload.minimumPrice || margin < strategy.payload.minimumMargin)
        return null;
    return strategy;
}
/** Aprovação pertence ao preço e às entradas, nunca ao simples fato de uma edição ser manual. */
export async function verifyPricingApproval(client: Client, input: {
    approvalId: string;
    productId: string;
    itemId?: string;
    price: number;
    context?: MlQuoteContext;
}) {
    const { data: approval, error } = await client.from('pricing_events').select('*').eq('id', input.approvalId).eq('event_type', 'APPROVED').eq('produto_id', input.productId).maybeSingle();
    if (error || !approval || Number(approval.new_price) !== input.price || (approval.ml_item_id ?? null) !== (input.itemId ?? null))
        throw new Error('PRICING_APPROVAL_REQUIRED');
    const applied = await client.from('pricing_events').select('id').in('event_type', ['APPLIED', 'CREATED_READBACK']).contains('payload', { approvalId: input.approvalId }).limit(1);
    if (applied.error || applied.data?.length)
        throw new Error('APROVACAO_JA_UTILIZADA');
    const { data: baseline, error: baselineError } = await client.from('current_pricing_evaluations').select('memory').eq('id', approval.evaluation_id).maybeSingle();
    if (baselineError || !baseline)
        throw new Error('APROVACAO_ECONOMICA_DESATUALIZADA');
    const evaluation = await evaluateProductPricing(client, { productId: input.productId, itemId: input.itemId, price: input.price, context: input.context, requireLive: true });
    const m = evaluation.memory;
    if (!m || m.result === null || m.fee.source !== 'ml_live' || m.shipping.source !== 'ml_live')
        throw new Error('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
    if (economicSignature(m) !== economicSignature(baseline.memory))
        throw new Error('APROVACAO_ECONOMICA_DESATUALIZADA');
    if (m.margin! < m.band!.floor && !await approvedStrategy(client, approval.payload?.strategyId, input.productId, input.price, m.margin!, input.itemId))
        throw new Error('ESTRATEGIA_ABAIXO_DO_PISO_NAO_AUTORIZADA');
    if (m.status === 'estimated' && approval.payload?.acknowledgeEstimates !== true)
        throw new Error('PENDENCIA_VALIDACAO');
    let group: any = null;
    if (input.itemId) {
        if ((await getProtectedPricingExperimentSkus(client as any)).has(evaluation.product.sku))
            throw new Error('EXPERIMENTO_AUTORIZADO_EM_OBSERVACAO');
        const item = await fetchMLResult<any>(`/items/${encodeURIComponent(input.itemId)}`);
        const prices = await fetchMLResult<any>(`/items/${encodeURIComponent(input.itemId)}/prices`);
        if (!item.ok || !prices.ok)
            throw new Error('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
        if (approval.previous_price !== null && Number(item.data.price) !== Number(approval.previous_price))
            throw new Error('PRECO_ANTERIOR_ALTERADO');
        const rows = prices.data?.prices;
        if (!Array.isArray(rows) || rows.some((r: any) => r.type !== 'standard' || Number(r.conditions?.min_purchase_unit ?? 1) > 1 || r.conditions?.context_restrictions?.includes('user_type_business')))
            throw new Error('PRECOS_NATIVOS_PROMOCAO_OU_ATACADO_REQUEREM_REVISAO');
        group = await resolveMlPricingGroup(client, item.data);
        if (!group.complete)
            throw new Error('VINCULO_INCONCLUSIVO');
        for (const member of group.itemIds) {
            const linked = await client.from('anuncios_ml').select('produto_id').eq('ml_item_id', member).maybeSingle();
            if (linked.error || linked.data?.produto_id !== input.productId)
                throw new Error('GRUPO_ECONOMICO_DIVERGENTE');
            if (member !== input.itemId) {
                const sibling = await evaluateProductPricing(client, { productId: input.productId, itemId: member, price: input.price, requireLive: true, runtime: evaluation.runtime });
                if (!sibling.memory || sibling.memory.result === null || sibling.memory.margin! < sibling.memory.band!.floor)
                    throw new Error('ECONOMIA_DO_PAR_SINCRONIZADO_REQUER_REVISAO');
            }
        }
    }
    return { approval, evaluation, group };
}
