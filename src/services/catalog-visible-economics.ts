import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { EconomicMarketQuote } from '@/types/pricing';
import { competitionEvidence, type CompetitionEvidence } from '@/lib/catalogo/competition-evidence';
import {
  CATALOG_VISIBLE_ECONOMICS_CONCURRENCY,
  notApplicableCatalogEconomy,
  presentCatalogEconomicResult,
  unavailableCatalogEconomy,
  type CatalogEconomicReason,
  type CatalogVisibleEconomicsResponse,
  type CatalogVisibleEconomicsRow,
} from '@/lib/catalogo/visible-economics';
import { buildMlItemsBulkPath, getMlItemsBulkBody, type MlItemsBulkRow } from '@/lib/ml/items-bulk';
import { fetchMLResult, type MLRequestResult } from '@/services/integration';
import { evaluateProductPricing, loadPricingRequestContext, loadProductPricing,
  type PricingProduct, type ProductPricing } from '@/services/pricing-context';
import { marketContextKey, observedMarketContext, quoteMoney, readMarketQuote,
  type MarketContext } from '@/services/pricing-market-quote';

type Client = SupabaseClient<Database>;
type Snapshot = Pick<Database['public']['Tables']['catalogo_ml_snapshot']['Row'],
  'ml_item_id' | 'produto_id' | 'seller_id' | 'catalog_listing' | 'catalog_product_id'
  | 'buy_box_status' | 'price' | 'price_to_win' | 'synced_at'>;
type RequestedRow = { mlItemId: string; snapshotSyncedAt: string };
type HaltReason = CatalogVisibleEconomicsResponse['haltReason'];
type Work = {
  snapshot: Snapshot;
  product: PricingProduct;
  context: MarketContext;
  currentPriceCents: number;
  currentQuote: EconomicMarketQuote | null;
  competitiveQuote: EconomicMarketQuote | null;
  evidence: CompetitionEvidence;
  reference: CatalogVisibleEconomicsRow['reference'];
};

type ReadResult = { ok: boolean; data: any; status?: number | null; error?: MLRequestResult<unknown>['error'] };

function toCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function snapshotReference(snapshot: Snapshot): CatalogVisibleEconomicsRow['reference'] {
  return {
    currentPrice: Number(snapshot.price || 0), currentSource: 'snapshot', currentObservedAt: snapshot.synced_at,
    priceToWin: snapshot.price_to_win == null ? null : Number(snapshot.price_to_win),
    competitionStatus: snapshot.buy_box_status, competitionSource: 'snapshot',
    competitionObservedAt: snapshot.synced_at, changedFromSnapshot: false,
  };
}

function unavailableRow(snapshot: Snapshot, reason: CatalogEconomicReason): CatalogVisibleEconomicsRow {
  return { mlItemId: snapshot.ml_item_id, snapshotSyncedAt: snapshot.synced_at,
    reference: snapshotReference(snapshot), current: unavailableCatalogEconomy(reason),
    competitive: snapshot.price_to_win == null && reason !== 'SNAPSHOT_CHANGED'
      ? notApplicableCatalogEconomy('REFERENCE_NOT_AVAILABLE') : unavailableCatalogEconomy(reason) };
}

function haltFromResult(result: MLRequestResult<unknown>): HaltReason {
  if (result.error?.category === 'auth_fatal') return 'AUTH_REQUIRED';
  if (result.status === 429) return 'RATE_LIMITED';
  return null;
}

function quoteReason(quote: EconomicMarketQuote | null, fallback: CatalogEconomicReason): CatalogEconomicReason | null {
  if (!quote) return fallback;
  if (quote.shipping.amountCents === null) return 'SHIPPING_UNAVAILABLE';
  if (quote.fee.source !== 'ml_live' || quote.fee.amountCents === null) return 'FEE_UNAVAILABLE';
  return null;
}

async function runLimited<T>(items: T[], worker: (item: T) => Promise<void>, shouldStop: () => boolean) {
  for (let index = 0; index < items.length && !shouldStop(); index += CATALOG_VISIBLE_ECONOMICS_CONCURRENCY) {
    await Promise.all(items.slice(index, index + CATALOG_VISIBLE_ECONOMICS_CONCURRENCY).map(worker));
  }
}

/** Leitura efêmera da página visível. Não registra avaliação, alerta, job ou intenção de preço. */
export async function loadCatalogVisibleEconomics(client: Client,
  requested: readonly RequestedRow[]): Promise<CatalogVisibleEconomicsResponse> {
  const itemIds = [...new Set(requested.map(row => row.mlItemId))];
  const { data: snapshotData, error: snapshotError } = await client.from('catalogo_ml_snapshot')
    .select('ml_item_id,produto_id,seller_id,catalog_listing,catalog_product_id,buy_box_status,price,price_to_win,synced_at')
    .in('ml_item_id', itemIds);
  if (snapshotError) throw new Error('Falha ao carregar a página do catálogo');
  const snapshots = (snapshotData || []) as Snapshot[];
  const requestedById = new Map(requested.map(row => [row.mlItemId, row]));
  const rows = new Map<string, CatalogVisibleEconomicsRow>();
  const candidates = snapshots.filter(snapshot => {
    const expected = requestedById.get(snapshot.ml_item_id);
    if (!expected || expected.snapshotSyncedAt !== snapshot.synced_at) {
      rows.set(snapshot.ml_item_id, unavailableRow(snapshot, 'SNAPSHOT_CHANGED'));
      return false;
    }
    if (!snapshot.produto_id) {
      rows.set(snapshot.ml_item_id, unavailableRow(snapshot, 'PRODUCT_UNLINKED'));
      return false;
    }
    return true;
  });
  if (!candidates.length) return { data: requested.map(row => rows.get(row.mlItemId)).filter(Boolean) as CatalogVisibleEconomicsRow[], haltReason: null };

  const productIds = [...new Set(candidates.map(snapshot => snapshot.produto_id!))];
  const [{ data: productData, error: productError }, requestContext, me] = await Promise.all([
    client.from('produtos').select('id,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price').in('id', productIds),
    loadPricingRequestContext(client),
    fetchMLResult<any>('/users/me'),
  ]);
  if (productError) throw new Error('Falha ao carregar os produtos do catálogo');
  const products = new Map((productData || []).map(product => [String(product.id), product as PricingProduct]));
  const sellerId = me.ok && me.data?.site_id === 'MLB' && me.data?.id ? String(me.data.id) : null;
  let haltReason: HaltReason = haltFromResult(me);
  if (!sellerId) {
    haltReason ||= 'ML_UNAVAILABLE';
    for (const snapshot of candidates) rows.set(snapshot.ml_item_id, unavailableRow(snapshot, haltReason));
    return { data: requested.map(row => rows.get(row.mlItemId)).filter(Boolean) as CatalogVisibleEconomicsRow[], haltReason };
  }

  const eligible = candidates.filter(snapshot => {
    if (!products.has(String(snapshot.produto_id))) {
      rows.set(snapshot.ml_item_id, unavailableRow(snapshot, 'PRODUCT_UNLINKED'));
      return false;
    }
    if (String(snapshot.seller_id) !== sellerId || snapshot.catalog_listing !== true) {
      rows.set(snapshot.ml_item_id, unavailableRow(snapshot, 'LISTING_INCOMPATIBLE'));
      return false;
    }
    return true;
  });
  if (!eligible.length) return { data: requested.map(row => rows.get(row.mlItemId)).filter(Boolean) as CatalogVisibleEconomicsRow[], haltReason };

  const bulk = await fetchMLResult<Array<MlItemsBulkRow<any>>>(buildMlItemsBulkPath(
    eligible.map(snapshot => snapshot.ml_item_id),
    ['site_id', 'seller_id', 'currency_id', 'catalog_listing', 'catalog_product_id', 'category_id',
      'listing_type_id', 'condition', 'price', 'shipping'],
  ));
  haltReason ||= haltFromResult(bulk);
  if (!bulk.ok || !Array.isArray(bulk.data)) {
    haltReason ||= 'ML_UNAVAILABLE';
    for (const snapshot of eligible) rows.set(snapshot.ml_item_id, unavailableRow(snapshot, haltReason));
    return { data: requested.map(row => rows.get(row.mlItemId)).filter(Boolean) as CatalogVisibleEconomicsRow[], haltReason };
  }
  const items = new Map(bulk.data.map(row => getMlItemsBulkBody(row)).filter(Boolean).map(item => [item!.id, item!]));
  const works: Work[] = [];

  const trackedFetch = async (path: string): Promise<ReadResult> => {
    if (haltReason) return { ok: false, data: null };
    const result = await fetchMLResult<any>(path);
    haltReason ||= haltFromResult(result);
    return result;
  };
  await runLimited(eligible, async snapshot => {
    const product = products.get(String(snapshot.produto_id))!;
    const item = items.get(snapshot.ml_item_id);
    const context = observedMarketContext(item, sellerId);
    const currentPriceCents = quoteMoney(item?.price);
    if (!context || !currentPriceCents || item?.catalog_listing !== true
      || context.catalogProductId !== snapshot.catalog_product_id) {
      rows.set(snapshot.ml_item_id, unavailableRow(snapshot, 'LISTING_INCOMPATIBLE'));
      return;
    }
    const currentObservedAt = new Date().toISOString();
    const competitionResult = await trackedFetch(`/items/${encodeURIComponent(snapshot.ml_item_id)}/price_to_win?siteId=MLB&version=v2`);
    const competitionObservedAt = new Date().toISOString();
    const evidence = competitionEvidence(competitionResult.data, {
      itemId: snapshot.ml_item_id, catalogProductId: context.catalogProductId, currentPriceCents,
    }, competitionObservedAt, competitionResult.ok);
    const priceToWin = evidence.condition === 'valid' && evidence.priceCents !== null ? evidence.priceCents / 100 : null;
    const competitionStatus = evidence.condition === 'valid' ? evidence.status : snapshot.buy_box_status;
    const reference: CatalogVisibleEconomicsRow['reference'] = {
      currentPrice: currentPriceCents / 100, currentSource: 'ml_live', currentObservedAt,
      priceToWin: evidence.condition === 'valid' ? priceToWin
        : snapshot.price_to_win == null ? null : Number(snapshot.price_to_win),
      competitionStatus, competitionSource: evidence.condition === 'valid' ? 'ml_live' : 'snapshot',
      competitionObservedAt: evidence.condition === 'valid' ? competitionObservedAt : snapshot.synced_at,
      changedFromSnapshot: currentPriceCents !== toCents(Number(snapshot.price))
        || (evidence.condition === 'valid' && (evidence.priceCents !== toCents(snapshot.price_to_win)
          || evidence.status !== snapshot.buy_box_status)),
    };
    const quoteCache = new Map<number, Promise<EconomicMarketQuote>>();
    const quote = (priceCents: number) => {
      let pending = quoteCache.get(priceCents);
      if (!pending) {
        pending = readMarketQuote({ fetch: trackedFetch, context, priceCents,
          fallbackRate: requestContext.commercial.mlFeeFallbackRate,
          unspecifiedShippingCost: requestContext.commercial.unspecifiedShippingCost });
        quoteCache.set(priceCents, pending);
      }
      return pending;
    };
    const [currentQuote, competitiveQuote] = haltReason ? [null, null] : await Promise.all([
      quote(currentPriceCents),
      evidence.condition === 'valid' && evidence.priceCents !== null ? quote(evidence.priceCents) : Promise.resolve(null),
    ]);
    works.push({ snapshot, product, context, currentPriceCents, currentQuote, competitiveQuote, evidence, reference });
  }, () => haltReason !== null);

  const pricingByItem = new Map<string, ProductPricing>();
  const pending = [...works];
  while (pending.length) {
    const group: Work[] = [];
    const seenProducts = new Set<string>();
    for (let index = 0; index < pending.length;) {
      const work = pending[index];
      if (seenProducts.has(work.product.id)) { index += 1; continue; }
      seenProducts.add(work.product.id); group.push(work); pending.splice(index, 1);
    }
    const byProduct = new Map(group.map(work => [work.product.id, work]));
    const evidence = new Map(group.map(work => [work.product.id, {
      mlItemId: work.snapshot.ml_item_id, currentPriceCents: work.currentPriceCents,
      marketContextKey: marketContextKey(work.context), fee: work.currentQuote?.fee,
      shipping: work.currentQuote?.shipping,
    }]));
    const pricing = await loadProductPricing(client, group.map(work => work.product), {
      requestContext, evidence,
      evaluate: (base, currentPriceCents, feeRate, observedFee) => {
        const work = byProduct.get(base.context.productId || '')!;
        const evaluatedAt = new Date().toISOString();
        const currentBase = { ...base, evaluatedAt,
          shipping: work.currentQuote?.shipping ?? base.shipping };
        const current = evaluateProductPricing(currentBase, currentPriceCents, feeRate,
          work.currentQuote?.fee ?? observedFee);
        if (work.evidence.priceCents === null || !work.competitiveQuote) return current;
        const competitive = evaluateProductPricing({ ...base, evaluatedAt,
          shipping: work.competitiveQuote.shipping }, work.evidence.priceCents, feeRate,
        work.competitiveQuote.fee).current;
        return { ...current, comparisons: { competitive } };
      },
    });
    for (const work of group) {
      const value = pricing.get(work.product.id);
      if (value) pricingByItem.set(work.snapshot.ml_item_id, value);
    }
  }

  for (const work of works) {
    const pricing = pricingByItem.get(work.snapshot.ml_item_id);
    const currentFailure = quoteReason(work.currentQuote, haltReason || 'ML_UNAVAILABLE');
    const current = currentFailure ? unavailableCatalogEconomy(currentFailure)
      : presentCatalogEconomicResult(pricing?.current, pricing?.current.memory?.evaluatedAt || new Date().toISOString());
    let competitive = unavailableCatalogEconomy(haltReason || 'ML_UNAVAILABLE');
    if (work.evidence.condition === 'inconsistent') competitive = unavailableCatalogEconomy('REFERENCE_INCONSISTENT');
    else if (work.evidence.condition === 'unavailable') competitive = unavailableCatalogEconomy(haltReason || 'ML_UNAVAILABLE');
    else if (work.evidence.priceCents === null) competitive = notApplicableCatalogEconomy('REFERENCE_NOT_AVAILABLE');
    else {
      const competitiveFailure = quoteReason(work.competitiveQuote, haltReason || 'ML_UNAVAILABLE');
      competitive = competitiveFailure ? unavailableCatalogEconomy(competitiveFailure)
        : presentCatalogEconomicResult(pricing?.comparisons?.competitive,
          pricing?.comparisons?.competitive?.memory?.evaluatedAt || new Date().toISOString());
    }
    rows.set(work.snapshot.ml_item_id, { mlItemId: work.snapshot.ml_item_id,
      snapshotSyncedAt: work.snapshot.synced_at, reference: work.reference, current, competitive });
  }
  for (const snapshot of eligible) {
    if (!rows.has(snapshot.ml_item_id)) rows.set(snapshot.ml_item_id, unavailableRow(snapshot, haltReason || 'ML_UNAVAILABLE'));
  }
  return { data: requested.map(row => rows.get(row.mlItemId)).filter(Boolean) as CatalogVisibleEconomicsRow[], haltReason };
}
