import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchAllRowsPaginated } from '@/lib/produto-filtering';
import { syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { isBlockedDropshippingDsliteSupplier } from '@/lib/dslite/supplier-policy';
import { calcularSaldoEstoqueInterno } from '@/lib/estoque-interno-saldo';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import {
  classifySupplierDeactivationProducts,
  isActiveSupplierListingStatus,
  shouldSkipExistingSupplierPause,
  supplierPauseOperationKey,
} from '@/lib/supplier-deactivation';

export const maxDuration = 300;

type ImpactProduct = {
  id: string;
  sku: string | null;
  ml_item_id: string | null;
  ativo: boolean | null;
  ml_status?: string | null;
};

type ImpactOffer = {
  id: string;
  ativo: boolean | null;
  estoque: number | null;
};

type MlListingTarget = {
  mlItemId: string;
  status: string;
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

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function loadFornecedor(client: any, id: string) {
  const { data, error } = await client
    .from('fornecedores')
    .select('id,dslite_id,apelido,ativo')
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
      .order('id', { ascending: true })
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
      .order('id', { ascending: true })
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
      .select('id,ativo,estoque')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .order('id', { ascending: true })
      .range(from, to)
  ));
}

async function loadProductIdsWithAlternativeStock(
  client: any,
  productIds: string[],
  disabledFornecedorId: string,
): Promise<Set<string>> {
  const alternatives = new Set<string>();

  for (const idsChunk of chunk(productIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const offers = await fetchAllRowsPaginated<{ id: string; produto_id: string | null }>((from, to) => (
      client
        .from('produto_fornecedor_ofertas')
        .select('id,produto_id')
        .in('produto_id', idsChunk)
        .neq('dslite_fornecedor_id', disabledFornecedorId)
        .eq('ativo', true)
        .gt('estoque', 0)
        .order('id', { ascending: true })
        .range(from, to)
    ));

    for (const offer of offers) {
      const productId = String((offer as any).produto_id || '').trim();
      if (productId) alternatives.add(productId);
    }
  }

  return alternatives;
}

async function loadProductIdsWithInternalStock(
  client: any,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const targetProductIds = new Set(productIds);
  const movements = await fetchAllRowsPaginated<any>((from, to) => (
    client
      .from('estoque_interno_movimentacoes')
      .select('id,produto_id,tipo,quantidade,situacao_estoque,estornada_em')
      .order('id', { ascending: true })
      .range(from, to)
  ));

  const byProductId = new Map<string, any[]>();
  for (const movement of movements) {
    const productId = String(movement.produto_id || '').trim();
    if (!productId || !targetProductIds.has(productId)) continue;
    const list = byProductId.get(productId) || [];
    list.push(movement);
    byProductId.set(productId, list);
  }

  return new Set(
    Array.from(byProductId.entries())
      .filter(([, productMovements]) => calcularSaldoEstoqueInterno(productMovements) > 0)
      .map(([productId]) => productId),
  );
}

async function loadMlListingTargets(
  client: any,
  products: ImpactProduct[],
): Promise<Map<string, MlListingTarget[]>> {
  const targetsByProductId = new Map<string, MlListingTarget[]>();
  for (const product of products) {
    const itemId = String(product.ml_item_id || '').trim();
    targetsByProductId.set(product.id, itemId ? [{
      mlItemId: itemId,
      status: String((product as any).ml_status || '') === 'ativo' ? 'active' : 'paused',
    }] : []);
  }

  for (const idsChunk of chunk(products.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const [listingResult, snapshotResult] = await Promise.all([
      client
        .from('anuncios_ml')
        .select('produto_id,ml_item_id,status')
        .in('produto_id', idsChunk),
      client
        .from('catalogo_ml_snapshot')
        .select('produto_id,ml_item_id,status')
        .in('produto_id', idsChunk),
    ]);
    if (listingResult.error) throw new Error(listingResult.error.message);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    for (const row of [...(listingResult.data || []), ...(snapshotResult.data || [])]) {
      const productId = String((row as any).produto_id || '').trim();
      const itemId = String((row as any).ml_item_id || '').trim();
      if (!productId || !itemId) continue;
      const targets = targetsByProductId.get(productId) || [];
      const existing = targets.find((target) => target.mlItemId === itemId);
      const status = String((row as any).status || '').trim().toLowerCase();
      if (existing) {
        if (status) existing.status = status === 'ativo' ? 'active' : status === 'pausado' ? 'paused' : status;
      } else {
        targets.push({ mlItemId: itemId, status });
      }
      targetsByProductId.set(productId, targets);
    }
  }

  return targetsByProductId;
}

async function loadExistingSupplierPauseKeys(
  client: any,
  products: ImpactProduct[],
  dsliteFornecedorId: string,
  reprocess: boolean,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const productIds = products.map((product) => product.id);
  if (productIds.length === 0) return keys;

  const statuses = reprocess
    ? ['pending', 'retry', 'processing', 'done']
    : ['pending', 'retry', 'processing'];

  for (const idsChunk of chunk(productIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const rows = await fetchAllRowsPaginated<{
      id: string;
      produto_id: string;
      ml_item_id: string;
      payload: Record<string, unknown> | null;
      status: string;
    }>((from, to) => (
      client
        .from('anuncios_ml_outbox')
        .select('id,produto_id,ml_item_id,payload,status')
        .in('produto_id', idsChunk)
        .eq('source', 'fornecedor_inativo_pause')
        .in('status', statuses)
        .order('id', { ascending: true })
        .range(from, to)
    ));

    for (const row of rows) {
      const rowSupplierId = String(row.payload?.fornecedor_dslite_id || '').trim();
      if (rowSupplierId !== dsliteFornecedorId) continue;
      if (!shouldSkipExistingSupplierPause(row.status, reprocess)) continue;
      keys.add(supplierPauseOperationKey(row.produto_id, row.ml_item_id));
    }
  }

  return keys;
}

function buildImpact(
  products: ImpactProduct[],
  offers: ImpactOffer[],
  alternativeProductIds = new Set<string>(),
  internalStockProductIds = new Set<string>(),
  listingTargets = new Map<string, MlListingTarget[]>(),
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
    products_without_available_source: transition.withoutAvailableSource.length,
    ml_pause_candidates: transition.withoutAvailableSource.reduce(
      (total, product) => total + (listingTargets.get(product.id) || []).filter((target) => (
        isActiveSupplierListingStatus(target.status)
      )).length,
      0,
    ),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

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
    const [alternativeProductIds, internalStockProductIds] = await Promise.all([
      loadProductIdsWithAlternativeStock(
        client,
        products.map((product) => product.id),
        dsliteFornecedorId,
      ),
      loadProductIdsWithInternalStock(client, products.map((product) => product.id)),
    ]);
    const listingTargets = await loadMlListingTargets(client, products);
    return NextResponse.json({
      fornecedor,
      impact: buildImpact(products, offers, alternativeProductIds, internalStockProductIds, listingTargets),
    });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao calcular impacto do fornecedor') }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.ativo !== 'boolean') {
      return NextResponse.json({ error: 'Campo ativo deve ser booleano' }, { status: 422 });
    }
    if (body?.reprocess !== undefined && typeof body.reprocess !== 'boolean') {
      return NextResponse.json({ error: 'Campo reprocess deve ser booleano' }, { status: 422 });
    }
    const reprocess = body.reprocess === true;

    const client = createServiceClient();
    const fornecedor = await loadFornecedor(client, params.id);
    if (!fornecedor) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    if (reprocess && (body.ativo || fornecedor.ativo !== false)) {
      return NextResponse.json(
        { error: 'O reprocessamento só é permitido para fornecedor já inativo, com ativo=false.' },
        { status: 422 },
      );
    }

    if (!reprocess && !body.ativo && fornecedor.ativo === false) {
      return NextResponse.json(
        { error: 'Fornecedor já está inativo. Use reprocess=true para executar novamente a transição.' },
        { status: 409 },
      );
    }

    if (
      body.ativo &&
      isBlockedDropshippingDsliteSupplier(fornecedor.dslite_id)
    ) {
      return NextResponse.json(
        {
          error:
            'EVOLUSOM-ES não trabalha com dropshipping e não pode ser ativado.',
        },
        { status: 422 },
      );
    }

    if (!reprocess) {
      const { error: updateFornecedorError } = await client
        .from('fornecedores')
        .update({ ativo: body.ativo } as any)
        .eq('id', params.id);

      if (updateFornecedorError) {
        return NextResponse.json({ error: updateFornecedorError.message }, { status: 500 });
      }
    }

    if (body.ativo) {
      return NextResponse.json({
        success: true,
        fornecedor_id: params.id,
        ativo: true,
        records: {
          products_found: 0,
          products_inactivated: 0,
          ml_pause_enqueued: 0,
          ml_pause_skipped_no_item: 0,
          ml_pause_failed: 0,
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
    const supplierOffersInactivated = offers.filter((offer) => (
      offer.ativo !== false || Number(offer.estoque || 0) !== 0
    )).length;

    const { error: updateOffersError } = await client
      .from('produto_fornecedor_ofertas')
      .update({ ativo: false, estoque: 0 } as any)
      .eq('dslite_fornecedor_id', dsliteFornecedorId);

    if (updateOffersError) {
      return NextResponse.json({ error: updateOffersError.message }, { status: 500 });
    }

    const [activeOffersVerification, stockedOffersVerification] = await Promise.all([
      client
        .from('produto_fornecedor_ofertas')
        .select('id', { count: 'exact', head: true })
        .eq('dslite_fornecedor_id', dsliteFornecedorId)
        .eq('ativo', true),
      client
        .from('produto_fornecedor_ofertas')
        .select('id', { count: 'exact', head: true })
        .eq('dslite_fornecedor_id', dsliteFornecedorId)
        .gt('estoque', 0),
    ]);
    if (activeOffersVerification.error) throw new Error(activeOffersVerification.error.message);
    if (stockedOffersVerification.error) throw new Error(stockedOffersVerification.error.message);

    const supplierOffersStillActive = Number(activeOffersVerification.count || 0);
    const supplierOffersStillStocked = Number(stockedOffersVerification.count || 0);
    if (supplierOffersStillActive > 0 || supplierOffersStillStocked > 0) {
      throw new Error(
        `Falha ao confirmar inativação das ofertas: ${supplierOffersStillActive} ativas e ${supplierOffersStillStocked} com estoque.`,
      );
    }

    const productIds = products.map((product) => product.id);
    const [alternativeProductIds, internalStockProductIds] = await Promise.all([
      loadProductIdsWithAlternativeStock(client, productIds, dsliteFornecedorId),
      loadProductIdsWithInternalStock(client, productIds),
    ]);
    const transition = classifySupplierDeactivationProducts(
      products,
      alternativeProductIds,
      internalStockProductIds,
    );
    const productsWithAlternativeStock = activeProducts.filter((product) => alternativeProductIds.has(product.id));
    const productsWithInternalStock = transition.withInternalStock;
    const productsKeptOnlyByInternalStock = productsWithInternalStock.filter((product) => (
      product.ativo !== false && !alternativeProductIds.has(product.id)
    ));
    const productsWithoutAvailableSource = transition.withoutAvailableSource;
    const activeProductsWithoutAvailableSource = transition.activeWithoutAvailableSource;
    const listingTargets = await loadMlListingTargets(client, productsWithoutAvailableSource);
    const existingSupplierPauseKeys = await loadExistingSupplierPauseKeys(
      client,
      productsWithoutAvailableSource,
      dsliteFornecedorId,
      reprocess,
    );

    let productsReassigned = 0;
    const preferredSnapshots: Awaited<ReturnType<typeof syncPreferredProductSnapshot>> = [];
    for (const idsChunk of chunk(productsWithAlternativeStock.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const snapshots = await syncPreferredProductSnapshot(client, idsChunk);
      preferredSnapshots.push(...snapshots);
      productsReassigned += snapshots.filter((snapshot) => snapshot.changed).length;
    }

    let productsInactivated = 0;
    for (const idsChunk of chunk(productsWithoutAvailableSource.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ ativo: false, estoque: 0, ml_status: 'pausado' } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    productsInactivated = activeProductsWithoutAvailableSource.length;

    let productsKeptInternal = 0;
    for (const idsChunk of chunk(productsKeptOnlyByInternalStock.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ ativo: true, estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      productsKeptInternal += idsChunk.length;
    }

    let staleDeleteOutboxCancelled = 0;
    for (const idsChunk of chunk(products.map((product) => product.id), SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { data: cancelled, error } = await (client as any)
        .from('anuncios_ml_outbox')
        .update({
          status: 'cancelled',
          last_error: 'Cancelado: a inativação do fornecedor agora pausa o anúncio em vez de excluí-lo.',
          updated_at: new Date().toISOString(),
        })
        .in('produto_id', idsChunk)
        .eq('source', 'fornecedor_inativo_delete')
        .in('status', ['pending', 'retry', 'processing', 'failed'])
        .select('id');
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      staleDeleteOutboxCancelled += cancelled?.length || 0;
    }

    let mlPauseEnqueued = 0;
    let mlPauseSkippedNoItem = 0;
    let mlPauseSkippedNonActive = 0;
    let mlPauseSkippedExisting = 0;
    let mlPauseFailed = 0;
    let mlStockEnqueued = 0;
    let mlStockFailed = 0;
    let mlPriceProductsUpdated = 0;
    let mlPriceOutboxEnqueued = 0;
    let mlPriceFailed = 0;
    const errors: Array<{ product_id: string; sku: string; ml_item_id: string; error: string }> = [];

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

    for (const product of productsWithoutAvailableSource) {
      const sku = String(product.sku || '').trim();
      const targets = listingTargets.get(product.id) || [];
      if (targets.length === 0) {
        mlPauseSkippedNoItem += 1;
        continue;
      }

      for (const target of targets) {
        if (!isActiveSupplierListingStatus(target.status)) {
          mlPauseSkippedNonActive += 1;
          continue;
        }
        const mlItemId = target.mlItemId;
        const operationKey = supplierPauseOperationKey(product.id, mlItemId);
        if (existingSupplierPauseKeys.has(operationKey)) {
          mlPauseSkippedExisting += 1;
          continue;
        }
        const outbox = await enqueueMlPublishOutbox(client, {
          produtoId: product.id,
          mlItemId,
          desiredStatus: 'pausado',
          desiredQuantity: 0,
          desiredPrice: null,
          source: 'fornecedor_inativo_pause',
          payload: {
            delete_listing: false,
            apply_price: false,
            apply_quantity_pricing: false,
            apply_quantity: true,
            apply_status: true,
            fornecedor_id: params.id,
            fornecedor_dslite_id: String(fornecedor.dslite_id || ''),
            fornecedor_apelido: String(fornecedor.apelido || ''),
            sku,
            previous_status: target.status,
            reactivate_on_internal_stock: true,
            origin: 'api/fornecedores/[id]/status',
          },
        });

        if (!outbox.ok) {
          mlPauseFailed += 1;
          errors.push({ product_id: product.id, sku, ml_item_id: mlItemId, error: outbox.error });
        } else {
          mlPauseEnqueued += 1;
          existingSupplierPauseKeys.add(operationKey);
        }
      }
    }

    for (const snapshot of preferredSnapshots) {
      if (!snapshot.changed || !snapshot.previous.ml_item_id) continue;

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: snapshot.productId,
        mlItemId: snapshot.previous.ml_item_id,
        desiredStatus: null,
        desiredQuantity: snapshot.next.estoque,
        desiredPrice: null,
        source: 'fornecedor_inativo_alternativa',
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: false,
          fornecedor_id: params.id,
          fornecedor_dslite_id: String(fornecedor.dslite_id || ''),
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
      } else {
        mlStockEnqueued += 1;
      }
    }

    for (const product of productsWithInternalStock) {
      try {
        const sync = await enfileirarSyncMlEstoqueInterno(product.id);
        mlStockEnqueued += sync.enfileirados;
      } catch (error) {
        mlStockFailed += 1;
        errors.push({
          product_id: product.id,
          sku: String(product.sku || ''),
          ml_item_id: String(product.ml_item_id || ''),
          error: `Estoque interno: ${toPublicError(error, 'falha ao sincronizar estoque')}`,
        });
      }
    }

    return NextResponse.json({
      success: mlPauseFailed === 0 && mlStockFailed === 0 && mlPriceFailed === 0,
      fornecedor_id: params.id,
      ativo: false,
      reprocessed: reprocess,
      records: {
        products_found: products.length,
        products_with_alternative_stock: productsWithAlternativeStock.length,
        products_with_internal_stock: productsWithInternalStock.length,
        products_reassigned: productsReassigned,
        products_kept_only_by_internal_stock: productsKeptInternal,
        products_inactivated: productsInactivated,
        products_without_available_source: productsWithoutAvailableSource.length,
        supplier_offers_found: offers.length,
        supplier_offers_inactivated: supplierOffersInactivated,
        supplier_offers_verified_inactive: supplierOffersStillActive === 0,
        supplier_offers_verified_zero_stock: supplierOffersStillStocked === 0,
        stale_delete_outbox_cancelled: staleDeleteOutboxCancelled,
        ml_pause_enqueued: mlPauseEnqueued,
        ml_pause_skipped_no_item: mlPauseSkippedNoItem,
        ml_pause_skipped_non_active: mlPauseSkippedNonActive,
        ml_pause_skipped_existing: mlPauseSkippedExisting,
        ml_pause_failed: mlPauseFailed,
        ml_stock_enqueued: mlStockEnqueued,
        ml_stock_failed: mlStockFailed,
        ml_price_products_updated: mlPriceProductsUpdated,
        ml_price_outbox_enqueued: mlPriceOutboxEnqueued,
        ml_price_failed: mlPriceFailed,
      },
      errors,
    }, { status: mlPauseFailed === 0 && mlStockFailed === 0 && mlPriceFailed === 0 ? 200 : 207 });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao atualizar fornecedor') }, { status: 500 });
  }
}
