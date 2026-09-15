import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { loadKitSupplySources, type KitSupplierOffer } from '@/lib/kit-supply-source';

type ServiceClientLike = { from: (table: string) => any };

export type SimpleKitOrderPlan = {
  kitProductId: string;
  supplierId: string;
  supplierName: string;
  sourceSku: string;
  sourceOfferId: string;
  sourceOffer: KitSupplierOffer;
  componentSku: string;
  componentProductId: string;
  componentDsliteProductId: string;
  componentTitle: string;
  componentQuantity: number;
  componentNcm: string | null;
  componentGtin: string | null;
  componentCost: number;
  componentStock: number;
  paymentMode: string | null;
};

/**
 * Mercado Livre aceita o GTIN unitário quando a oferta é um pack de itens
 * idênticos. Mantemos o código somente no produto componente para não violar
 * a unicidade de GTIN no cadastro interno dos SKUs de kit.
 */
export async function resolveGtinForMlListing(
  client: ServiceClientLike,
  sku: string,
  ownGtin: unknown,
): Promise<string | null> {
  const own = String(ownGtin || '').trim();
  if (own) return own;

  const kit = await resolveSimpleKitOrderPlan(client, sku);
  return kit.kind === 'ready' && kit.plan.componentGtin
    ? kit.plan.componentGtin
    : null;
}

/** Resolve a kit that can become one product line in the fiscal/DSLite order. */
export async function resolveSimpleKitOrderPlan(
  client: ServiceClientLike,
  kitSku: string,
): Promise<
  | { kind: 'not_kit' }
  | { kind: 'inactive' }
  | { kind: 'unsupported_composite'; componentCount: number }
  | { kind: 'incomplete'; reason: string }
  | { kind: 'ready'; plan: SimpleKitOrderPlan }
> {
  const normalizedSku = String(kitSku || '').trim();
  if (!normalizedSku) return { kind: 'not_kit' };
  const { data: kitProduct, error: kitProductError } = await client
    .from('produtos' as any)
    .select('id')
    .eq('sku', normalizedSku)
    .maybeSingle();
  if (kitProductError) throw new Error(`Falha ao localizar kit ${normalizedSku}: ${kitProductError.message}`);
  if (!kitProduct?.id) return { kind: 'not_kit' };

  const kitProductId = String(kitProduct.id);
  const resolution = (await loadKitSupplySources(client, [kitProductId])).get(kitProductId);
  if (!resolution || resolution.kind === 'not_kit') return { kind: 'not_kit' };
  if (resolution.kind === 'inactive') return { kind: 'inactive' };
  if (resolution.kind === 'unsupported_composite') {
    return { kind: 'unsupported_composite', componentCount: resolution.componentCount };
  }
  if (resolution.kind === 'incomplete') {
    return { kind: 'incomplete', reason: resolution.reason };
  }

  const { source } = resolution;

  return {
    kind: 'ready',
    plan: {
      kitProductId,
      supplierId: source.supplierId,
      supplierName: source.supplierName,
      sourceSku: source.sourceSku,
      sourceOfferId: String(source.offer.id),
      sourceOffer: source.offer,
      componentSku: source.componentSku,
      componentProductId: source.componentProductId,
      componentDsliteProductId: String(source.offer.dslite_produto_id),
      componentTitle: source.componentTitle,
      componentQuantity: source.componentQuantity,
      componentNcm: source.componentNcm,
      componentGtin: source.componentGtin,
      componentCost: Number(source.offer.custo),
      componentStock: Number(source.offer.estoque || 0),
      paymentMode: String(source.offer.payment_mode || '').trim() || null,
    },
  };
}

export type KitStockSnapshot = {
  produtoId: string;
  sku: string;
  oldStock: number;
  newStock: number;
  oldCost: number;
  newCost: number;
  mlItemIds: string[];
};

/** Recalcula estoque vendável e custo de kits a partir dos produtos componentes. */
export async function recalculateProductKits(
  client: ServiceClientLike,
  componentProductIds?: string[],
): Promise<KitStockSnapshot[]> {
  const componentIds = Array.from(new Set((componentProductIds || []).map(String).filter(Boolean)));
  let componentQuery = client
    .from('produto_kit_componentes' as any)
    .select('kit_produto_id,componente_produto_id,quantidade');
  if (componentIds.length > 0) componentQuery = componentQuery.in('componente_produto_id', componentIds);

  const { data: affectedComponents, error: affectedError } = await componentQuery;
  if (affectedError) throw new Error(`Falha ao localizar kits afetados: ${affectedError.message}`);

  const kitIds: string[] = Array.from(new Set<string>(
    (affectedComponents || []).map((row: any) => String(row.kit_produto_id || '')).filter(Boolean),
  ));
  if (kitIds.length === 0) return [];

  const [{ data: kitRows, error: kitsError }, { data: listings, error: listingsError }, supplySources] = await Promise.all([
    client.from('produtos' as any).select('id,sku,estoque,custo').in('id', kitIds),
    client.from('anuncios_ml' as any).select('produto_id,ml_item_id').in('produto_id', kitIds),
    loadKitSupplySources(client, kitIds),
  ]);
  if (kitsError || listingsError) {
    throw new Error(kitsError?.message || listingsError?.message || 'Falha ao carregar dados dos kits');
  }
  const listingsByKit = new Map<string, string[]>();
  for (const row of listings || []) {
    const key = String((row as any).produto_id || '');
    const itemId = String((row as any).ml_item_id || '');
    if (!key || !itemId) continue;
    const items = listingsByKit.get(key) || [];
    items.push(itemId);
    listingsByKit.set(key, items);
  }

  const snapshots: KitStockSnapshot[] = [];
  for (const kit of kitRows || []) {
    const kitId = String((kit as any).id || '');
    if (!kitId) continue;
    const resolution = supplySources.get(kitId);
    if (!resolution || resolution.kind === 'not_kit' || resolution.kind === 'inactive' || resolution.kind === 'unsupported_composite') continue;
    if (resolution.kind === 'incomplete') {
      throw new Error(`Origem configurada do kit ${String((kit as any).sku || kitId)} está incompleta: ${resolution.reason}`);
    }
    const newStock = resolution.source.stock;
    const newCost = resolution.source.cost;
    const oldStock = Math.max(0, Number((kit as any).estoque || 0));
    const oldCost = Math.max(0, Number((kit as any).custo || 0));
    if (oldStock !== newStock || oldCost !== newCost) {
      const { error } = await client.from('produtos' as any).update({ estoque: newStock, custo: newCost }).eq('id', kitId);
      if (error) throw new Error(`Falha ao atualizar kit ${kitId}: ${error.message}`);
    }
    snapshots.push({
      produtoId: kitId,
      sku: String((kit as any).sku || ''),
      oldStock,
      newStock,
      oldCost,
      newCost,
      mlItemIds: listingsByKit.get(kitId) || [],
    });
  }
  return snapshots;
}

export async function enqueueKitStockUpdates(client: ServiceClientLike, snapshots: KitStockSnapshot[]): Promise<number> {
  const changedSnapshots = snapshots.filter((kit) => kit.oldStock !== kit.newStock);
  if (changedSnapshots.length === 0) return 0;
  const capacities = await loadProductFulfillmentCapacities(
    client,
    changedSnapshots.map((kit) => kit.produtoId),
  );
  let queued = 0;
  for (const kit of changedSnapshots) {
    const capacity = capacities.get(kit.produtoId) || { internal: 0, supplier: 0, safe: 0 };
    for (const mlItemId of kit.mlItemIds) {
      const result = await enqueueMlPublishOutbox(client, {
        produtoId: kit.produtoId,
        mlItemId,
        desiredStatus: capacity.safe > 0 ? 'ativo' : 'pausado',
        desiredQuantity: capacity.safe,
        source: 'kit_stock_automation',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          sku: kit.sku,
          estoque_fornecedor: capacity.supplier,
          estoque_interno: capacity.internal,
          estoque_disponivel: capacity.safe,
        },
      });
      if (!result.ok) throw new Error(`Falha ao enfileirar estoque do kit ${kit.sku}: ${result.error}`);
      if (result.action !== 'unchanged' && result.action !== 'skipped_ineligible') queued += 1;
    }
  }
  return queued;
}
