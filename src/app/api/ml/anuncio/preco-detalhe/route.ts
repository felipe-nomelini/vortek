import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { loadLiveProductPricing } from '@/services/pricing-live';
import { recordPricingEvaluation } from '@/services/pricing-audit';
import { loadPricingOverrides, type PricingProtection } from '@/services/pricing-overrides';
import { quoteMoney, type MarketContext } from '@/services/pricing-market-quote';
import { pricingView } from '@/lib/pricing-view';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { extractQuantityPricingTiers, serializeQuantityPricingTiers } from '@/lib/ml/quantity-pricing';
import { hasMlAutomaticPrice, ML_DYNAMIC_STANDARD_PRICE_TAG } from '@/lib/ml/item-price-policy';
import { normalizeBuyBoxStatus, normalizePriceToWin, resolveCatalogCompetitionStatus } from '@/lib/catalogo/no-catalogo';

const contextSchema = z.object({
  categoryId: z.string().regex(/^MLB\d+$/), listingType: z.enum(['gold_special', 'gold_pro']),
  condition: z.enum(['new', 'used', 'not_specified']), mode: z.enum(['me2', 'not_specified']),
  logisticType: z.string().trim().min(1).max(60), freeShipping: z.boolean(),
}).strict();
const inputSchema = z.object({
  produtoId: z.string().min(1).max(100),
  mlItemId: z.string().regex(/^MLB\d+$/).optional(),
  priceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  context: contextSchema.optional(),
}).strict();
// Um item existente preserva o tipo observado, inclusive Gratuito; não o converte em Clássico.
const observedContextSchema = contextSchema.extend({ listingType: z.enum(['free', 'gold_special', 'gold_pro']) });
type Input = z.infer<typeof inputSchema>;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

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

async function preparationValid(context: z.infer<typeof contextSchema>, sellerId: string): Promise<boolean | null> {
  const [category, seller, shipping] = await Promise.all([
    fetchMLResult<any>('/categories/' + encodeURIComponent(context.categoryId)),
    fetchMLResult<any>('/users/' + encodeURIComponent(sellerId) + '/shipping_preferences'),
    fetchMLResult<any>('/categories/' + encodeURIComponent(context.categoryId) + '/shipping_preferences'),
  ]);
  if (!category.ok || !seller.ok || !shipping.ok) return null;
  return category.data?.id === context.categoryId && Array.isArray(category.data?.children_categories)
    && category.data.children_categories.length === 0 && category.data?.settings?.listing_allowed === true
    && Array.isArray(seller.data?.logistics) && seller.data.logistics.some((row: any) => row.mode === context.mode
      && Array.isArray(row.types) && row.types.some((type: any) => type.type === context.logisticType))
    && Array.isArray(shipping.data?.logistics) && shipping.data.logistics.some((row: any) => row.mode === context.mode
      && Array.isArray(row.types) && row.types.includes(context.logisticType));
}

async function details(raw: unknown) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
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
    context = { ...input.context, sellerId, itemId: null, catalogProductId: null, dimensions: dimensions(product), currency: 'BRL', quantity: 1 };
    if (context.mode === 'me2' && !context.dimensions) return json({ error: 'Dimensões e peso bruto comprovados são necessários.' }, 422);
  }
  const expected = JSON.stringify({ context, price: item?.price ?? null, tags: item?.tags ?? [], shipping: item?.shipping ?? null });
  const pricing = await loadLiveProductPricing(service, product, context, input.priceCents ?? currentPrice, async () => {
    const account = await fetchMLResult<any>('/users/me');
    if (!account.ok) return null;
    if (String(account.data?.id) !== sellerId || account.data?.site_id !== 'MLB') return false;
    if (!itemId) return preparationValid(input.context!, sellerId);
    const fresh = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId));
    if (!fresh.ok) return null;
    const next = itemContext(fresh.data, sellerId);
    return JSON.stringify({ context: next, price: fresh.data?.price ?? null, tags: fresh.data?.tags ?? [], shipping: fresh.data?.shipping ?? null }) === expected;
  });
  const view = pricingView(pricing);
  const memory = pricing.current.memory;
  let quantityPricing: ReturnType<typeof serializeQuantityPricingTiers> = [];
  let quantityPricingWarning: string | null = null;
  let catalog: any = null;
  if (itemId) {
    const prices = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId) + '/prices', { headers: { 'show-all-prices': 'TRUE' } });
    if (prices.ok) quantityPricing = serializeQuantityPricingTiers(extractQuantityPricingTiers(prices.data, (currentPrice ?? 0) / 100));
    else quantityPricingWarning = 'Descontos existentes indisponíveis para consulta.';
    if (item?.catalog_listing) {
      const competition = await fetchMLResult<any>('/items/' + encodeURIComponent(itemId) + '/price_to_win?version=v2');
      const rawStatus = competition.ok ? normalizeBuyBoxStatus(competition.data) : null;
      catalog = { status: resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: rawStatus }),
        rawStatus, priceToWin: competition.ok ? normalizePriceToWin(competition.data) : null,
        currentPrice: (currentPrice ?? 0) / 100, catalogProductId: item.catalog_product_id,
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
  const evaluationId = await recordPricingEvaluation(service, product.id, user.id, pricing);
  const protection: PricingProtection = await loadPricingOverrides(service, product.id).catch(() => ({ status: 'unavailable', groups: [] }));
  return json({ success: true, evaluationId, protection, mlItemId: itemId, currentPrice: currentPrice === null ? null : currentPrice / 100,
    currentProfit: input.priceCents != null && input.priceCents !== currentPrice ? null : view.profit,
    pricing, quantityPricing, quantityPricingWarning, catalog,
    calculator: { cost: view.cost, shipping: memory ? memory.shipping.amountCents! / 100 : null,
      mlFee: null, taxRate: memory?.tax.context.appliedRate ?? null },
    automaticPricing: { active: item ? hasMlAutomaticPrice(item) : false, tag: ML_DYNAMIC_STANDARD_PRICE_TAG } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { return await details({ produtoId: params.get('produtoId') || '', ...(params.get('mlItemId') ? { mlItemId: params.get('mlItemId') } : {}) }); }
  catch { return json({ error: 'Falha ao consultar fontes econômicas.' }, 503); }
}

/** Consulta explícita, nunca grava configuração ou preço. */
export async function POST(request: Request) {
  try { return await details(await request.json().catch(() => null)); }
  catch { return json({ error: 'Falha ao consultar fontes econômicas.' }, 503); }
}
