import { createHash } from 'crypto';
import { PRICING_POLICY, validatePricingPolicy, type PricingPolicy } from './pricing-policy.ts';
import { buildPricingTaxContext, type PricingTaxContext } from './pricing-tax.ts';
import { evaluateEconomics, solveQuotedPrice, money, type EconomicAmount, type EconomicMemory, type PriceObjective } from './pricing.ts';
import { resolvePreferredOfferForProduct } from '../lib/preferred-offer.ts';
import { fetchMLResult } from './integration';
type Client = {
    from: (table: string) => any;
    rpc?: (...args: any[]) => any;
};
export type PricingRuntime = {
    policy: PricingPolicy;
    tax: PricingTaxContext;
    variableCosts: Record<string, number>;
};
export const unknownAmount = (): EconomicAmount => ({ amount: null, source: 'unknown', observedAt: null, evidence: null });
export const pricingFingerprint = (input: unknown): string => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const numberOrNull = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export async function loadPricingRuntime(client: Client, at = new Date().toISOString()): Promise<PricingRuntime> {
    const { data, error } = await client.from('configuracoes').select('pricing_policy,pricing_tax_config').maybeSingle();
    if (error)
        throw new Error(`CONFIGURACAO_PRICING_INDISPONIVEL: ${error.message}`);
    const policy = data?.pricing_policy ? validatePricingPolicy(data.pricing_policy) : PRICING_POLICY;
    const config = data?.pricing_tax_config ?? {};
    const referenceMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date(at));
    const monthlyRevenue: Array<{
        month: string;
        revenue: number;
    }> = [];
    if (config.activityStartDate) {
        const response = await client.rpc?.('pricing_monthly_revenue', { p_start: config.activityStartDate, p_reference: `${referenceMonth}-01` });
        if (response?.error)
            throw new Error(`RBT12_INDISPONIVEL: ${response.error.message}`);
        monthlyRevenue.push(...(response?.data ?? []));
    }
    return {
        policy,
        tax: buildPricingTaxContext({ activityStartDate: config.activityStartDate ?? '', referenceMonth, monthlyRevenue, observedAt: at, confirmed: config.confirmed }),
        variableCosts: config.variableCosts ?? {},
    };
}
export async function resolvePricingProduct(client: Client, productId: string) {
    const [productResponse, offersResponse, suppliersResponse] = await Promise.all([
        client.from('produtos').select('*').eq('id', productId).single(),
        client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', productId),
        client.from('fornecedores').select('dslite_id,ativo'),
    ]);
    for (const response of [productResponse, offersResponse, suppliersResponse])
        if (response.error)
            throw new Error(`OFERTA_INDISPONIVEL: ${response.error.message}`);
    const activeSuppliers = new Set((suppliersResponse.data ?? []).filter((s: any) => s.ativo === true).map((s: any) => String(s.dslite_id)));
    const offers = (offersResponse.data ?? []).map((o: any) => ({ ...o, ativo: o.ativo === true && activeSuppliers.has(String(o.dslite_fornecedor_id)) }));
    const product = productResponse.data;
    const offer = resolvePreferredOfferForProduct<any>(offers, product.oferta_preferencial_id, product.fornecedor_preferencial_manual === true);
    return { product, offer, offers };
}
export interface MlQuoteContext {
    sellerId: string;
    categoryId: string;
    listingType: string;
    shippingMode: string;
    logisticType: string;
    freeShipping: boolean;
    dimensions?: string;
    itemId?: string;
}
export function mlQuoteContext(item: any): MlQuoteContext | null {
    if (!item?.seller_id || !item.category_id || !item.listing_type_id || !item.shipping?.mode || !item.shipping?.logistic_type)
        return null;
    return { sellerId: String(item.seller_id), categoryId: item.category_id, listingType: item.listing_type_id, shippingMode: item.shipping.mode, logisticType: item.shipping.logistic_type, freeShipping: item.shipping.free_shipping === true, itemId: item.id };
}
export function extractTotalMlFee(payload: any, listingType: string): number | null {
    const rows: any[] = [];
    const visit = (v: any) => { if (Array.isArray(v))
        v.forEach(visit);
    else if (v && typeof v === 'object') {
        if ('sale_fee_amount' in v)
            rows.push(v);
        else
            Object.values(v).forEach(visit);
    } };
    visit(payload);
    return numberOrNull(rows.find(row => row.listing_type_id === listingType)?.sale_fee_amount);
}
export async function quoteMlEconomics(input: {
    price: number;
    product: any;
    offer: any;
    runtime: PricingRuntime;
    context: MlQuoteContext | null;
    evaluatedAt?: string;
    requireLive?: boolean;
    observedMemory?: EconomicMemory | null;
}): Promise<EconomicMemory> {
    const at = input.evaluatedAt ?? new Date().toISOString();
    let fee = unknownAmount();
    let shipping = unknownAmount();
    const ctx = input.context;
    if (ctx && (ctx.itemId || ctx.dimensions)) {
        const feeQuery = new URLSearchParams({ price: String(input.price), category_id: ctx.categoryId, currency_id: 'BRL', listing_type_id: ctx.listingType, logistic_type: ctx.logisticType, shipping_mode: ctx.shippingMode });
        const shippingQuery = new URLSearchParams({ item_price: String(input.price), listing_type_id: ctx.listingType, mode: ctx.shippingMode, logistic_type: ctx.logisticType, condition: 'new', free_shipping: String(ctx.freeShipping), verbose: 'true' });
        if (ctx.itemId)
            shippingQuery.set('item_id', ctx.itemId);
        else
            shippingQuery.set('dimensions', ctx.dimensions!);
        const feePath = `/sites/MLB/listing_prices?${feeQuery}`;
        const shippingPath = `/users/${encodeURIComponent(ctx.sellerId)}/shipping_options/free?${shippingQuery}`;
        const [fees, freight] = await Promise.all([fetchMLResult<any>(feePath), fetchMLResult<any>(shippingPath)]);
        const contextKey = pricingFingerprint({ ...ctx, price: input.price });
        const feeAmount = fees.ok ? extractTotalMlFee(fees.data, ctx.listingType) : null;
        const shippingAmount = freight.ok ? numberOrNull(freight.data?.coverage?.all_country?.list_cost) : null;
        if (feeAmount !== null)
            fee = { amount: feeAmount, source: 'ml_live', observedAt: at, evidence: feePath, contextKey };
        if (shippingAmount !== null)
            shipping = { amount: shippingAmount, source: 'ml_live', observedAt: at, evidence: shippingPath, contextKey };
    }
    if (!input.requireLive) {
        const observed = input.observedMemory;
        const expectedKey = ctx ? pricingFingerprint({ ...ctx, price: input.price }) : null;
        const validObserved = (value: EconomicAmount) => ['ml_live', 'ml_observed'].includes(value.source) && value.amount !== null && value.contextKey === expectedKey && value.observedAt && Date.parse(at) - Date.parse(value.observedAt) <= input.runtime.policy.evidenceMaxAgeHours * 3600000;
        if (observed?.price === input.price) {
            if (fee.amount === null && validObserved(observed.fee))
                fee = { ...observed.fee, source: 'ml_observed' };
            if (shipping.amount === null && validObserved(observed.shipping))
                shipping = { ...observed.shipping, source: 'ml_observed' };
        }
        if (fee.amount === null && input.runtime.policy.feeFallbackRate !== null)
            fee = { amount: money(input.price * input.runtime.policy.feeFallbackRate), source: 'fallback', observedAt: null, evidence: 'pricing_policy.feeFallbackRate' };
        const localShipping = numberOrNull(input.product.ml_shipping);
        if (shipping.amount === null && localShipping !== null)
            shipping = { amount: localShipping, source: 'local', observedAt: input.product.updated_at, evidence: 'produtos.ml_shipping' };
    }
    const variable = numberOrNull(input.runtime.variableCosts[input.product.id]);
    const memory = evaluateEconomics({ price: input.price, cost: numberOrNull(input.offer?.custo), offerId: input.offer?.id ?? null, supplierId: input.offer?.dslite_fornecedor_id ?? null, costObservedAt: input.offer?.updated_at ?? null, fee, shipping,
        variableCosts: variable === null ? unknownAmount() : { amount: variable, source: 'confirmed', observedAt: at, evidence: 'configuracoes.pricing_tax_config.variableCosts' }, tax: input.runtime.tax, evaluatedAt: at }, input.runtime.policy);
    if (input.requireLive && (fee.amount === null || shipping.amount === null))
        memory.reasons.unshift('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
    return memory;
}
export async function evaluateProductPricing(client: Client, input: {
    productId: string;
    price?: number;
    itemId?: string;
    context?: MlQuoteContext;
    objective?: PriceObjective;
    runtime?: PricingRuntime;
    requireLive?: boolean;
}) {
    const runtime = input.runtime ?? await loadPricingRuntime(client);
    const resolved = await resolvePricingProduct(client, input.productId);
    let context = input.context ?? null;
    let observedPrice = input.price;
    if (input.itemId) {
        const remote = await fetchMLResult<any>(`/items/${encodeURIComponent(input.itemId)}`);
        if (remote.ok) {
            context = mlQuoteContext(remote.data);
            observedPrice ??= numberOrNull(remote.data?.price) ?? undefined;
        }
    }
    let observedMemory: EconomicMemory | null = null;
    if (!input.requireLive) {
        let query = client.from('current_pricing_evaluations').select('memory').eq('produto_id', input.productId).order('evaluated_at', { ascending: false }).limit(1);
        query = input.itemId ? query.eq('ml_item_id', input.itemId) : query.is('ml_item_id', null);
        const observed = await query.maybeSingle();
        if (observed.error)
            throw new Error(observed.error.message);
        observedMemory = observed.data?.memory ?? null;
    }
    const at = new Date().toISOString();
    const quote = (price: number) => quoteMlEconomics({ ...resolved, price, runtime, context, evaluatedAt: at, requireLive: input.requireLive, observedMemory });
    if (input.objective) {
        const solution = await solveQuotedPrice({ cost: resolved.offer?.custo ?? NaN, taxRate: runtime.tax.rate ?? NaN, initialPrice: observedPrice ?? resolved.offer?.custo ?? 0, objective: input.objective, quote, policy: runtime.policy });
        return { ...resolved, runtime, context, memory: solution.ok ? solution.memory : null, failure: solution.ok ? null : solution.reason };
    }
    return { ...resolved, runtime, context, memory: await quote(observedPrice ?? 0), failure: null };
}
export async function persistPricingEvaluation(client: Client, input: {
    product: any;
    offer: any;
    memory: EconomicMemory;
    scenario: string;
    itemId?: string | null;
    groupId?: string | null;
    jobId?: string | null;
}): Promise<string> {
    const fingerprint = pricingFingerprint({ product: input.product.id, productVersion: input.product.updated_at, offerVersion: input.offer?.updated_at, scenario: input.scenario, itemId: input.itemId ?? null, memory: input.memory });
    const { data: existing, error: lookupError } = await client.from('pricing_evaluations').select('id').eq('fingerprint', fingerprint).maybeSingle();
    if (lookupError)
        throw new Error(lookupError.message);
    if (existing)
        return existing.id;
    const { data, error } = await client.from('pricing_evaluations').insert({ produto_id: input.product.id, ml_item_id: input.itemId ?? null, pricing_group_id: input.groupId ?? null, scenario: input.scenario, fingerprint, policy_version: input.memory.policyVersion, product_version: input.product.updated_at, offer_id: input.offer?.id ?? null, offer_version: input.offer?.updated_at ?? null, memory: input.memory, price: input.memory.price > 0 ? input.memory.price : null, result: input.memory.result, margin: input.memory.margin, status: input.memory.status, evaluated_at: input.memory.evaluatedAt, valid_until: new Date(Date.parse(input.memory.evaluatedAt) + 86400000).toISOString(), job_id: input.jobId ?? null }).select('id').single();
    if (error) {
        if (error.code === '23505') {
            const again = await client.from('pricing_evaluations').select('id').eq('fingerprint', fingerprint).single();
            if (again.data?.id)
                return again.data.id;
        }
        throw new Error(error.message);
    }
    return data.id;
}
export async function recordPricingEvent(client: Client, event: Record<string, unknown>) {
    const { error } = await client.from('pricing_events').insert(event);
    if (error && error.code !== '23505')
        throw new Error(`AUDITORIA_PRICING_INDISPONIVEL: ${error.message}`);
}
export async function resolveNewListingQuoteContext(product: any, categoryId: string, listingType: string): Promise<MlQuoteContext | null> {
    const me = await fetchMLResult<any>('/users/me');
    if (!me.ok || !me.data?.id)
        return null;
    const preferences = await fetchMLResult<any>(`/users/${me.data.id}/shipping_preferences`);
    const logistics = preferences.data?.logistics?.find((row: any) => row.mode === 'me2')?.types?.filter((row: any) => row.default && row.status === 'active') ?? [];
    const dimensions = [product.altura, product.largura, product.profundidade];
    if (!preferences.ok || logistics.length !== 1 || !dimensions.every(n => Number.isFinite(Number(n)) && Number(n) > 0) || !(Number(product.peso_bruto) > 0))
        return null;
    return { sellerId: String(me.data.id), categoryId, listingType, shippingMode: 'me2', logisticType: logistics[0].type, freeShipping: true,
        dimensions: dimensions.map(n => Math.ceil(Number(n))).join('x') + ',' + Math.ceil(Number(product.peso_bruto) * 1000) };
}
