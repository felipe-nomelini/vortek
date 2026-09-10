import 'server-only';
import type { createServiceClient } from '@/lib/supabase';
import { filterOperationalDropshippingSupplierOffers, loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { resolvePreferredOfferForProduct } from '@/lib/preferred-offer';
import { getSkuLookupVariants } from '@/lib/sku';

type ServiceClient = ReturnType<typeof createServiceClient>;

export type OrderItemCmvSnapshot = {
  cmv_unitario_snapshot: number;
  cmv_total_snapshot: number;
  cmv_fonte: 'preferred_offer' | 'kit_product';
  cmv_evidencia_id: string;
  cmv_fonte_observada_em: string;
  cmv_capturado_em: string;
  cmv_composicao: Array<{
    produto_id: string;
    quantidade: number;
    custo_unitario: number;
    observado_em: string;
  }> | null;
};

type ExistingItemCmvRow = {
  ml_item_id?: string | null;
  seller_sku?: string | null;
  quantidade?: number | null;
  cmv_unitario_snapshot?: number | null;
  cmv_total_snapshot?: number | null;
  cmv_fonte?: string | null;
  cmv_evidencia_id?: string | null;
  cmv_fonte_observada_em?: string | null;
  cmv_capturado_em?: string | null;
  cmv_composicao?: unknown;
};

function money(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function validTimestamp(value: unknown): string | null {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function itemSku(item: any): string | null {
  return String(item?.item?.seller_sku || '').trim() || null;
}

function itemMlId(item: any): string | null {
  return String(item?.item?.id || '').trim() || null;
}

function matchesExistingItem(existing: ExistingItemCmvRow, item: any): boolean {
  const mlItemId = itemMlId(item);
  if (mlItemId && String(existing.ml_item_id || '').trim() === mlItemId) return true;
  const currentSkus = new Set(getSkuLookupVariants(itemSku(item)));
  return getSkuLookupVariants(existing.seller_sku).some((sku) => currentSkus.has(sku));
}

export function readPersistedCmvSnapshot(
  existing: ExistingItemCmvRow | undefined,
  quantity: number,
): OrderItemCmvSnapshot | null {
  if (!existing || Number(existing.quantidade) !== quantity) return null;
  const unitCost = money(existing.cmv_unitario_snapshot);
  const totalCost = money(existing.cmv_total_snapshot);
  const source = existing.cmv_fonte;
  const evidenceId = String(existing.cmv_evidencia_id || '').trim();
  const observedAt = validTimestamp(existing.cmv_fonte_observada_em);
  const capturedAt = validTimestamp(existing.cmv_capturado_em);
  if (
    unitCost === null
    || totalCost === null
    || totalCost !== Number((unitCost * quantity).toFixed(2))
    || (source !== 'preferred_offer' && source !== 'kit_product')
    || !evidenceId
    || !observedAt
    || !capturedAt
  ) return null;
  return {
    cmv_unitario_snapshot: unitCost,
    cmv_total_snapshot: totalCost,
    cmv_fonte: source,
    cmv_evidencia_id: evidenceId,
    cmv_fonte_observada_em: observedAt,
    cmv_capturado_em: capturedAt,
    cmv_composicao: Array.isArray(existing.cmv_composicao)
      ? existing.cmv_composicao as OrderItemCmvSnapshot['cmv_composicao']
      : null,
  };
}

export function buildOrderHistoricalCosts(
  orderItems: any[],
  snapshots: Array<OrderItemCmvSnapshot | null>,
) {
  return orderItems.flatMap((item, index) => {
    const snapshot = snapshots[index];
    const mlItemId = itemMlId(item);
    const quantity = Number(item?.quantity || 0);
    const totalCostCents = snapshot
      ? Math.round(snapshot.cmv_total_snapshot * 100)
      : NaN;
    if (
      !snapshot
      || !mlItemId
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || !Number.isSafeInteger(totalCostCents)
      || totalCostCents < 0
    ) return [];
    return [{
      itemId: mlItemId,
      quantity,
      totalCostCents,
      evidenceId: snapshot.cmv_evidencia_id,
    }];
  });
}

function uniqueById(rows: any[]): any[] {
  return Array.from(new Map(rows.map((row) => [String(row?.id || ''), row])).values())
    .filter((row) => String(row?.id || '').trim());
}

function resolveUniqueProduct(params: {
  item: any;
  products: any[];
  catalogProductIdsByMlItem: Map<string, string[]>;
  productIdsBySku: Map<string, string[]>;
}): any | null {
  const mlItemId = itemMlId(params.item);
  if (mlItemId) {
    const catalogIds = new Set(params.catalogProductIdsByMlItem.get(mlItemId) || []);
    const direct = uniqueById(params.products.filter((product) => (
      String(product.ml_item_id || '').trim() === mlItemId
      || catalogIds.has(String(product.id || ''))
    )));
    if (direct.length === 1) return direct[0];
    if (direct.length > 1) return null;
  }
  const variants = new Set(getSkuLookupVariants(itemSku(params.item)));
  const linkedIds = new Set(
    Array.from(variants).flatMap((variant) => params.productIdsBySku.get(variant) || []),
  );
  const bySku = uniqueById(params.products.filter((product) => (
    getSkuLookupVariants(product.sku).some((sku) => variants.has(sku))
    || linkedIds.has(String(product.id || ''))
  )));
  return bySku.length === 1 ? bySku[0] : null;
}

export async function loadOrderItemCmvSnapshots(params: {
  client: ServiceClient;
  mlOrderId: string;
  orderItems: any[];
  existingItems?: ExistingItemCmvRow[];
}): Promise<Array<OrderItemCmvSnapshot | null>> {
  const { client, mlOrderId, orderItems } = params;
  if (orderItems.length === 0) return [];

  const mlItemIds = Array.from(new Set(orderItems.map(itemMlId).filter(Boolean))) as string[];
  const skuVariants = Array.from(new Set(
    orderItems.flatMap((item) => getSkuLookupVariants(itemSku(item))),
  ));
  const productSelect = 'id,ativo,sku,ml_item_id,custo,updated_at,oferta_preferencial_id,fornecedor_preferencial_manual';
  const [directResult, skuResult, catalogResult, offerSkuResult, supplierSkuResult] = await Promise.all([
    mlItemIds.length
      ? client.from('produtos').select(productSelect).in('ml_item_id', mlItemIds)
      : Promise.resolve({ data: [], error: null }),
    skuVariants.length
      ? client.from('produtos').select(productSelect).in('sku', skuVariants)
      : Promise.resolve({ data: [], error: null }),
    mlItemIds.length
      ? client.from('catalogo_ml_snapshot').select('ml_item_id,produto_id').in('ml_item_id', mlItemIds)
      : Promise.resolve({ data: [], error: null }),
    skuVariants.length
      ? client.from('produto_fornecedor_ofertas').select('produto_id,sku_oferta').in('sku_oferta', skuVariants)
      : Promise.resolve({ data: [], error: null }),
    skuVariants.length
      ? client.from('produto_fornecedor_ofertas').select('produto_id,sku_fornecedor').in('sku_fornecedor', skuVariants)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const initialError = directResult.error || skuResult.error || catalogResult.error
    || offerSkuResult.error || supplierSkuResult.error;
  if (initialError) throw new Error(`Falha ao resolver produtos para CMV: ${initialError.message}`);

  const linkedProductIds = Array.from(new Set(
    [
      ...(catalogResult.data || []),
      ...(offerSkuResult.data || []),
      ...(supplierSkuResult.data || []),
    ].map((row: any) => String(row.produto_id || '').trim()).filter(Boolean),
  ));
  const linkedProductsResult = linkedProductIds.length
    ? await client.from('produtos').select(productSelect).in('id', linkedProductIds)
    : { data: [], error: null };
  if (linkedProductsResult.error) {
    throw new Error(`Falha ao resolver vínculos de produto para CMV: ${linkedProductsResult.error.message}`);
  }
  const products = uniqueById([
    ...(directResult.data || []),
    ...(skuResult.data || []),
    ...(linkedProductsResult.data || []),
  ]);
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const catalogProductIdsByMlItem = new Map<string, string[]>();
  for (const row of catalogResult.data || []) {
    const key = String((row as any).ml_item_id || '').trim();
    const current = catalogProductIdsByMlItem.get(key) || [];
    current.push(String((row as any).produto_id || ''));
    catalogProductIdsByMlItem.set(key, current);
  }
  const productIdsBySku = new Map<string, string[]>();
  for (const row of [...(offerSkuResult.data || []), ...(supplierSkuResult.data || [])]) {
    const rawSku = String((row as any).sku_oferta || (row as any).sku_fornecedor || '');
    for (const variant of getSkuLookupVariants(rawSku)) {
      const current = productIdsBySku.get(variant) || [];
      current.push(String((row as any).produto_id || ''));
      productIdsBySku.set(variant, current);
    }
  }
  const resolvedProducts = orderItems.map((item) => resolveUniqueProduct({
    item,
    products,
    catalogProductIdsByMlItem,
    productIdsBySku,
  }));
  const productIds = Array.from(new Set(
    resolvedProducts.map((product) => String(product?.id || '')).filter(Boolean),
  ));
  const [kitsResult, componentsResult, offersResult, operationalSupplierIds] = await Promise.all([
    productIds.length
      ? (client as any).from('produto_kits').select('produto_id,ativo').in('produto_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? (client as any).from('produto_kit_componentes').select('kit_produto_id,componente_produto_id,quantidade').in('kit_produto_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? client.from('produto_fornecedor_ofertas')
        .select('id,produto_id,dslite_fornecedor_id,ativo,estoque,custo,prioridade,updated_at')
        .in('produto_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    loadOperationalDropshippingSupplierIds(client),
  ]);
  const contextError = kitsResult.error || componentsResult.error || offersResult.error;
  if (contextError) throw new Error(`Falha ao resolver fonte de CMV: ${contextError.message}`);

  const componentIds: string[] = Array.from(new Set<string>(
    (componentsResult.data || []).map((row: any) => String(row.componente_produto_id || '')).filter(Boolean),
  ));
  const componentProductsResult = componentIds.length
    ? await client.from('produtos').select('id,ativo,custo,updated_at').in('id', componentIds)
    : { data: [], error: null };
  if (componentProductsResult.error) {
    throw new Error(`Falha ao resolver componentes do CMV: ${componentProductsResult.error.message}`);
  }
  for (const product of componentProductsResult.data || []) {
    productsById.set(String((product as any).id), product);
  }

  const kitByProductId = new Map(
    (kitsResult.data || []).map((kit: any) => [String(kit.produto_id), kit]),
  );
  const componentsByKit = new Map<string, any[]>();
  for (const component of componentsResult.data || []) {
    const key = String((component as any).kit_produto_id || '');
    const current = componentsByKit.get(key) || [];
    current.push(component);
    componentsByKit.set(key, current);
  }
  const offersByProductId = new Map<string, any[]>();
  for (const offer of filterOperationalDropshippingSupplierOffers(
    offersResult.data || [],
    operationalSupplierIds,
  )) {
    const key = String((offer as any).produto_id || '');
    const current = offersByProductId.get(key) || [];
    current.push(offer);
    offersByProductId.set(key, current);
  }

  const capturedAt = new Date().toISOString();
  return orderItems.map((item, index) => {
    const quantity = Number(item?.quantity || 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
    const existing = (params.existingItems || []).find((row) => matchesExistingItem(row, item));
    const persisted = readPersistedCmvSnapshot(existing, quantity);
    if (persisted) return persisted;

    const product = resolvedProducts[index];
    if (!product?.id || product.ativo === false) return null;
    const productId = String(product.id);
    const kit = kitByProductId.get(productId);
    if (kit) {
      if ((kit as any).ativo === false) return null;
      const composition = (componentsByKit.get(productId) || []).map((component) => {
        const componentProduct = productsById.get(String(component.componente_produto_id || ''));
        const componentQuantity = Number(component.quantidade || 0);
        const componentCost = money(componentProduct?.custo);
        const observedAt = validTimestamp(componentProduct?.updated_at);
        if (
          !componentProduct
          || componentProduct.ativo === false
          || !Number.isSafeInteger(componentQuantity)
          || componentQuantity <= 0
          || componentCost === null
          || !observedAt
        ) return null;
        return {
          produto_id: String(componentProduct.id),
          quantidade: componentQuantity,
          custo_unitario: componentCost,
          observado_em: observedAt,
        };
      });
      if (composition.length === 0 || composition.some((component) => component === null)) return null;
      const typedComposition = composition as NonNullable<OrderItemCmvSnapshot['cmv_composicao']>;
      const unitCost = money(typedComposition.reduce(
        (total, component) => total + component.custo_unitario * component.quantidade,
        0,
      ));
      if (unitCost === null) return null;
      const observedAt = typedComposition
        .map((component) => component.observado_em)
        .sort()
        .at(-1)!;
      const itemIdentity = itemMlId(item) || itemSku(item) || String(index);
      return {
        cmv_unitario_snapshot: unitCost,
        cmv_total_snapshot: Number((unitCost * quantity).toFixed(2)),
        cmv_fonte: 'kit_product',
        cmv_evidencia_id: `${mlOrderId}:${itemIdentity}:kit:${productId}:${observedAt}`,
        cmv_fonte_observada_em: observedAt,
        cmv_capturado_em: capturedAt,
        cmv_composicao: typedComposition,
      };
    }

    const offer = resolvePreferredOfferForProduct(
      offersByProductId.get(productId) || [],
      product.oferta_preferencial_id,
      product.fornecedor_preferencial_manual === true,
    );
    const unitCost = money(offer?.custo);
    const observedAt = validTimestamp(offer?.updated_at);
    if (!offer?.id || unitCost === null || !observedAt) return null;
    const itemIdentity = itemMlId(item) || itemSku(item) || String(index);
    return {
      cmv_unitario_snapshot: unitCost,
      cmv_total_snapshot: Number((unitCost * quantity).toFixed(2)),
      cmv_fonte: 'preferred_offer',
      cmv_evidencia_id: `${mlOrderId}:${itemIdentity}:offer:${String(offer.id)}:${observedAt}`,
      cmv_fonte_observada_em: observedAt,
      cmv_capturado_em: capturedAt,
      cmv_composicao: null,
    };
  });
}
