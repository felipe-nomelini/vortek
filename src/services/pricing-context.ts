import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { EconomicComponent, EconomicInput, EconomicProjectionResult, EconomicResult, EconomicTax } from '@/types/pricing';
import { evaluateEconomicMemory, projectEconomicPrice, calculateEconomicFeeCents } from './pricing-economy';
import { loadCommercialPricingConfiguration } from './commercial-pricing-configuration';
import { loadPricingTaxContext } from './pricing-tax-context';
import { resolvePreferredOfferForProduct } from '@/lib/preferred-offer';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';

type Client = SupabaseClient<Database>;
type Kit = { produto_id: string; ativo: boolean };
type KitComponent = { kit_produto_id: string; componente_produto_id: string; quantidade: number };
type Offer = Pick<Database['public']['Tables']['produto_fornecedor_ofertas']['Row'],
  'id' | 'produto_id' | 'dslite_fornecedor_id' | 'ativo' | 'estoque' | 'custo' | 'prioridade' | 'updated_at'>;
export type ProductPricing = {
  costCents: number | null;
  currentPriceCents: number | null;
  current: EconomicResult;
  target: EconomicProjectionResult;
  floor: EconomicProjectionResult;
  breakEven: EconomicProjectionResult;
  revalidation?: { status: 'queried' | 'inconclusive'; evaluatedAt: string; contextKey: string; code?: string };
};
export type PricingProduct = Pick<Database['public']['Tables']['produtos']['Row'],
  'id' | 'ativo' | 'oferta_preferencial_id' | 'fornecedor_preferencial_manual' | 'ml_item_id'
  | 'custom_price'>;

/** Um contexto por requisição: configurações, competência e relógio não variam entre páginas. */
export async function loadPricingRequestContext(client: Client, evaluatedAt = new Date().toISOString()) {
  const [commercial, taxContext, operational] = await Promise.all([
    loadCommercialPricingConfiguration(client), loadPricingTaxContext(client, new Date(evaluatedAt)),
    loadOperationalDropshippingSupplierIds(client),
  ]);
  return { commercial, taxContext, operational, evaluatedAt };
}
export type PricingRequestContext = Awaited<ReturnType<typeof loadPricingRequestContext>>;
export type ProductPricingEvidence = {
  mlItemId: string | null;
  currentPriceCents: number | null;
  marketContextKey: string;
  fee?: EconomicComponent;
  shipping?: EconomicComponent;
};

/** Prévia hipotética explícita; nunca fornece evidência operacional ou autorização. */
export function simulateProductPricing(input: {
  costCents: number | null; shippingCents: number | null; priceCents: number | null;
  feeRate: number; taxContext: PricingRequestContext['taxContext']; evaluatedAt: string;
}): ProductPricing {
  const marketContextKey = 'simulation';
  const component = { source: 'simulation' as const, sourceId: 'simulation.input',
    condition: 'estimated' as const, observedAt: input.evaluatedAt, expiresAt: null,
    basis: 'unit' as const, quantity: 1, marketContextKey, quotedPriceCents: null };
  return evaluateProductPricing({ scenario: 'simulation', evaluatedAt: input.evaluatedAt,
    context: { productId: null, offerId: null, supplierId: null, mlItemId: null, pricingGroupId: null,
      currency: 'BRL', unit: 'sale_unit', quantity: 1, referenceMonth: input.taxContext.referenceMonth, marketContextKey },
    offerEligible: false, cost: { ...component, amountCents: input.costCents },
    shipping: { ...component, amountCents: input.shippingCents },
    tax: { context: input.taxContext, observedAt: input.evaluatedAt, sourceId: 'get_pricing_monthly_revenue',
      coverage: 'unknown', confirmation: null, realizedAmountCents: null },
  }, input.priceCents, input.feeRate);
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Math.round(Number(value) * 100);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/** O DTO é uma projeção, não uma permissão para publicar ou sobrescrever preço. */
export function evaluateProductPricing(
  base: Omit<EconomicInput, 'priceCents' | 'fee'>,
  currentPriceCents: number | null,
  feeRate: number,
  observedFee?: EconomicComponent,
): ProductPricing {
  const feeModel = { source: 'fallback' as const, sourceId: 'configuracoes.pricing_ml_fee_fallback_rate',
    observedAt: base.evaluatedAt, expiresAt: null, rate: feeRate, fixedFeeCents: 0 };
  const fee: EconomicComponent = { amountCents: currentPriceCents === null ? null : calculateEconomicFeeCents(currentPriceCents, feeRate, 0),
    source: 'fallback', sourceId: feeModel.sourceId, condition: 'estimated', observedAt: base.evaluatedAt,
    expiresAt: null, basis: 'unit', quantity: base.context.quantity, marketContextKey: base.context.marketContextKey,
    quotedPriceCents: null };
  const { scenario, ...projectionBase } = base;
  const projectedBase = { ...projectionBase, scenario: scenario === 'simulation' ? 'simulation' as const : 'projected' as const };
  return {
    costCents: Number.isSafeInteger(base.cost.amountCents) && Number(base.cost.amountCents) >= 0 ? base.cost.amountCents : null,
    currentPriceCents: Number.isSafeInteger(currentPriceCents) && Number(currentPriceCents) > 0 ? currentPriceCents : null,
    current: currentPriceCents === null
      ? { status: 'inconclusive', memory: null, reasons: [{ field: 'input', code: 'DADO_AUSENTE' }] }
      : evaluateEconomicMemory({ ...base, priceCents: currentPriceCents, fee: observedFee ?? fee }),
    target: projectEconomicPrice({ base: projectedBase, feeModel, objective: 'target' }),
    floor: projectEconomicPrice({ base: projectedBase, feeModel, objective: 'floor' }),
    breakEven: projectEconomicPrice({ base: projectedBase, feeModel, objective: 'break_even' }),
  };
}

/** Carrega evidência em lotes; snapshots de produtos não substituem ofertas. Sem chamadas ao ML. */
export async function loadProductPricing(client: Client, products: readonly PricingProduct[], options: {
  /** Evidência já adquirida pelo chamador; texto de warning do produto não comprova modalidade. */
  shippingModes?: ReadonlyMap<string, { mode: string; mlItemId: string; observedAt: string }>;
  requestContext?: PricingRequestContext;
  evidence?: ReadonlyMap<string, ProductPricingEvidence>;
  taxEvidence?: Pick<EconomicTax, 'confirmation' | 'coverage'>;
  /** Reutiliza a fonte econômica sem duplicar seleção de oferta ou composição de kit. */
  evaluate?: (base: Omit<EconomicInput, 'priceCents' | 'fee'>, price: number | null,
    feeRate: number, observedFee?: EconomicComponent) => ProductPricing;
} = {}): Promise<Map<string, ProductPricing>> {
  const results = new Map<string, ProductPricing>();
  if (!products.length) return results;
  if (products.length > 100) throw new Error('A leitura econômica aceita lotes de até 100 produtos');
  const ids = products.map(p => p.id);
  const [{ commercial, taxContext, operational, evaluatedAt }, kits, components] = await Promise.all([
    options.requestContext ?? loadPricingRequestContext(client),
    client.from('produto_kits' as any).select('produto_id,ativo').in('produto_id', ids).returns<Kit[]>(),
    (async () => {
      const data: KitComponent[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await client.from('produto_kit_componentes' as any)
          .select('kit_produto_id,componente_produto_id,quantidade').in('kit_produto_id', ids)
          .order('kit_produto_id').order('componente_produto_id').range(offset, offset + 199).returns<KitComponent[]>();
        if (page.error) throw new Error('Falha ao carregar componentes econômicos');
        data.push(...page.data);
        if (page.data.length < 200) return { data, error: null };
      }
    })(),
  ]);
  if (kits.error || components.error) throw new Error('Falha ao carregar a composição econômica dos kits');
  const simpleComponents = (components.data || []).filter(c => components.data.filter(other => other.kit_produto_id === c.kit_produto_id).length === 1);
  const componentIds = [...new Set(simpleComponents.map(c => c.componente_produto_id))];
  const allIds = [...new Set([...ids, ...componentIds])];
  const [offers, componentProducts, nestedKits] = await Promise.all([
    (async () => {
      const rows: Offer[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await client.from('produto_fornecedor_ofertas')
          .select('id,produto_id,dslite_fornecedor_id,ativo,estoque,custo,prioridade,updated_at')
          .in('produto_id', allIds).order('id').range(offset, offset + 199);
        if (page.error) throw new Error('Falha ao carregar ofertas para a memória econômica');
        rows.push(...(page.data || []));
        if ((page.data || []).length < 200) return rows;
      }
    })(),
    componentIds.length ? client.from('produtos').select('id,ativo,oferta_preferencial_id,fornecedor_preferencial_manual').in('id', componentIds)
      : Promise.resolve({ data: [], error: null }),
    componentIds.length ? client.from('produto_kits' as any).select('produto_id').in('produto_id', componentIds).returns<Pick<Kit, 'produto_id'>[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (componentProducts.error || nestedKits.error) throw new Error('Falha ao carregar as fontes econômicas dos produtos');
  const eligibleOffers = offers.filter(o => o.ativo === true && operational.has(String(o.dslite_fornecedor_id)));
  for (const product of products) {
    const kit = kits.data?.find(k => k.produto_id === product.id);
    const composition = components.data?.filter(c => c.kit_produto_id === product.id) || [];
    const sourceProduct = kit ? componentProducts.data?.find(p => p.id === composition[0]?.componente_produto_id) : product;
    const validComposition = !kit || (kit.ativo === true && composition.length === 1 && sourceProduct?.ativo === true
      && !nestedKits.data?.some(k => k.produto_id === sourceProduct.id)
      && Number.isSafeInteger(composition[0].quantidade) && composition[0].quantidade > 0);
    const offer = sourceProduct && validComposition ? resolvePreferredOfferForProduct(
      eligibleOffers.filter(o => o.produto_id === sourceProduct.id), sourceProduct.oferta_preferencial_id,
      sourceProduct.fornecedor_preferencial_manual === true) : null;
    const quantity = kit ? Number(composition[0]?.quantidade) : 1;
    const unitCostCents = money(offer?.custo);
    const costCents = unitCostCents === null ? null : unitCostCents * quantity;
    const evidence = options.evidence?.get(product.id);
    const mlItemId = evidence?.mlItemId ?? product.ml_item_id;
    const marketContextKey = evidence?.marketContextKey ?? `product:${product.id}:unquoted`;
    const componentBase = { expiresAt: null, basis: 'unit' as const, quantity: 1, marketContextKey, quotedPriceCents: null };
    const cost: EconomicComponent = { ...componentBase, source: 'offer', sourceId: offer?.id || '',
      condition: offer ? 'known' : 'missing', amountCents: costCents, observedAt: offer?.updated_at || '',
      ...(kit && offer && sourceProduct && unitCostCents !== null ? { composition: {
        productId: sourceProduct.id, offerId: offer.id, supplierId: String(offer.dslite_fornecedor_id), quantity, unitCostCents,
      } } : {}) };
    // O fallback já homologado só cobre not_specified; timestamp do produto não é cotação de frete.
    const mode = options.shippingModes?.get(product.id);
    const unspecified = mode?.mode === 'not_specified' && mode.mlItemId === mlItemId
      && Number.isFinite(Date.parse(mode.observedAt)) && Date.parse(mode.observedAt) <= Date.parse(evaluatedAt);
    const shipping: EconomicComponent = { ...componentBase, source: 'fallback',
      sourceId: 'configuracoes.pricing_unspecified_shipping_cost', observedAt: evaluatedAt,
      condition: unspecified ? 'estimated' : 'missing', amountCents: unspecified ? money(commercial.unspecifiedShippingCost) : null };
    results.set(product.id, (options.evaluate ?? evaluateProductPricing)({ scenario: 'projected', evaluatedAt,
      context: { productId: product.id, offerId: kit ? null : offer?.id || null,
        supplierId: kit ? null : offer ? String(offer.dslite_fornecedor_id) : null,
        mlItemId, pricingGroupId: null, currency: 'BRL', unit: 'sale_unit', quantity: 1,
        referenceMonth: taxContext.referenceMonth, marketContextKey }, offerEligible: !!offer, cost,
      shipping: evidence?.shipping ?? shipping,
      tax: { context: taxContext, sourceId: 'get_pricing_monthly_revenue', observedAt: evaluatedAt,
        coverage: options.taxEvidence?.coverage ?? 'unknown', confirmation: options.taxEvidence?.confirmation ?? null, realizedAmountCents: null },
    }, evidence ? evidence.currentPriceCents : money(product.custom_price), commercial.mlFeeFallbackRate, evidence?.fee));
  }
  return results;
}
