import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';

type ServiceClientLike = { from: (table: string) => any };

export type ActiveZeroSafeStockAlertItem = {
  produto_id: string;
  sku: string;
  nome: string;
  ml_item_id: string;
  safe_stock: number;
  internal_stock: number;
  supplier_stock: number;
  observed_status: 'ativo';
  observed_at: string | null;
};

const LISTING_PAGE_SIZE = 1000;
const QUERY_CHUNK_SIZE = 200;

/** Parte da exposicao ativa no ML; a decisao de risco usa somente a capacidade canonica. */
export async function loadActiveZeroSafeStockAlerts(
  client: ServiceClientLike,
  itemLimit = 10,
): Promise<{ count: number; items: ActiveZeroSafeStockAlertItem[] }> {
  const activeListings: any[] = [];
  for (let from = 0; ; from += LISTING_PAGE_SIZE) {
    const { data, error } = await client
      .from('anuncios_ml')
      .select('produto_id,ml_item_id,status,updated_at')
      .eq('status', 'ativo')
      .not('produto_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + LISTING_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    activeListings.push(...(data || []));
    if (!data || data.length < LISTING_PAGE_SIZE) break;
  }

  const productIds = Array.from(new Set(
    activeListings.map((listing) => String(listing.produto_id || '').trim()).filter(Boolean),
  ));
  if (productIds.length === 0) return { count: 0, items: [] };

  const capacities = await loadProductFulfillmentCapacities(client, productIds);
  const products: any[] = [];
  for (let index = 0; index < productIds.length; index += QUERY_CHUNK_SIZE) {
    const { data, error } = await client
      .from('produtos')
      .select('id,sku,nome')
      .in('id', productIds.slice(index, index + QUERY_CHUNK_SIZE));
    if (error) throw new Error(error.message);
    products.push(...(data || []));
  }

  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const items = activeListings
    .map((listing): ActiveZeroSafeStockAlertItem | null => {
      const productId = String(listing.produto_id || '').trim();
      const mlItemId = String(listing.ml_item_id || '').trim();
      const product = productsById.get(productId);
      if (!productId || !mlItemId || !product) return null;
      const capacity = capacities.get(productId) || { internal: 0, supplier: 0, safe: 0 };
      if (capacity.safe > 0) return null;
      return {
        produto_id: productId,
        sku: String(product.sku || ''),
        nome: String(product.nome || ''),
        ml_item_id: mlItemId,
        safe_stock: capacity.safe,
        internal_stock: capacity.internal,
        supplier_stock: capacity.supplier,
        observed_status: 'ativo',
        observed_at: listing.updated_at ? String(listing.updated_at) : null,
      };
    })
    .filter((item): item is ActiveZeroSafeStockAlertItem => item !== null)
    .sort((left, right) => String(right.observed_at || '').localeCompare(String(left.observed_at || '')));

  return { count: items.length, items: items.slice(0, Math.max(0, itemLimit)) };
}
