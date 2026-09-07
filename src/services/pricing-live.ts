import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { EconomicInput, EconomicMarketQuote, EconomicResult } from '@/types/pricing';
import { fetchMLResult } from './integration';
import { evaluateEconomicMemory, projectQuotedEconomicPrice } from './pricing-economy';
import { evaluateProductPricing, loadPricingRequestContext, loadProductPricing, type ProductPricing, type PricingRequestContext } from './pricing-context';
import { marketContextKey, readMarketQuote, type MarketContext } from './pricing-market-quote';

type Base = Omit<EconomicInput, 'priceCents' | 'fee'>;
type Product = Database['public']['Tables']['produtos']['Row'];
type Client = SupabaseClient<Database>;

async function sources(client: Client, product: Product, requestContext: PricingRequestContext, context: MarketContext, price: number | null) {
  let captured: Base | undefined;
  const pricing = (await loadProductPricing(client, [product], { requestContext,
    evidence: new Map([[product.id, { mlItemId: context.itemId, currentPriceCents: price, marketContextKey: marketContextKey(context) }]]),
    shippingModes: new Map([[product.id, { mode: context.mode, mlItemId: context.itemId ?? '', observedAt: requestContext.evaluatedAt }]]),
    evaluate: (base, current, fee, observed) => { captured = base; return evaluateProductPricing(base, current, fee, observed); },
  })).get(product.id)!;
  if (!captured) throw new Error('Fonte econômica não encontrada');
  return { base: captured, pricing };
}

/** Assinatura material não muda por refresh sem alteração comercial. Não é autorização. */
function material(product: Product, base: Base, request: PricingRequestContext) {
  return JSON.stringify({ active: product.ativo, manual: product.fornecedor_preferencial_manual,
    preferred: product.oferta_preferencial_id, customPrice: product.custom_price, mlItemId: product.ml_item_id,
    dimensions: [product.altura, product.largura, product.profundidade, product.peso_bruto],
    cost: [base.cost.amountCents, base.cost.sourceId, base.cost.composition], context: base.context,
    eligible: base.offerEligible, tax: request.taxContext, commercial: request.commercial,
    operational: [...request.operational].sort() });
}

/** Consulta efêmera, nenhuma escrita de preço/configuração/outbox. */
export async function loadLiveProductPricing(client: Client, product: Product, context: MarketContext,
  priceCents: number | null, verifyMarket: () => Promise<boolean | null>): Promise<ProductPricing> {
  const request = await loadPricingRequestContext(client);
  const initial = await sources(client, product, request, context, priceCents);
  const key = marketContextKey(context);
  const cache = new Map<number, Promise<EconomicMarketQuote>>();
  let missingLive = false;
  const quote = (price: number) => {
    let pending = cache.get(price);
    if (!pending) {
      pending = readMarketQuote({ fetch: fetchMLResult, context, priceCents: price,
        fallbackRate: request.commercial.mlFeeFallbackRate, unspecifiedShippingCost: request.commercial.unspecifiedShippingCost })
        .then(result => { if (result.fee.source !== 'ml_live' || result.shipping.amountCents === null) missingLive = true; return result; });
      cache.set(price, pending);
    }
    return pending;
  };
  const failure = (code: 'CONTEXTO_ALTERADO' | 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL'): ProductPricing => {
    const reasons = [{ field: 'context' as const, code }];
    return { costCents: initial.pricing.costCents, currentPriceCents: priceCents,
      current: { status: 'inconclusive', memory: null, reasons },
      target: { ok: false, reasons }, floor: { ok: false, reasons }, breakEven: { ok: false, reasons },
      revalidation: { status: 'inconclusive', evaluatedAt: new Date().toISOString(), contextKey: key, code } };
  };
  if (!initial.base.offerEligible || initial.pricing.costCents === null) return { ...initial.pricing,
    revalidation: { status: 'inconclusive', evaluatedAt: request.evaluatedAt, contextKey: key, code: 'OFERTA_INELEGIVEL' } };
  let current: EconomicResult = initial.pricing.current;
  if (priceCents !== null) {
    const observed = await quote(priceCents);
    current = evaluateEconomicMemory({ ...initial.base, evaluatedAt: new Date().toISOString(),
      priceCents, fee: observed.fee, shipping: observed.shipping });
  }
  const { shipping: _shipping, ...base } = initial.base;
  const project = (objective: 'target' | 'floor' | 'break_even') => projectQuotedEconomicPrice({
    base, seedCents: priceCents ?? initial.pricing.costCents!, objective, quote });
  // Sequencial por objetivo: compartilha cotações e limita pressão no ML.
  const target = await project('target');
  const floor = await project('floor');
  const breakEven = await project('break_even');
  const fresh = await client.from('produtos').select('*').eq('id', product.id).maybeSingle();
  if (fresh.error) throw new Error('Falha ao revalidar o produto');
  if (!fresh.data) return failure('CONTEXTO_ALTERADO');
  const freshRequest = await loadPricingRequestContext(client);
  const next = await sources(client, fresh.data, freshRequest, context, priceCents);
  if (material(product, initial.base, request) !== material(fresh.data, next.base, freshRequest)) return failure('CONTEXTO_ALTERADO');
  const marketValid = await verifyMarket();
  if (marketValid === null) return failure('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  if (!marketValid) return failure('CONTEXTO_ALTERADO');
  if (missingLive) return failure('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  return { costCents: initial.pricing.costCents, currentPriceCents: priceCents, current, target, floor, breakEven,
    revalidation: { status: target.ok && floor.ok && breakEven.ok ? 'queried' : 'inconclusive',
      evaluatedAt: new Date().toISOString(), contextKey: key } };
}
