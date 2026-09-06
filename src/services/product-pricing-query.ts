import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { loadProductPricing, type PricingRequestContext } from './pricing-context';
import { pricingView } from '@/lib/pricing-view';
import { loadProductMlListings } from '@/lib/ml/product-listings';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';

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
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await client.rpc('search_produtos_paginated', {
      p_search: query.search || null, p_supplier_dslite_ids: query.supplierIds,
      p_include_internal: query.includeInternal, p_product_active_status: query.active,
      p_ml_status: query.mlStatus || null, p_estoque: null,
      p_page: page, p_page_size: 100, p_sort_by: 'sku', p_sort_order: 'asc',
    } as any);
    if (result.error) throw new Error('Falha ao carregar candidatos para precificação');
    const payload = result.data as { data?: Row[]; total?: number } | null;
    const batch = payload?.data || [];
    if (!batch.length) break;
    if (batch.some(row => seen.has(row.product.id))) throw new Error('A lista mudou durante a consulta; atualize os filtros');
    const ids = batch.map(row => row.product.id);
    const [listings, capacities, kits] = await Promise.all([
      loadProductMlListings(client, ids), loadProductFulfillmentCapacities(client, ids),
      client.from('produto_kits' as any).select('produto_id').in('produto_id', ids).returns<{ produto_id: string }[]>(),
    ]);
    if (kits.error) throw new Error('Falha ao carregar kits dos produtos');
    const evidence = new Map(batch.flatMap(row => {
      const listing = listings.get(row.product.id)?.[0];
      return listing ? [[row.product.id, { mlItemId: listing.itemId,
        currentPriceCents: listing.price == null ? null : Math.round(listing.price * 100),
        marketContextKey: `listing:${listing.itemId}:unquoted` }] as const] : [];
    }));
    const pricing = await loadProductPricing(client, batch.map(row => row.product), { requestContext, evidence });
    for (const row of batch) {
      seen.add(row.product.id);
      const capacity = capacities.get(row.product.id);
      if (!capacity) throw new Error('Capacidade operacional ausente');
      rows.push({ ...row, fulfillmentCapacity: capacity, mlListings: listings.get(row.product.id) || [],
        isKit: kits.data.some(kit => kit.produto_id === row.product.id),
        product: { ...row.product, estoque: capacity.safe, pricing: pricing.get(row.product.id) } });
    }
    if (batch.length < 100) break;
  }
  return selectPricedProducts(rows, query);
}
