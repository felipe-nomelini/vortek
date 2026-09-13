import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { loadLiveProductPricing } from '@/services/pricing-live';
import { recordPricingEvaluation } from '@/services/pricing-audit';
import { decisionContext, syncPricingAlerts } from '@/services/pricing-decisions';
import { loadPricingOverrides, type PricingProtection } from '@/services/pricing-overrides';
import { assessCompetitivePricing, competitionEvidence } from '@/services/pricing-competition';
import { pricingMaterialFingerprint } from '@/services/pricing-audit';
import { loadPricingClearances } from '@/services/pricing-clearances';
import { classifyCommercialConflicts } from '@/services/commercial-conflicts';
import { quoteMoney, type MarketContext } from '@/services/pricing-market-quote';
import { pricingView } from '@/lib/pricing-view';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { extractQuantityPricingTiers, serializeQuantityPricingTiers } from '@/lib/ml/quantity-pricing';
import { hasMlAutomaticPrice, ML_DYNAMIC_STANDARD_PRICE_TAG } from '@/lib/ml/item-price-policy';
import { normalizeBuyBoxStatus, normalizePriceToWin, resolveCatalogCompetitionStatus } from '@/lib/catalogo/no-catalogo';
import { assessMlProductIdentity, loadMlIdentityKit } from '@/lib/ml-critical-attributes';
import { hasConfirmedMlExistingListingIdentityConflict, isMlExistingListingIdentitySafe } from '@/lib/ml-listing-identity';
import { classifyMlPublishEligibility } from '@/lib/ml/operational-listing';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { getCategoryAttributes } from './mercadolibre';

const contextSchema = z.object({
  categoryId: z.string().regex(/^MLB\d+$/), listingType: z.enum(['gold_special', 'gold_pro']),
  catalogProductId: z.string().regex(/^MLB\d+$/).nullable().optional(),
  condition: z.enum(['new', 'used', 'not_specified']), mode: z.enum(['me2', 'not_specified']),
  logisticType: z.string().trim().min(1).max(60), freeShipping: z.boolean(),
}).strict();
const inputSchema = z.object({
  produtoId: z.string().min(1).max(100),
  mlItemId: z.string().regex(/^MLB\d+$/).optional(),
  priceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  context: contextSchema.optional(),
  clearance: z.object({ id: z.string().uuid(), quantity: z.number().int().positive().max(2147483647),
    fulfillmentSource: z.literal('internal') }).strict().optional(),
}).strict();
// Um item existente preserva o tipo observado, inclusive Gratuito; não o converte em Clássico.
const observedContextSchema = contextSchema.extend({ listingType: z.enum(['free', 'gold_special', 'gold_pro']) });
type Input = z.infer<typeof inputSchema>;
export type PricingListingValidation = {
  state: 'verified' | 'pending' | 'conflict' | 'ineligible' | 'unavailable';
  anchor: 'product' | 'homogeneous_kit_component' | null;
  reasons: string[];
  items: Array<{
    itemId: string;
    state: 'verified' | 'pending' | 'conflict' | 'ineligible' | 'unavailable';
    anchor: 'product' | 'homogeneous_kit_component' | null;
    reasons: string[];
    comparisons: Array<{ field: string; local: string | null; remote: string | null; status: string; reason: string }>;
  }>;
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const EXISTING_LISTING_DIAGNOSTIC_FIELDS = new Set([
  'SELLER_SKU', 'GTIN', 'BRAND', 'MODEL', 'MPN', 'PART_NUMBER',
  'SALE_FORMAT', 'UNITS_PER_PACK', 'PACKS_NUMBER', 'PACKAGES_NUMBER', 'PACKAGING_BOXES_NUMBER',
]);

function dimensions(product: any): string | null {
  const values = [product.altura, product.largura, product.profundidade, product.peso_bruto].map(Number);
  if (!values.every(v => Number.isFinite(v) && v > 0)) return null;
  return values.slice(0, 3).join('x') + ',' + Math.ceil(values[3] * 1000);
}
function itemContext(item: any, sellerId: string): MarketContext | null {
  if (!item || !item.id) return null;
  const parsed = observedContextSchema.safeParse({ categoryId: item.category_id, listingType: item.listing_type_id,
    condition: item.condition, mode: item.shipping?.mode, logisticType: item.shipping?.logistic_type,
    freeShipping: item.shipping?.free_shipping });
  if (!parsed.success || item.currency_id !== 'BRL' || String(item.seller_id) !== sellerId) return null;
  // No anúncio existente, o ML resolve as dimensões do próprio item, não um snapshot local.
  return { ...parsed.data, sellerId, itemId: item.id, catalogProductId: /^MLB\d+$/.test(item.catalog_product_id) ? item.catalog_product_id : null,
    dimensions: null, currency: 'BRL', quantity: 1 };
}

/** A API do ML não garante a ordem de coleções como tags entre duas leituras. */
function listingMaterialSnapshot(context: MarketContext | null, item: any): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(normalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalize(entry)]));
  };
  return JSON.stringify(normalize({ context, price: item?.price ?? null, tags: item?.tags ?? [], shipping: item?.shipping ?? null }));
}

async function preparationValid(context: z.infer<typeof contextSchema>, sellerId: string): Promise<boolean | null> {
  const [category, seller, shipping, catalogProduct] = await Promise.all([
    fetchMLResult<any>('/categories/' + encodeURIComponent(context.categoryId)),
    fetchMLResult<any>('/users/' + encodeURIComponent(sellerId) + '/shipping_preferences'),
    fetchMLResult<any>('/categories/' + encodeURIComponent(context.categoryId) + '/shipping_preferences'),
    context.catalogProductId
      ? fetchMLResult<any>('/products/' + encodeURIComponent(context.catalogProductId))
      : Promise.resolve(null),
  ]);
  if (!category.ok || !seller.ok || !shipping.ok || (catalogProduct && !catalogProduct.ok)) return null;
  return category.data?.id === context.categoryId && Array.isArray(category.data?.children_categories)
    && category.data.children_categories.length === 0 && category.data?.settings?.listing_allowed === true
    && Array.isArray(seller.data?.logistics) && seller.data.logistics.some((row: any) => row.mode === context.mode
      && Array.isArray(row.types) && row.types.some((type: any) => type.type === context.logisticType))
    && Array.isArray(shipping.data?.logistics) && shipping.data.logistics.some((row: any) => row.mode === context.mode
      && Array.isArray(row.types) && row.types.includes(context.logisticType))
    && (!catalogProduct || (catalogProduct.data?.id === context.catalogProductId
      && String(catalogProduct.data?.status || '').toLowerCase() === 'active'
      && (!catalogProduct.data?.category_id || catalogProduct.data.category_id === context.categoryId)
      && (!Array.isArray(catalogProduct.data?.children_ids) || catalogProduct.data.children_ids.length === 0)));
}

export async function loadPricingDetail(raw: unknown, worker?: { actorId: string | null; competitionItemId?: string | null }) {
  // Internal worker identity is never parsed from the HTTP body.
  const user = worker ? { id: worker.actorId } : (await (await createClient()).auth.getUser()).data.user;
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Contexto de cotação inválido' }, 422);
  const input: Input = parsed.data;
  const review = await loadBntD07VisualReview();
  if (input.produtoId.startsWith('bnt-d07-review-') || review?.items.some(row =>
    String(row.product.id) === input.produtoId || row.mlListings?.some(item => item.itemId === input.mlItemId))) {
    return json({ error: 'Amostra protegida: nenhuma consulta aos anúncios reais será executada.', code: 'homologation_fixture_read_only' }, 409);
  }
  const service = createServiceClient();
  const { data: product, error } = await service.from('produtos').select('*').eq('id', input.produtoId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar produto' }, 503);
  if (!product) return json({ error: 'Produto não encontrado' }, 404);
  const itemId = input.mlItemId || product.ml_item_id || null;
  if (input.mlItemId) {
    const binding = await service.from('anuncios_ml').select('ml_item_id').eq('ml_item_id', input.mlItemId).eq('produto_id', product.id).maybeSingle();
    if (binding.error) return json({ error: 'Falha ao validar vínculo' }, 503);
    if (!binding.data && input.mlItemId !== product.ml_item_id) return json({ error: 'Anúncio não pertence ao produto' }, 422);
  }
  // Cliente único resolve a conta conectada; não aceita seller_id fornecido pelo navegador.
  const me = await fetchMLResult<any>('/users/me');
  if (!me.ok || !me.data?.id || me.data.site_id !== 'MLB') return json({
    error: 'Não foi possível validar a conta Mercado Livre.', code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' }, 503);
  const sellerId = String(me.data.id);
  let item: any = null;
  let context: MarketContext | null = null;
  let currentPrice: number | null = null;
  if (itemId) {
    if (input.context) return json({ error: 'O contexto de anúncio existente deve vir do ML' }, 422);
    const result = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId));
    if (!result.ok || !result.data) return json({ error: 'Anúncio indisponível para cotação.', code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' }, 503);
    item = result.data;
    context = itemContext(item, sellerId);
    currentPrice = quoteMoney(item.price);
    if (!context || !currentPrice || String(item.id) !== itemId) return json({ error: 'Contexto do anúncio incompatível para cotação.' }, 422);
  } else {
    if (!input.context) return json({ error: 'Informe categoria, tipo e logística para simular o novo anúncio.' }, 422);
    const validPreparation = await preparationValid(input.context, sellerId);
    if (validPreparation === null) return json({ error: 'ML indisponível para validar a preparação.', code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' }, 503);
    if (!validPreparation) return json({
        error: 'Categoria ou logística não confirmada. Revise o contexto de preparação.', code: 'COTACAO_INCOMPATIVEL' }, 422);
    context = { ...input.context, sellerId, itemId: null, catalogProductId: input.context.catalogProductId || null,
      dimensions: dimensions(product), currency: 'BRL', quantity: 1 };
    if (context.mode === 'me2' && !context.dimensions) return json({ error: 'Dimensões e peso bruto comprovados são necessários.' }, 422);
  }
  const expected = listingMaterialSnapshot(context, item);
  const protection: PricingProtection = await loadPricingOverrides(service, product.id).catch(() => ({ status: 'unavailable', groups: [] }));
  const groups = protection.groups.filter(g => g.state !== 'retired' && g.members.some(m => m.itemId === itemId));
  const group = groups.length === 1 ? groups[0] : null;
  const competitionItemId = worker?.competitionItemId || (item?.catalog_listing ? itemId : null);
  if (competitionItemId && competitionItemId !== itemId
    && (!group || !group.members.some(member => member.itemId === competitionItemId && member.catalog))) {
    return json({ error: 'Referência competitiva não pertence ao grupo confirmado.' }, 422);
  }
  let competitionItem = item;
  if (competitionItemId && competitionItemId !== itemId) {
    const competitionItemResult = await fetchMLResult<any>('/items/' + encodeURIComponent(competitionItemId));
    if (!competitionItemResult.ok || !competitionItemResult.data
      || competitionItemResult.data.id !== competitionItemId
      || String(competitionItemResult.data.seller_id) !== sellerId
      || competitionItemResult.data.catalog_listing !== true
      || quoteMoney(competitionItemResult.data.price) !== currentPrice) {
      return json({ error: 'Referência competitiva sincronizada não pôde ser confirmada.', code: 'CONCORRENCIA_ALTERADA' }, 409);
    }
    competitionItem = competitionItemResult.data;
  }
  const clearanceSnapshot = input.clearance ? await loadPricingClearances(service, product) : null;
  const clearance = clearanceSnapshot?.clearances.find(c => c.id === input.clearance?.id);
  const competitionPath = competitionItemId && competitionItem?.catalog_listing
    ? '/items/' + encodeURIComponent(competitionItemId) + '/price_to_win?siteId=MLB&version=v2' : null;
  const competitionResult = competitionPath ? await fetchMLResult<any>(competitionPath) : null;
  let competitiveEvidence = competitionPath ? competitionEvidence(competitionResult?.data, {
    itemId: competitionItemId!, catalogProductId: competitionItem.catalog_product_id || context.catalogProductId,
    currentPriceCents: currentPrice!,
  }, new Date().toISOString(), competitionResult?.ok === true) : null;
  let listingSafety: { verified: boolean; evidence: unknown[] } = { verified: false, evidence: [] };
  const listingValidationItems: PricingListingValidation['items'] = [];
  const pricing = await loadLiveProductPricing(service, product, context, input.priceCents ?? currentPrice, async () => {
    const account = await fetchMLResult<any>('/users/me');
    if (!account.ok) return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
    if (String(account.data?.id) !== sellerId || account.data?.site_id !== 'MLB')
      return { valid: false, code: 'CONTA_ML_DIVERGENTE' } as const;
    if (!itemId) return preparationValid(input.context!, sellerId);
    const fresh = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId));
    if (!fresh.ok) return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
    const next = itemContext(fresh.data, sellerId);
    if (listingMaterialSnapshot(next, fresh.data) !== expected)
      return { valid: false, code: 'ANUNCIO_REMOTO_ALTERADO' } as const;
    // A verified stored group is not proof of current identity or operational eligibility.
    const [currentProduct, offers, kit, suppliers] = await Promise.all([
      service.from('produtos').select('*').eq('id', product.id).single(),
      service.from('produto_fornecedor_ofertas').select('*').eq('produto_id', product.id),
      loadMlIdentityKit(service, product.id), loadOperationalDropshippingSupplierIds(service),
    ]);
    if (currentProduct.error || offers.error) return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
    if (currentProduct.data?.ativo !== true) return { valid: false, code: 'PRODUTO_LOCAL_ALTERADO' } as const;
    const evidence: unknown[] = [];
    const verifyListing = async (remote: any) => {
      const [attributes, block] = await Promise.all([
        getCategoryAttributes(remote.category_id),
        service.from('anuncios_ml').select('ml_sync_block_reason,ml_sync_blocked_until').eq('ml_item_id', remote.id).maybeSingle(),
      ]);
      if (!attributes || block.error) {
        listingValidationItems.push({ itemId: remote.id, state: 'unavailable', anchor: null,
          reasons: ['FONTE_DE_IDENTIDADE_INDISPONIVEL'], comparisons: [] });
        return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
      }
      const eligibility = classifyMlPublishEligibility({ observedStatus: remote.status,
        blockReason: block.data?.ml_sync_block_reason, blockedUntil: block.data?.ml_sync_blocked_until });
      const identity = assessMlProductIdentity(remote, currentProduct.data, offers.data || [], suppliers, {
        categoryAttributes: attributes, kit, remoteEvidence: { source: 'mercado_livre', reference: remote.id,
          collectedAt: new Date().toISOString(), condition: 'valid' },
      });
      const safe = isMlExistingListingIdentitySafe(identity);
      const validation = identity.existingListingValidation;
      const baseComparisons = identity.comparisons
        .filter(comparison => EXISTING_LISTING_DIAGNOSTIC_FIELDS.has(comparison.field))
        .map(({ field, local, remote, status, reason }) => ({ field, local, remote, status, reason }));
      const comparisons = [...baseComparisons, ...(validation?.comparisons || [])];
      const baseReasons = baseComparisons.filter(comparison => comparison.status !== 'SEM_CONFLITO')
        .map(comparison => `${comparison.field}:${comparison.reason}`);
      const state = !eligibility.eligible || eligibility.kind !== 'modifiable' ? 'ineligible'
        : safe ? 'verified'
          : validation?.status || (hasConfirmedMlExistingListingIdentityConflict(identity) ? 'conflict' : 'pending');
      const reasons = state === 'ineligible' ? ['ANUNCIO_INELEGIVEL']
        : safe ? [] : [...new Set([...(validation?.reasons || []), ...baseReasons])];
      const validationItem: PricingListingValidation['items'][number] = { itemId: remote.id, state,
        anchor: validation?.anchor || (safe ? 'product' : null),
        reasons, comparisons };
      listingValidationItems.push(validationItem);
      evidence.push({ itemId: remote.id, status: remote.status, validation: validationItem });
      if (!eligibility.eligible || eligibility.kind !== 'modifiable')
        return { valid: false, code: 'ANUNCIO_INELEGIVEL' } as const;
      if (!safe)
        return { valid: false, code: 'IDENTIDADE_ANUNCIO_PENDENTE' } as const;
      return { valid: true } as const;
    };
    const verifiedListing = await verifyListing(fresh.data);
    if (!verifiedListing.valid) return verifiedListing;
    if (competitiveEvidence?.condition === 'valid' && competitionPath) {
      const refreshed = await fetchMLResult<any>(competitionPath);
      const evidence = competitionEvidence(refreshed.data, { itemId: competitionItemId!,
        catalogProductId: competitionItem.catalog_product_id || context!.catalogProductId,
        currentPriceCents: currentPrice! }, new Date().toISOString(), refreshed.ok);
      if (evidence.condition !== 'valid') { competitiveEvidence = evidence; return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const; }
      if (evidence.priceCents !== competitiveEvidence.priceCents || evidence.status !== competitiveEvidence.status) {
        competitiveEvidence = { ...evidence, condition: 'inconsistent' }; return { valid: false, code: 'CONCORRENCIA_ALTERADA' } as const;
      }
    }
    if (group) {
      const latest = await loadPricingOverrides(service, product.id).catch(() => null);
      const nextGroup = latest?.groups.find(g => g.id === group.id);
      if (!nextGroup || pricingMaterialFingerprint(group) !== pricingMaterialFingerprint(nextGroup))
        return { valid: false, code: 'GRUPO_ALTERADO' } as const;
      // A stored group is not live proof that its members still share one price.
      if (group.members.length > 1) {
        const sync = await fetchMLResult<any>('/public/buybox/sync/' + encodeURIComponent(itemId!));
        if (!sync.ok) return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
        const peers = group.members.filter(m => m.itemId !== itemId);
        if (sync.data?.status !== 'SYNC' || sync.data?.item_id !== itemId || !Array.isArray(sync.data?.relations)
          || peers.some(m => !sync.data.relations.includes(m.itemId))) return { valid: false, code: 'GRUPO_ALTERADO' } as const;
        for (const peer of peers) {
          const result = await fetchMLResult<any>('/items/' + encodeURIComponent(peer.itemId));
          if (!result.ok) return { valid: null, code: 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL' } as const;
          const peerPrice = peer.variationId ? result.data?.variations?.find((v: any) => String(v.id) === peer.variationId)?.price : result.data?.price;
          if (result.data?.id !== peer.itemId || String(result.data.seller_id) !== sellerId
            || result.data.currency_id !== 'BRL' || hasMlAutomaticPrice(result.data)
            || quoteMoney(peerPrice) !== currentPrice) return { valid: false, code: 'GRUPO_ALTERADO' } as const;
          const peerVerification = await verifyListing(result.data);
          if (!peerVerification.valid) return peerVerification;
        }
      }
    }
    if (input.clearance) {
      const latest = await loadPricingClearances(service, product);
      if (pricingMaterialFingerprint({ stock: latest.stock, rows: latest.clearances })
        !== pricingMaterialFingerprint({ stock: clearanceSnapshot?.stock, rows: clearanceSnapshot?.clearances }))
        return { valid: false, code: 'PRODUTO_LOCAL_ALTERADO' } as const;
    }
    listingSafety = { verified: true, evidence };
    return { valid: true } as const;
  }, { competitivePriceCents: competitiveEvidence?.priceCents, actualPriceCents: currentPrice, groupId: group?.id });
  const view = pricingView(pricing);
  const memory = pricing.current.memory;
  let quantityPricing: ReturnType<typeof serializeQuantityPricingTiers> = [];
  let quantityPricingWarning: string | null = null;
  let catalog: any = null;
  if (itemId) {
    const prices = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId) + '/prices', { headers: { 'show-all-prices': 'TRUE' } });
    if (prices.ok) quantityPricing = serializeQuantityPricingTiers(extractQuantityPricingTiers(prices.data, (currentPrice ?? 0) / 100));
    else quantityPricingWarning = 'Descontos existentes indisponíveis para consulta.';
    if (competitionItemId && competitionItem?.catalog_listing) {
      const competition = { ok: competitiveEvidence?.condition === 'valid', data: competitionResult?.data };
      const rawStatus = competition.ok ? normalizeBuyBoxStatus(competition.data) : null;
      catalog = { status: resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: rawStatus }),
        rawStatus, priceToWin: competition.ok ? normalizePriceToWin(competition.data) : null,
        currentPrice: (currentPrice ?? 0) / 100, catalogProductId: competitionItem.catalog_product_id,
        warning: competition.ok ? null : 'Competição indisponível; não é recomendação de preço.',
        syncedAt: competition.ok ? new Date().toISOString() : null,
        currencyId: 'BRL', consistent: typeof competition.data?.consistent === 'boolean' ? competition.data.consistent : null,
        visitShare: competition.ok ? competition.data?.visit_share ?? null : null,
        competitorsSharingFirstPlace: competition.ok ? competition.data?.competitors_sharing_first_place ?? null : null,
        winner: competition.ok && competition.data?.winner ? { itemId: competition.data.winner.item_id ?? competition.data.winner.id ?? null,
          price: typeof competition.data.winner.price === 'number' ? competition.data.winner.price : null, currencyId: 'BRL' } : null,
        boosts: competition.ok && Array.isArray(competition.data?.boosts) ? competition.data.boosts.map((b: any) => ({
          id: String(b.id ?? ''), status: String(b.status ?? ''), description: String(b.description ?? '') })) : [],
        reasons: competition.ok ? [competition.data?.reason ?? competition.data?.reasons ?? []].flat().map((r: any) => String(r?.message ?? r?.id ?? r)) : [] };
    }
  }
  const competitiveAssessment = competitiveEvidence ? assessCompetitivePricing({
    pricing: { ...pricing, current: pricing.comparisons?.actual ?? pricing.current },
    competitive: pricing.comparisons?.competitive ?? null, evidence: competitiveEvidence,
    group, evaluatedAt: new Date().toISOString(),
    clearance: clearance && input.clearance && group ? { id: clearance.id, groupId: group.id, groupVersion: group.version,
      state: clearance.state, endsAt: clearance.endsAt, available: clearance.available, quantity: input.clearance.quantity,
      maxLossCents: clearance.maxLossCents, fulfillmentSource: 'internal',
      stockVerified: (clearanceSnapshot?.stock.capacity ?? 0) >= input.clearance.quantity,
      conflict: !clearance.groups.some(g => g.id === group.id && g.version === group.version && !g.conflict && g.state === 'verified') } : null,
  }) : null;
  const decision = itemId && currentPrice ? decisionContext({ pricing, sellerId, itemId, currentPriceCents: currentPrice,
    priceCents: input.priceCents ?? currentPrice, group, automatic: hasMlAutomaticPrice(item), clearance: input.clearance,
    listingSafety,
    clearanceState: clearanceSnapshot ? { stock: clearanceSnapshot.stock, clearances: clearanceSnapshot.clearances } : null }) : null;
  const listingValidation: PricingListingValidation | null = itemId ? (() => {
    if (!listingValidationItems.length) return { state: 'unavailable', anchor: null,
      reasons: ['VALIDACAO_DE_IDENTIDADE_NAO_EXECUTADA'], items: [] };
    const state: PricingListingValidation['state'] = listingValidationItems.every(entry => entry.state === 'verified') ? 'verified'
      : listingValidationItems.some(entry => entry.state === 'conflict') ? 'conflict'
        : listingValidationItems.some(entry => entry.state === 'ineligible') ? 'ineligible'
          : listingValidationItems.some(entry => entry.state === 'unavailable') ? 'unavailable' : 'pending';
    const anchors = [...new Set(listingValidationItems.map(entry => entry.anchor).filter(Boolean))];
    return { state, anchor: state === 'verified' && anchors.length === 1 ? anchors[0]! : null,
      reasons: [...new Set(listingValidationItems.flatMap(entry => entry.reasons))], items: listingValidationItems };
  })() : null;
  const evaluationId = await recordPricingEvaluation(service, product.id, user.id, pricing, competitiveAssessment, decision);
  if (decision) await syncPricingAlerts(service, evaluationId, decision, competitiveAssessment);
  return json({ success: true, evaluationId, decisionContext: decision, protection, mlItemId: itemId,
    competitionItemId, currentPrice: currentPrice === null ? null : currentPrice / 100,
    currentProfit: input.priceCents != null && input.priceCents !== currentPrice ? null : view.profit,
    pricing, competitiveAssessment, listingValidation,
    commercialConflicts: competitiveAssessment ? classifyCommercialConflicts({ economy: competitiveAssessment.assessment }) : null,
    quantityPricing, quantityPricingWarning, catalog,
    calculator: { cost: view.cost, shipping: memory ? memory.shipping.amountCents! / 100 : null,
      mlFee: null, taxRate: memory?.tax.context.appliedRate ?? null },
    automaticPricing: { active: item ? hasMlAutomaticPrice(item) : false, tag: ML_DYNAMIC_STANDARD_PRICE_TAG } });
}
