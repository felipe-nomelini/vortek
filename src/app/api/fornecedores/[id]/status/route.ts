import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { fetchAllRowsPaginated } from '@/lib/produto-filtering';
import { syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { classifySupplierDeactivationProducts } from '@/lib/supplier-deactivation';

export const maxDuration = 300;

type ImpactProduct = {
  id: string;
  sku: string | null;
  ml_item_id: string | null;
  ativo: boolean | null;
};

type ImpactOffer = {
  id: string;
  ativo: boolean | null;
};

const SUPABASE_IN_FILTER_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toPublicError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

async function loadFornecedor(client: any, id: string) {
  const { data, error } = await client
    .from('fornecedores')
    .select('id,dslite_id,apelido,ativo,dropshipping_retired_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function loadImpactedProducts(client: any, dsliteFornecedorId: string): Promise<ImpactProduct[]> {
  if (!dsliteFornecedorId) return [];

  const offers = await fetchAllRowsPaginated<{ produto_id: string | null }>((from, to) => (
    client
      .from('produto_fornecedor_ofertas')
      .select('produto_id')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .not('produto_id', 'is', null)
      .range(from, to)
  ));

  const productIds = new Set<string>();
  for (const offer of offers) {
    const productId = String(offer.produto_id || '').trim();
    if (productId) productIds.add(productId);
  }

  const legacyProducts = await fetchAllRowsPaginated<ImpactProduct>((from, to) => (
    client
      .from('produtos')
      .select('id,sku,ml_item_id,ativo,ml_status')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .range(from, to)
  ));

  for (const product of legacyProducts) {
    const productId = String(product.id || '').trim();
    if (productId) productIds.add(productId);
  }

  const ids = Array.from(productIds);
  if (ids.length === 0) return [];

  const products: ImpactProduct[] = [];
  for (const idsChunk of chunk(ids, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('produtos')
      .select('id,sku,ml_item_id,ativo,ml_status')
      .in('id', idsChunk);

    if (error) throw new Error(error.message);
    products.push(...((data || []) as ImpactProduct[]));
  }

  return products;
}

async function loadImpactedOffers(client: any, dsliteFornecedorId: string): Promise<ImpactOffer[]> {
  if (!dsliteFornecedorId) return [];

  return fetchAllRowsPaginated<ImpactOffer>((from, to) => (
    client
      .from('produto_fornecedor_ofertas')
      .select('id,ativo')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .range(from, to)
  ));
}

async function loadProductIdsWithAlternativeStock(
  client: any,
  productIds: string[],
  disabledFornecedorId: string,
): Promise<Set<string>> {
  const alternatives = new Set<string>();
  const operationalSupplierIds = await loadOperationalDropshippingSupplierIds(client);

  for (const idsChunk of chunk(productIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('produto_fornecedor_ofertas')
      .select('produto_id,dslite_fornecedor_id')
      .in('produto_id', idsChunk)
      .neq('dslite_fornecedor_id', disabledFornecedorId)
      .eq('ativo', true)
      .gt('estoque', 0);

    if (error) throw new Error(error.message);
    for (const offer of data || []) {
      if (!operationalSupplierIds.has(String((offer as any).dslite_fornecedor_id || '').trim())) {
        continue;
      }
      const productId = String((offer as any).produto_id || '').trim();
      if (productId) alternatives.add(productId);
    }
  }

  return alternatives;
}

async function loadMlListingTargets(
  client: any,
  products: ImpactProduct[],
): Promise<Map<string, string[]>> {
  const targetsByProductId = new Map<string, string[]>();
  for (const product of products) {
    const itemId = String(product.ml_item_id || '').trim();
    targetsByProductId.set(product.id, itemId ? [itemId] : []);
  }

  for (const idsChunk of chunk(products.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const [listingResult, snapshotResult] = await Promise.all([
      client
        .from('anuncios_ml')
        .select('produto_id,ml_item_id')
        .in('produto_id', idsChunk),
      client
        .from('catalogo_ml_snapshot')
        .select('produto_id,ml_item_id')
        .in('produto_id', idsChunk),
    ]);
    if (listingResult.error) throw new Error(listingResult.error.message);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    for (const row of [...(listingResult.data || []), ...(snapshotResult.data || [])]) {
      const productId = String((row as any).produto_id || '').trim();
      const itemId = String((row as any).ml_item_id || '').trim();
      if (!productId || !itemId) continue;
      const targets = targetsByProductId.get(productId) || [];
      if (!targets.includes(itemId)) targets.push(itemId);
      targetsByProductId.set(productId, targets);
    }
  }

  return targetsByProductId;
}

function buildImpact(
  products: ImpactProduct[],
  offers: ImpactOffer[],
  alternativeProductIds = new Set<string>(),
  internalStockProductIds = new Set<string>(),
  listingTargets = new Map<string, string[]>(),
) {
  const activeProducts = products.filter((product) => product.ativo !== false);
  const activeOffers = offers.filter((offer) => offer.ativo !== false);
  const productsWithAlternativeStock = activeProducts.filter((product) => alternativeProductIds.has(product.id));
  const transition = classifySupplierDeactivationProducts(
    products,
    alternativeProductIds,
    internalStockProductIds,
  );
  return {
    products_found: products.length,
    products_active: activeProducts.length,
    products_already_inactive: products.length - activeProducts.length,
    supplier_offers_found: offers.length,
    supplier_offers_active: activeOffers.length,
    supplier_offers_already_inactive: offers.length - activeOffers.length,
    products_with_alternative_stock: productsWithAlternativeStock.length,
    products_with_internal_stock: transition.withInternalStock.length,
    products_kept_only_by_internal_stock: transition.keptOnlyByInternalStock.length,
    products_without_available_source: transition.withoutAvailableSource.length,
    ml_delete_candidates: transition.withoutAvailableSource.reduce(
      (total, product) => total + (listingTargets.get(product.id)?.length || 0),
      0,
    ),
  };
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await authorizeApiRequest(request, 'suppliers.manage');
  if (!auth.ok) return auth.response;

  try {
    const client = createServiceClient();
    const fornecedor = await loadFornecedor(client, params.id);
    if (!fornecedor) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    const dsliteFornecedorId = String(fornecedor.dslite_id || '').trim();
    const [products, offers] = await Promise.all([
      loadImpactedProducts(client, dsliteFornecedorId),
      loadImpactedOffers(client, dsliteFornecedorId),
    ]);
    const productIds = products.map((product) => product.id);
    const [alternativeProductIds, capacitiesByProduct] = await Promise.all([
      loadProductIdsWithAlternativeStock(client, productIds, dsliteFornecedorId),
      loadProductFulfillmentCapacities(client, productIds),
    ]);
    const internalStockProductIds = new Set(
      Array.from(capacitiesByProduct.entries())
        .filter(([, capacity]) => capacity.internal > 0)
        .map(([productId]) => productId),
    );
    const listingTargets = await loadMlListingTargets(client, products);
    return NextResponse.json({
      fornecedor,
      impact: buildImpact(
        products,
        offers,
        alternativeProductIds,
        internalStockProductIds,
        listingTargets,
      ),
    });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao calcular impacto do fornecedor') }, { status: 500 });
  }
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await authorizeApiRequest(req, 'suppliers.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.ativo !== 'boolean') {
      return NextResponse.json({ error: 'Campo ativo deve ser booleano' }, { status: 422 });
    }

    const client = createServiceClient();
    const fornecedor = await loadFornecedor(client, params.id);
    if (!fornecedor) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    if (
      body.ativo &&
      fornecedor.dropshipping_retired_at
    ) {
      return NextResponse.json(
        {
          error:
            'Fornecedor bloqueado pela política de dropshipping e não pode ser ativado.',
        },
        { status: 422 },
      );
    }

    const { error: updateFornecedorError } = await client
      .from('fornecedores')
      .update({ ativo: body.ativo } as any)
      .eq('id', params.id);

    if (updateFornecedorError) {
      return NextResponse.json({ error: updateFornecedorError.message }, { status: 500 });
    }

    if (body.ativo) {
      return NextResponse.json({
        success: true,
        fornecedor_id: params.id,
        ativo: true,
        records: {
          products_found: 0,
          products_inactivated: 0,
          ml_delete_enqueued: 0,
          ml_delete_updated_existing: 0,
          ml_delete_skipped_no_item: 0,
          ml_delete_failed: 0,
          supplier_offers_found: 0,
          supplier_offers_inactivated: 0,
        },
      });
    }

    const dsliteFornecedorId = String(fornecedor.dslite_id || '').trim();
    const [products, offers] = await Promise.all([
      loadImpactedProducts(client, dsliteFornecedorId),
      loadImpactedOffers(client, dsliteFornecedorId),
    ]);
    const activeProducts = products.filter((product) => product.ativo !== false);
    const activeOfferIds = offers
      .filter((offer) => offer.ativo !== false)
      .map((offer) => offer.id);

    let supplierOffersInactivated = 0;
    for (const idsChunk of chunk(activeOfferIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produto_fornecedor_ofertas')
        .update({ ativo: false, estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      supplierOffersInactivated += idsChunk.length;
    }

    const productIds = products.map((product) => product.id);
    const [alternativeProductIds, capacitiesBeforeSnapshot] = await Promise.all([
      loadProductIdsWithAlternativeStock(client, productIds, dsliteFornecedorId),
      loadProductFulfillmentCapacities(client, productIds),
    ]);
    const internalStockProductIds = new Set(
      Array.from(capacitiesBeforeSnapshot.entries())
        .filter(([, capacity]) => capacity.internal > 0)
        .map(([productId]) => productId),
    );
    const transition = classifySupplierDeactivationProducts(
      products,
      alternativeProductIds,
      internalStockProductIds,
    );
    const productsWithAlternativeStock = activeProducts.filter((product) => alternativeProductIds.has(product.id));
    const productsKeptOnlyByInternalStock = transition.keptOnlyByInternalStock;
    const productsToDelete = transition.withoutAvailableSource;
    const listingTargets = await loadMlListingTargets(client, productsToDelete);

    let productsReassigned = 0;
    const preferredSnapshots: Awaited<ReturnType<typeof syncPreferredProductSnapshot>> = [];
    for (const idsChunk of chunk(productsWithAlternativeStock.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const snapshots = await syncPreferredProductSnapshot(client, idsChunk);
      preferredSnapshots.push(...snapshots);
      productsReassigned += snapshots.filter((snapshot) => snapshot.changed).length;
    }

    let productsKeptInternal = 0;
    for (const idsChunk of chunk(productsKeptOnlyByInternalStock.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      productsKeptInternal += idsChunk.length;
    }

    let productsMlMarkedWithoutListing = 0;
    for (const idsChunk of chunk(productsToDelete.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ ml_status: 'sem_anuncio', estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      productsMlMarkedWithoutListing += idsChunk.length;
    }

    let mlDeleteEnqueued = 0;
    let mlDeleteUpdatedExisting = 0;
    let mlDeleteReopenedFailed = 0;
    let mlDeleteUnchanged = 0;
    let mlDeleteSkippedNoItem = 0;
    let mlDeleteFailed = 0;
    let mlDeleteCancelledInternalStock = 0;
    let mlStockEnqueued = 0;
    let mlStockUnchanged = 0;
    let mlStockSkippedIneligible = 0;
    let mlStockBlockedManually = 0;
    let mlStockFailed = 0;
    let mlPriceProductsUpdated = 0;
    let mlPriceOutboxEnqueued = 0;
    let mlPriceFailed = 0;
    const errors: Array<{ product_id: string; sku: string; ml_item_id: string; error: string }> = [];

    for (const idsChunk of chunk(
      transition.withInternalStock.map((product) => product.id),
      SUPABASE_IN_FILTER_CHUNK_SIZE,
    )) {
      const { data: cancelled, error } = await (client as any)
        .from('anuncios_ml_outbox')
        .update({
          status: 'cancelled',
          last_error: 'Cancelado: produto preservado pela capacidade do estoque interno.',
          updated_at: new Date().toISOString(),
        })
        .in('produto_id', idsChunk)
        .eq('source', 'fornecedor_inativo_delete')
        .in('status', ['pending', 'retry', 'processing', 'failed'])
        .select('id');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      mlDeleteCancelledInternalStock += cancelled?.length || 0;
    }

    try {
      const automaticPricing = await enqueueAutomaticPricesForCostChanges(client, preferredSnapshots);
      mlPriceProductsUpdated = automaticPricing.productsUpdated;
      mlPriceOutboxEnqueued = automaticPricing.outboxEnqueued;
      mlPriceFailed = automaticPricing.errors.length;
      for (const priceError of automaticPricing.errors) {
        const snapshot = preferredSnapshots.find((item) => item.productId === priceError.productId);
        errors.push({
          product_id: priceError.productId,
          sku: snapshot?.previous.sku || '',
          ml_item_id: snapshot?.previous.ml_item_id || '',
          error: `Preço automático: ${priceError.message}`,
        });
      }
    } catch (error) {
      mlPriceFailed = 1;
      errors.push({
        product_id: '',
        sku: '',
        ml_item_id: '',
        error: `Preço automático: ${toPublicError(error, 'falha ao recalcular preços')}`,
      });
    }

    for (const product of productsToDelete) {
      const sku = String(product.sku || '').trim();
      const itemIds = listingTargets.get(product.id) || [];
      if (itemIds.length === 0) {
        mlDeleteSkippedNoItem += 1;
        continue;
      }

      for (const mlItemId of itemIds) {
        const outbox = await enqueueMlPublishOutbox(client, {
          produtoId: product.id,
          mlItemId,
          desiredStatus: null,
          desiredQuantity: null,
          desiredPrice: null,
          source: 'fornecedor_inativo_delete',
          dedupePending: true,
          payload: {
            delete_listing: true,
            apply_price: false,
            apply_quantity_pricing: false,
            apply_quantity: false,
            apply_status: false,
            fornecedor_id: params.id,
            fornecedor_dslite_id: String(fornecedor.dslite_id || ''),
            fornecedor_apelido: String(fornecedor.apelido || ''),
            sku,
            origin: 'api/fornecedores/[id]/status',
          },
        });

        if (!outbox.ok) {
          mlDeleteFailed += 1;
          errors.push({ product_id: product.id, sku, ml_item_id: mlItemId, error: outbox.error });
        } else if (outbox.action === 'updated_existing') {
          mlDeleteUpdatedExisting += 1;
        } else if (outbox.action === 'reopened_failed') {
          mlDeleteReopenedFailed += 1;
        } else if (outbox.action === 'unchanged') {
          mlDeleteUnchanged += 1;
        } else {
          mlDeleteEnqueued += 1;
        }
      }
    }

    const capacitiesByProduct = await loadProductFulfillmentCapacities(
      client,
      preferredSnapshots.map((snapshot) => String(snapshot.productId)),
    );
    for (const snapshot of preferredSnapshots) {
      if (!snapshot.changed || !snapshot.previous.ml_item_id) continue;
      const capacity = capacitiesByProduct.get(String(snapshot.productId))
        || { internal: 0, supplier: 0, safe: 0 };

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: snapshot.productId,
        mlItemId: snapshot.previous.ml_item_id,
        desiredStatus: null,
        desiredQuantity: capacity.safe,
        desiredPrice: null,
        source: 'fornecedor_inativo_alternativa',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: false,
          fornecedor_id: params.id,
          fornecedor_dslite_id: String(fornecedor.dslite_id || ''),
          estoque_fornecedor: capacity.supplier,
          estoque_interno: capacity.internal,
          estoque_disponivel: capacity.safe,
          origin: 'api/fornecedores/[id]/status',
        },
      });

      if (!outbox.ok) {
        mlStockFailed += 1;
        errors.push({
          product_id: snapshot.productId,
          sku: snapshot.previous.sku,
          ml_item_id: snapshot.previous.ml_item_id,
          error: outbox.error,
        });
      } else if (outbox.action === 'unchanged') {
        mlStockUnchanged += 1;
      } else if (outbox.action === 'skipped_ineligible') {
        mlStockSkippedIneligible += 1;
      } else {
        mlStockEnqueued += 1;
      }
    }

    for (const product of transition.withInternalStock) {
      try {
        const result = await enfileirarSyncMlEstoqueInterno(product.id);
        mlStockEnqueued += result.enfileirados;
        mlStockUnchanged += result.semAlteracao;
        mlStockBlockedManually += result.bloqueadosManualmente;
      } catch (error) {
        mlStockFailed += 1;
        errors.push({
          product_id: product.id,
          sku: String(product.sku || ''),
          ml_item_id: String(product.ml_item_id || ''),
          error: toPublicError(error, 'Falha ao sincronizar a capacidade do estoque interno'),
        });
      }
    }

    return NextResponse.json({
      success: mlDeleteFailed === 0 && mlStockFailed === 0 && mlPriceFailed === 0,
      fornecedor_id: params.id,
      ativo: false,
      records: {
        products_found: products.length,
        products_with_alternative_stock: productsWithAlternativeStock.length,
        products_with_internal_stock: transition.withInternalStock.length,
        products_kept_only_by_internal_stock: productsKeptInternal,
        products_without_available_source: transition.withoutAvailableSource.length,
        products_reassigned: productsReassigned,
        products_inactivated: 0,
        products_ml_marked_without_listing: productsMlMarkedWithoutListing,
        supplier_offers_found: offers.length,
        supplier_offers_inactivated: supplierOffersInactivated,
        ml_delete_enqueued: mlDeleteEnqueued,
        ml_delete_updated_existing: mlDeleteUpdatedExisting,
        ml_delete_reopened_failed: mlDeleteReopenedFailed,
        ml_delete_unchanged: mlDeleteUnchanged,
        ml_delete_skipped_no_item: mlDeleteSkippedNoItem,
        ml_delete_failed: mlDeleteFailed,
        ml_delete_cancelled_internal_stock: mlDeleteCancelledInternalStock,
        ml_stock_enqueued: mlStockEnqueued,
        ml_stock_unchanged: mlStockUnchanged,
        ml_stock_skipped_ineligible: mlStockSkippedIneligible,
        ml_stock_blocked_manually: mlStockBlockedManually,
        ml_stock_failed: mlStockFailed,
        ml_price_products_updated: mlPriceProductsUpdated,
        ml_price_outbox_enqueued: mlPriceOutboxEnqueued,
        ml_price_failed: mlPriceFailed,
      },
      errors,
    }, { status: mlDeleteFailed === 0 && mlStockFailed === 0 && mlPriceFailed === 0 ? 200 : 207 });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao atualizar fornecedor') }, { status: 500 });
  }
}
