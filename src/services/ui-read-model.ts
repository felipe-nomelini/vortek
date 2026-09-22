import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { loadPricingRequestContext, loadProductPricing, type PricingRequestContext } from '@/services/pricing-context';
import { pricingView } from '@/lib/pricing-view';
import { loadProductMlListings } from '@/lib/ml/product-listings';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { loadKitSupplySources } from '@/lib/kit-supply-source';
import { resolvePreferredOfferForProduct } from '@/lib/preferred-offer';
import { resolveCatalogCompetitionStatus } from '@/lib/catalogo/no-catalogo';
import { classifyMlPublishEligibility } from '@/lib/ml/publish-eligibility.js';

type Client = SupabaseClient<Database>;
type QueueItem = {
  entity_kind: 'product' | 'listing';
  entity_key: string;
  generation: number;
  version: number;
  claim_token: string;
};

type ProjectionState = {
  active_generation: number;
  target_generation: number;
  status: 'requested' | 'building' | 'ready';
  context_fingerprint: string | null;
  context: Record<string, any> | null;
  build_context_fingerprint: string | null;
  build_context: Record<string, any> | null;
};

function normalizeListingStatus(status: unknown) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'ativo') return 'active';
  if (value === 'pausado') return 'paused';
  if (value === 'encerrado') return 'closed';
  return value;
}

function maximumTimestamp(values: unknown[]) {
  const timestamps = values
    .map((value) => Date.parse(String(value || '')))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function contextFingerprint(context: PricingRequestContext) {
  const payload = JSON.stringify({
    commercial: context.commercial,
    taxContext: {
      referenceMonth: context.taxContext.referenceMonth,
      confirmedRate: context.taxContext.confirmedRate,
      source: context.taxContext.source,
      manualRequired: context.taxContext.manualRequired,
      bracket: context.taxContext.bracket,
    },
    operational: [...context.operational].sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function contextSnapshot(context: PricingRequestContext) {
  return {
    commercial: context.commercial,
    taxContext: context.taxContext,
    operationalSupplierIds: [...context.operational].sort(),
    evaluatedAt: context.evaluatedAt,
  };
}

function contextFromSnapshot(snapshot: Record<string, any> | null, fallback: PricingRequestContext) {
  if (!snapshot?.commercial || !snapshot?.taxContext || !Array.isArray(snapshot.operationalSupplierIds)) return fallback;
  return {
    commercial: snapshot.commercial,
    taxContext: snapshot.taxContext,
    operational: new Set<string>(snapshot.operationalSupplierIds.map(String)),
    evaluatedAt: String(snapshot.evaluatedAt || fallback.evaluatedAt),
  } as PricingRequestContext;
}

async function readState(client: Client): Promise<ProjectionState> {
  const result = await (client as any).from('ui_read_model_state')
    .select('active_generation,target_generation,status,context_fingerprint,context,build_context_fingerprint,build_context')
    .eq('scope', 'catalog_ui').single();
  if (result.error || !result.data) throw new Error('ui_read_model_state_unavailable');
  return result.data as ProjectionState;
}

async function buildProductRows(
  client: Client,
  items: QueueItem[],
  requestContext: PricingRequestContext,
) {
  const ids = [...new Set(items.map((item) => item.entity_key))];
  if (!ids.length) return { rows: [], found: new Set<string>() };
  const [{ data: products, error: productError }, { data: offers, error: offerError }] = await Promise.all([
    client.from('produtos').select('*').in('id', ids),
    client.from('produto_fornecedor_ofertas').select('*').in('produto_id', ids),
  ]);
  if (productError || offerError) throw new Error('ui_product_sources_failed');
  const productRows = products || [];
  const found = new Set(productRows.map((product) => product.id));
  const [listings, capacities, kitSources] = await Promise.all([
    loadProductMlListings(client as any, ids),
    loadProductFulfillmentCapacities(client as any, ids),
    loadKitSupplySources(client as any, ids, { operationalSupplierIds: requestContext.operational }),
  ]);
  const evidence = new Map(productRows.flatMap((product) => {
    const listing = listings.get(product.id)?.[0];
    return listing ? [[product.id, {
      mlItemId: listing.itemId,
      currentPriceCents: listing.price == null ? null : Math.round(listing.price * 100),
      marketContextKey: `listing:${listing.itemId}:unquoted`,
    }] as const] : [];
  }));
  const pricing = new Map<string, Awaited<ReturnType<typeof loadProductPricing>> extends Map<string, infer Value> ? Value : never>();
  for (let offset = 0; offset < productRows.length; offset += 100) {
    const batch = productRows.slice(offset, offset + 100);
    const batchPricing = await loadProductPricing(client, batch, { requestContext, evidence });
    for (const [productId, result] of batchPricing) pricing.set(productId, result);
  }
  const offersByProduct = new Map<string, any[]>();
  for (const offer of offers || []) {
    const current = offersByProduct.get(offer.produto_id) || [];
    current.push(offer);
    offersByProduct.set(offer.produto_id, current);
  }
  const itemByProductAndGeneration = new Map(items.map((item) => [`${item.generation}:${item.entity_key}`, item]));
  const rows: Record<string, unknown>[] = [];

  for (const product of productRows) {
    const productOffers = offersByProduct.get(product.id) || [];
    const eligibleOffers = productOffers.filter((offer) => (
      offer.ativo === true && requestContext.operational.has(String(offer.dslite_fornecedor_id || '').trim())
    ));
    const kitSource = kitSources.get(product.id);
    const isKit = Boolean(kitSource && kitSource.kind !== 'not_kit');
    const preferred = isKit
      ? kitSource?.kind === 'ready' ? {
          ...kitSource.source.offer,
          id: `kit-fornecedor-${product.id}`,
          produto_id: product.id,
          dslite_fornecedor_id: kitSource.source.supplierId,
          dslite_produto_id: null,
          fornecedor_nome: kitSource.source.supplierName,
          sku_oferta: kitSource.source.sourceSku,
          sku_fornecedor: kitSource.source.sourceSku,
          custo: kitSource.source.cost,
          estoque: kitSource.source.stock,
          preferred: true,
          preferred_manual: false,
          is_kit_supplier: true,
          source_kind: 'kit',
          kit_mapping_complete: true,
        } : null
      : resolvePreferredOfferForProduct(
          eligibleOffers,
          product.oferta_preferencial_id,
          product.fornecedor_preferencial_manual === true,
        );
    const capacity = capacities.get(product.id) || { internal: 0, supplier: 0, safe: 0 };
    const linkedListings = listings.get(product.id) || [];
    const primaryListing = linkedListings[0];
    const pricingResult = pricing.get(product.id);
    const view = pricingView(pricingResult);
    const memory = pricingResult?.current.memory;
    const operationalSupplier = capacity.internal > 0
      ? 'Estoque Interno'
      : kitSource?.kind === 'ready'
        ? kitSource.source.supplierName
        : String((preferred as any)?.fornecedor_nome || product.fornecedor || '').trim() || null;
    const projectedProduct = {
      ...product,
      estoque: capacity.safe,
      estoque_interno: capacity.internal,
      fornecedor: operationalSupplier,
      ml_item_id: primaryListing?.itemId || product.ml_item_id,
      ml_status: primaryListing?.status || product.ml_status,
      pricing: pricingResult,
    };
    const payload = {
      product: projectedProduct,
      preferredOffer: preferred,
      offersCount: productOffers.length,
      fulfillmentCapacity: capacity,
      mlListings: linkedListings,
      isKit,
    };
    const supplierIds = [...new Set([
      ...productOffers.map((offer) => String(offer.dslite_fornecedor_id || '').trim()),
      kitSource?.kind === 'ready' ? kitSource.source.supplierId : '',
    ].filter(Boolean))];
    const searchDocument = [
      product.sku, product.nome, product.gtin, product.marca, operationalSupplier,
      ...productOffers.flatMap((offer) => [offer.fornecedor_nome, offer.sku_oferta, offer.sku_fornecedor, offer.nome]),
      ...linkedListings.map((listing) => listing.itemId),
    ].filter(Boolean).join(' ');
    const pricingInconclusive = !pricingResult?.target?.ok;
    for (const generation of [...new Set(items.filter((item) => item.entity_key === product.id).map((item) => item.generation))]) {
      const queueItem = itemByProductAndGeneration.get(`${generation}:${product.id}`)!;
      rows.push({
        generation,
        product_id: product.id,
        sku: product.sku,
        product_name: product.nome,
        active: product.ativo !== false,
        supplier_ids: supplierIds,
        supplier_name: operationalSupplier,
        has_internal_stock: capacity.internal > 0,
        ml_status: projectedProduct.ml_status,
        safe_stock: capacity.safe,
        cost: view.cost,
        ml_fee: memory?.fee.amountCents == null ? null : memory.fee.amountCents / 100,
        ml_shipping: memory?.shipping.amountCents == null ? null : memory.shipping.amountCents / 100,
        suggested_price: view.suggestedPrice,
        profit: view.profit,
        margin_percent: view.margin,
        pricing_inconclusive: pricingInconclusive,
        search_document: searchDocument,
        payload,
        queue_version: queueItem.version,
        source_updated_at: maximumTimestamp([
          product.updated_at,
          ...productOffers.flatMap((offer) => [offer.updated_at, offer.last_sync_at]),
        ]),
      });
    }
  }
  return { rows, found };
}

function qualityPrimaryIssue(info: any) {
  if (!info || info.source !== 'mercado_livre_performance') return null;
  const tip = String(info.dica || '').trim();
  if (tip) return tip;
  const issues = Array.isArray(info.itens) ? info.itens : [];
  return issues
    .filter((issue: any) => issue?.ok !== true && String(issue?.nome || '').trim())
    .sort((left: any, right: any) => Number(left?.pontos || 0) - Number(right?.pontos || 0))[0]?.nome || null;
}

async function buildListingRows(
  client: Client,
  items: QueueItem[],
  requestContext: PricingRequestContext,
) {
  const itemIds = [...new Set(items.map((item) => item.entity_key))];
  if (!itemIds.length) return { rows: [], found: new Set<string>() };
  const [listingResult, snapshotResult, outboxResult] = await Promise.all([
    client.from('anuncios_ml').select('*').in('ml_item_id', itemIds),
    client.from('catalogo_ml_snapshot').select('*').in('ml_item_id', itemIds),
    client.from('anuncios_ml_outbox').select('id,ml_item_id,status,desired_status,desired_price,last_error,created_at')
      .in('ml_item_id', itemIds).order('created_at', { ascending: false }),
  ]);
  if (listingResult.error || snapshotResult.error || outboxResult.error) throw new Error('ui_listing_sources_failed');
  const listings = listingResult.data || [];
  const found = new Set(listings.map((listing) => listing.ml_item_id));
  const productIds = [...new Set(listings.flatMap((listing) => listing.produto_id ? [listing.produto_id] : []))];
  const productResult = productIds.length
    ? await client.from('produtos').select('*').in('id', productIds)
    : { data: [], error: null };
  if (productResult.error) throw new Error('ui_listing_products_failed');
  const products = new Map((productResult.data || []).map((product) => [product.id, product]));
  const snapshots = new Map((snapshotResult.data || []).map((snapshot) => [snapshot.ml_item_id, snapshot]));
  const latestOutbox = new Map<string, any>();
  for (const outbox of outboxResult.data || []) {
    if (outbox.ml_item_id && !latestOutbox.has(outbox.ml_item_id)) latestOutbox.set(outbox.ml_item_id, outbox);
  }

  const pricingByItem = new Map<string, ReturnType<typeof pricingView>>();
  const pending = [...listings];
  while (pending.length) {
    const batch: typeof listings = [];
    const used = new Set<string>();
    for (let index = 0; index < pending.length && batch.length < 100;) {
      const listing = pending[index];
      if (!listing.produto_id || !products.has(listing.produto_id)) {
        pricingByItem.set(listing.ml_item_id, pricingView(undefined));
        pending.splice(index, 1);
      } else if (used.has(listing.produto_id)) {
        index += 1;
      } else {
        used.add(listing.produto_id);
        batch.push(listing);
        pending.splice(index, 1);
      }
    }
    if (!batch.length) break;
    const evidence = new Map(batch.map((listing) => [listing.produto_id!, {
      mlItemId: listing.ml_item_id,
      currentPriceCents: Number(listing.preco_ml) > 0 ? Math.round(Number(listing.preco_ml) * 100) : null,
      marketContextKey: `listing:${listing.ml_item_id}:unquoted`,
    }]));
    const priced = await loadProductPricing(client, batch.map((listing) => products.get(listing.produto_id!)!), {
      requestContext,
      evidence,
    });
    for (const listing of batch) pricingByItem.set(listing.ml_item_id, pricingView(priced.get(listing.produto_id!)));
  }

  const rows: Record<string, unknown>[] = [];
  for (const listing of listings) {
    const snapshot: any = snapshots.get(listing.ml_item_id);
    const product: any = listing.produto_id ? products.get(listing.produto_id) : null;
    const catalogListing = Boolean(snapshot?.catalog_listing ?? listing.catalogo);
    const catalogStatus = resolveCatalogCompetitionStatus({
      catalogListing,
      buyBoxStatus: snapshot?.buy_box_status,
      buyBoxWinning: snapshot?.buy_box_winning,
    });
    const info: any = listing.qualidade_info;
    const qualityAvailable = info?.source === 'mercado_livre_performance';
    const observedStatus = normalizeListingStatus(snapshot?.status || listing.status);
    const priceToWin = snapshot?.price_to_win == null ? null : Number(snapshot.price_to_win);
    const priceReview = catalogListing && catalogStatus !== 'ganhando' && Number(priceToWin || 0) > 0;
    const outbox = latestOutbox.get(listing.ml_item_id);
    const priceView = pricingByItem.get(listing.ml_item_id) || pricingView(undefined);
    const payload: Record<string, unknown> = {
      itemId: listing.ml_item_id,
      productId: listing.produto_id,
      productSku: String(product?.sku || listing.sku || '').trim() || null,
      productName: String(product?.nome || listing.titulo || listing.ml_item_id),
      listingTitle: listing.titulo,
      thumbnail: listing.thumbnail || snapshot?.thumbnail || product?.imagens?.[0] || null,
      permalink: listing.permalink || snapshot?.permalink || null,
      listingType: catalogListing ? 'catalog' : 'standard',
      catalogProductId: snapshot?.catalog_product_id || null,
      relatedItemId: snapshot?.related_item_id || null,
      price: Number(listing.preco_ml || 0),
      profit: priceView.profit,
      marginPercent: priceView.margin,
      sold: Number(listing.vendidos || 0),
      visits: Number(listing.visitas || 0),
      qualityScore: qualityAvailable ? Number(listing.qualidade || 0) : null,
      qualityAvailable,
      qualityPrimaryIssue: qualityPrimaryIssue(info),
      qualityInfo: info || null,
      qualityUnavailableReason: qualityAvailable ? null : String(info?.reason || '').trim() || null,
      observedStatus,
      localStatus: listing.status,
      blockReason: listing.ml_sync_block_reason,
      blockedUntil: listing.ml_sync_blocked_until,
      lastError: listing.ml_sync_last_error,
      catalogStatus,
      priceToWin: Number(priceToWin || 0) > 0 ? priceToWin : null,
      catalogSyncedAt: snapshot?.synced_at || null,
      listingSyncedAt: listing.updated_at,
      isOperational: Boolean(product && listing.ml_item_id === product.ml_item_id),
      latestPublish: outbox ? {
        id: outbox.id,
        status: outbox.status,
        desiredStatus: outbox.desired_status,
        desiredPrice: outbox.desired_price,
        error: outbox.last_error,
        createdAt: outbox.created_at,
      } : null,
    };
    payload.publishEligibility = classifyMlPublishEligibility({
      observedStatus,
      blockReason: listing.ml_sync_block_reason,
      blockedUntil: listing.ml_sync_blocked_until,
    });
    const searchDocument = [payload.itemId, payload.productSku, payload.productName, payload.listingTitle].filter(Boolean).join(' ');
    for (const generation of [...new Set(items.filter((item) => item.entity_key === listing.ml_item_id).map((item) => item.generation))]) {
      const queueItem = items.find((item) => item.generation === generation && item.entity_key === listing.ml_item_id)!;
      rows.push({
        generation,
        item_id: listing.ml_item_id,
        product_id: listing.produto_id,
        product_sku: payload.productSku,
        product_name: payload.productName,
        listing_title: listing.titulo,
        observed_status: observedStatus,
        listing_type: payload.listingType,
        catalog_status: catalogStatus,
        price: payload.price,
        profit: priceView.profit,
        margin_percent: priceView.margin,
        sold: payload.sold,
        visits: payload.visits,
        quality_score: payload.qualityScore,
        quality_available: qualityAvailable,
        price_review: priceReview,
        search_document: searchDocument,
        payload,
        queue_version: queueItem.version,
        source_updated_at: maximumTimestamp([listing.updated_at, snapshot?.synced_at]),
      });
    }
  }
  return { rows, found };
}

async function acknowledge(client: Client, item: QueueItem) {
  await (client as any).rpc('complete_ui_read_model_item', {
    p_entity_kind: item.entity_kind,
    p_entity_key: item.entity_key,
    p_generation: item.generation,
    p_version: item.version,
    p_claim_token: item.claim_token,
  });
}

async function fail(client: Client, item: QueueItem, error: unknown) {
  await (client as any).rpc('fail_ui_read_model_item', {
    p_entity_kind: item.entity_kind,
    p_entity_key: item.entity_key,
    p_generation: item.generation,
    p_version: item.version,
    p_claim_token: item.claim_token,
    p_error: error instanceof Error ? error.message : String(error),
  });
}

export async function processUiReadModelBatch(
  client: Client = createServiceClient(),
  limit = 100,
) {
  const liveContext = await loadPricingRequestContext(client);
  const fingerprint = contextFingerprint(liveContext);
  let state = await readState(client);
  if ((state.status === 'ready' && state.context_fingerprint !== fingerprint)
      || (state.status === 'building' && state.build_context_fingerprint !== fingerprint)) {
    const rebuild = await (client as any).rpc('request_ui_read_model_rebuild', { p_reason: 'pricing_context_changed' });
    if (rebuild.error) throw new Error('ui_read_model_rebuild_request_failed');
    state = await readState(client);
  }
  if (state.status === 'requested') {
    const seeded = await (client as any).rpc('seed_ui_read_model_rebuild', {
      p_context_fingerprint: fingerprint,
      p_context: contextSnapshot(liveContext),
    });
    if (seeded.error) throw new Error('ui_read_model_rebuild_seed_failed');
    state = await readState(client);
  }
  const requestContext = contextFromSnapshot(
    state.status === 'building' ? state.build_context : state.context,
    liveContext,
  );

  const claimed = await (client as any).rpc('claim_ui_read_model_batch', { p_limit: limit });
  if (claimed.error) throw new Error('ui_read_model_claim_failed');
  const items = (claimed.data || []) as QueueItem[];
  if (!items.length) {
    if (state.status === 'building') {
      const activation = await (client as any).rpc('activate_ui_read_model_generation', {
        p_generation: state.target_generation,
        p_context_fingerprint: state.build_context_fingerprint || fingerprint,
        p_context: state.build_context || contextSnapshot(requestContext),
      });
      if (activation.error) throw new Error(activation.error.message || 'ui_read_model_activation_failed');
      return { processed: 0, pending: 0, activated: true, generation: state.target_generation };
    }
    return { processed: 0, pending: 0, activated: false, generation: state.active_generation };
  }

  let processed = 0;
  for (const kind of ['product', 'listing'] as const) {
    const kindItems = items.filter((item) => item.entity_kind === kind);
    if (!kindItems.length) continue;
    try {
      const built = kind === 'product'
        ? await buildProductRows(client, kindItems, requestContext)
        : await buildListingRows(client, kindItems, requestContext);
      const upsert = await (client as any).rpc(
        kind === 'product' ? 'upsert_ui_product_projections' : 'upsert_ui_listing_projections',
        { p_rows: built.rows },
      );
      if (upsert.error) throw new Error(upsert.error.message || 'ui_read_model_upsert_failed');
      for (const item of kindItems) {
        if (!built.found.has(item.entity_key)) {
          const deleted = await (client as any).rpc('delete_ui_projection_if_version', {
            p_entity_kind: item.entity_kind,
            p_entity_key: item.entity_key,
            p_generation: item.generation,
            p_version: item.version,
          });
          if (deleted.error) throw new Error(deleted.error.message || 'ui_read_model_delete_failed');
        }
        await acknowledge(client, item);
        processed += 1;
      }
    } catch (error) {
      await Promise.all(kindItems.map((item) => fail(client, item, error)));
      throw error;
    }
  }
  return { processed, pending: null, activated: false, generation: state.target_generation };
}

export async function drainUiReadModel(options: {
  client?: Client;
  batchSize?: number;
  maxDurationMs?: number;
} = {}) {
  const client = options.client || createServiceClient();
  const deadline = Date.now() + (options.maxDurationMs ?? 240_000);
  let processed = 0;
  let batches = 0;
  let last: Awaited<ReturnType<typeof processUiReadModelBatch>> | null = null;
  while (Date.now() < deadline) {
    last = await processUiReadModelBatch(client, options.batchSize ?? 100);
    processed += last.processed;
    batches += 1;
    if (last.activated || last.processed === 0) break;
  }
  return { processed, batches, last, timeBudgetReached: Date.now() >= deadline };
}
