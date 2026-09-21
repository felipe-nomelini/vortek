import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { loadProductPricing, type PricingRequestContext } from './pricing-context';
import { pricingView } from '@/lib/pricing-view';
import { loadProductMlListings } from '@/lib/ml/product-listings';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { loadKitSupplySources } from '@/lib/kit-supply-source';

type Row = { product: Database['public']['Tables']['produtos']['Row'] & { pricing?: import('./pricing-context').ProductPricing };
  preferredOffer: Record<string, unknown> | null; offersCount: number;
  fulfillmentCapacity?: { internal: number; supplier: number; safe: number };
  mlListings?: Awaited<ReturnType<typeof loadProductMlListings>> extends Map<string, infer T> ? T : never;
  isKit?: boolean };
export type ProductPricingQuery = {
  search: string; supplierIds: string[]; includeInternal: boolean; active: string;
  mlStatus: string; stock: string; priceField: 'cost' | 'suggestedPrice' | 'profit';
  priceMin: number | null; priceMax: number | null; sortBy: string; sortOrder: 'asc' | 'desc';
  page: number; pageSize: number;
};

/** Resolve an exact Mercado Livre item ID to its locally linked product. */
export async function resolveListingProductSearch(client: SupabaseClient<Database>, search: string) {
  const itemId = search.trim().toUpperCase();
  if (!/^MLB\d+$/.test(itemId)) return null;
  const [listings, snapshots, pointers] = await Promise.all([
    client.from('anuncios_ml').select('produto_id').eq('ml_item_id', itemId),
    client.from('catalogo_ml_snapshot').select('produto_id').eq('ml_item_id', itemId),
    client.from('produtos').select('id').eq('ml_item_id', itemId),
  ]);
  if (listings.error || snapshots.error || pointers.error) throw new Error('Falha ao localizar o anúncio');
  const productIds = new Set([
    ...(listings.data || []).map(row => row.produto_id),
    ...(snapshots.data || []).map(row => row.produto_id),
    ...(pointers.data || []).map(row => row.id),
  ].filter((id): id is string => Boolean(id)));
  if (productIds.size > 1) throw new Error('Anúncio vinculado a produtos divergentes');
  const productId = [...productIds][0];
  if (!productId) return { kind: 'missing' as const };
  const product = await client.from('produtos').select('id,sku').eq('id', productId).maybeSingle();
  if (product.error) throw new Error('Falha ao localizar o produto do anúncio');
  return product.data?.sku
    ? { kind: 'linked' as const, productId, sku: product.data.sku }
    : { kind: 'missing' as const };
}

/** Filtros e totais econômicos pertencem ao conjunto inteiro, nunca à página visível. */
export function selectPricedProducts(rows: Row[], query: ProductPricingQuery) {
  const view = (row: Row) => pricingView(row.product.pricing);
  const filtered = rows.filter(row => {
    if (query.stock === 'com_estoque' && Number(row.product.estoque) <= 0) return false;
    if (query.stock === 'sem_estoque' && Number(row.product.estoque) !== 0) return false;
    const v = view(row);
    const amount = query.priceField === 'cost' ? v.cost : query.priceField === 'profit' ? v.profit : v.suggestedPrice;
    return (query.priceMin === null || (amount !== null && amount >= query.priceMin))
      && (query.priceMax === null || (amount !== null && amount <= query.priceMax));
  });
  const sortValue = (row: Row): string | number | null => {
    const v = view(row);
    switch (query.sortBy) {
      case 'custo': return v.cost;
      case 'suggested_price': return v.suggestedPrice;
      case 'profit': return v.profit;
      case 'ml_fee': return row.product.pricing?.current.memory?.fee.amountCents ?? null;
      case 'ml_shipping': return row.product.pricing?.current.memory?.shipping.amountCents ?? null;
      default: return (row.product as Record<string, any>)[query.sortBy] ?? null;
    }
  };
  const direction = query.sortOrder === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    const l = sortValue(a); const r = sortValue(b);
    if (l === null && r !== null) return 1;
    if (r === null && l !== null) return -1;
    const difference = l === null || r === null ? 0 : typeof l === 'number' && typeof r === 'number'
      ? l - r : String(l).localeCompare(String(r), 'pt-BR', { numeric: true });
    return difference * direction || a.product.sku.localeCompare(b.product.sku) || a.product.id.localeCompare(b.product.id);
  });
  let revenue = 0; let profit = 0; let profitCount = 0; let incomplete = 0;
  for (const row of filtered) {
    const p = row.product.pricing;
    if (p?.target.ok) revenue += p.target.priceCents * Math.max(0, Number(row.product.estoque || 0));
    else incomplete++;
    if (p?.current.memory) { profit += p.current.memory.resultCents; profitCount++; }
  }
  return {
    data: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    total: filtered.length, page: query.page, pageSize: query.pageSize,
    summary: { total: filtered.length, comEstoque: filtered.filter(r => Number(r.product.estoque) > 0).length,
      semAnuncio: filtered.filter(r => r.product.ml_status === 'sem_anuncio').length,
      receitaPotencial: incomplete ? null : revenue / 100,
      lucroMedio: profitCount ? Math.round(profit / profitCount) / 100 : null,
      pricingInconclusive: incomplete, profitSampleCount: profitCount },
  };
}

export async function queryPricedProducts(client: SupabaseClient<Database>, query: ProductPricingQuery,
  requestContext: PricingRequestContext) {
  const listingSearch = await resolveListingProductSearch(client, query.search);
  if (listingSearch?.kind === 'missing') return selectPricedProducts([], query);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await client.rpc('search_produtos_paginated', {
      p_search: listingSearch?.sku || query.search || null, p_supplier_dslite_ids: query.supplierIds,
      p_include_internal: query.includeInternal, p_product_active_status: query.active,
      p_ml_status: query.mlStatus || null, p_estoque: null,
      p_page: page, p_page_size: 100, p_sort_by: 'sku', p_sort_order: 'asc',
    } as any);
    if (result.error) throw new Error('Falha ao carregar candidatos para precificação');
    const payload = result.data as { data?: Row[]; total?: number } | null;
    const batch = payload?.data || [];
    if (!batch.length) break;
    if (batch.some(row => seen.has(row.product.id))) throw new Error('A lista mudou durante a consulta; atualize os filtros');
    batch.forEach(row => seen.add(row.product.id));
    const matchingBatch = listingSearch?.kind === 'linked'
      ? batch.filter(row => row.product.id === listingSearch.productId)
      : batch;
    if (!matchingBatch.length) {
      if (batch.length < 100) break;
      continue;
    }
    const ids = matchingBatch.map(row => row.product.id);
    const [listings, capacities, kitSupplySources] = await Promise.all([
      loadProductMlListings(client, ids), loadProductFulfillmentCapacities(client, ids),
      loadKitSupplySources(client, ids, { operationalSupplierIds: requestContext.operational }),
    ]);
    const evidence = new Map(batch.flatMap(row => {
      const listing = listings.get(row.product.id)?.[0];
      return listing ? [[row.product.id, { mlItemId: listing.itemId,
        currentPriceCents: listing.price == null ? null : Math.round(listing.price * 100),
        marketContextKey: `listing:${listing.itemId}:unquoted` }] as const] : [];
    }));
    const pricing = await loadProductPricing(client, matchingBatch.map(row => row.product), { requestContext, evidence });
    for (const row of matchingBatch) {
      const capacity = capacities.get(row.product.id);
      if (!capacity) throw new Error('Capacidade operacional ausente');
      const kitSource = kitSupplySources.get(row.product.id);
      const syntheticKitOffer = kitSource?.kind === 'ready' ? {
        ...kitSource.source.offer,
        id: `kit-fornecedor-${row.product.id}`,
        produto_id: row.product.id,
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
      } : null;
      rows.push({ ...row, fulfillmentCapacity: capacity, mlListings: listings.get(row.product.id) || [],
        preferredOffer: syntheticKitOffer || row.preferredOffer,
        isKit: Boolean(kitSource && kitSource.kind !== 'not_kit'),
        product: { ...row.product, estoque: capacity.safe, pricing: pricing.get(row.product.id) } });
    }
    if (batch.length < 100) break;
  }
  return selectPricedProducts(rows, query);
}
