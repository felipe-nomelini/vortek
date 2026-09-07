import type { createServiceClient } from '@/lib/supabase';
import { resolveCatalogCompetitionStatus } from '@/lib/catalogo/no-catalogo';

export type ProductMlListing = {
  itemId: string;
  type: 'standard' | 'catalog';
  status: string;
  price: number;
  permalink: string | null;
  catalogProductId?: string | null;
  catalogStatus?: 'ganhando' | 'competindo' | 'perdendo' | 'sem_catalogo';
  priceToWin?: number | null;
  relatedItemId?: string | null;
  pricingGroup?: {
    groupId: string; version: number; state: string; observedAt: string;
    catalogSynchronizedPair: boolean; members: { itemId: string; variationId: string; catalog: boolean }[];
  } | null;
};

function normalizeListingStatus(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active') return 'ativo';
  if (normalized === 'paused') return 'pausado';
  if (normalized === 'closed') return 'encerrado';
  return normalized;
}

function listingRank(listing: ProductMlListing) {
  const catalogPenalty = listing.type === 'catalog' ? 1 : 0;
  if (listing.status === 'ativo') return catalogPenalty;
  if (listing.status === 'pausado') return 2 + catalogPenalty;
  return 4 + catalogPenalty;
}

export async function loadProductMlListings(
  serviceClient: ReturnType<typeof createServiceClient>,
  productIds: string[],
) {
  const listingsByProductId = new Map<string, Map<string, ProductMlListing>>();
  if (productIds.length === 0) return new Map<string, ProductMlListing[]>();

  const [listingsResult, snapshotsResult] = await Promise.all([
    serviceClient
      .from('anuncios_ml')
      .select('produto_id,ml_item_id,status,catalogo,preco_ml,permalink')
      .in('produto_id', productIds),
    serviceClient
      .from('catalogo_ml_snapshot')
      .select('produto_id,ml_item_id,status,catalog_listing,price,permalink,catalog_product_id,buy_box_status,buy_box_winning,price_to_win,related_item_id')
      .in('produto_id', productIds),
  ]);

  if (listingsResult.error) throw listingsResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  const upsert = (productId: string, itemId: string, patch: Partial<ProductMlListing>) => {
    if (!productId || !itemId) return;
    const productListings = listingsByProductId.get(productId) || new Map<string, ProductMlListing>();
    const current = productListings.get(itemId);
    productListings.set(itemId, {
      itemId,
      type: current?.type || 'standard',
      status: current?.status || '',
      price: current?.price || 0,
      permalink: current?.permalink || null,
      ...current,
      ...patch,
    });
    listingsByProductId.set(productId, productListings);
  };

  for (const snapshot of snapshotsResult.data || []) {
    const productId = String(snapshot.produto_id || '').trim();
    const itemId = String(snapshot.ml_item_id || '').trim().toUpperCase();
    const catalog = Boolean(snapshot.catalog_listing);
    upsert(productId, itemId, {
      type: catalog ? 'catalog' : 'standard',
      status: normalizeListingStatus(snapshot.status),
      price: Number(snapshot.price || 0),
      permalink: snapshot.permalink || null,
      catalogProductId: snapshot.catalog_product_id || null,
      catalogStatus: resolveCatalogCompetitionStatus({
        catalogListing: catalog,
        buyBoxStatus: snapshot.buy_box_status,
        buyBoxWinning: snapshot.buy_box_winning,
      }),
      priceToWin: snapshot.price_to_win === null ? null : Number(snapshot.price_to_win),
      relatedItemId: snapshot.related_item_id || null,
    });
  }

  for (const listing of listingsResult.data || []) {
    const productId = String(listing.produto_id || '').trim();
    const itemId = String(listing.ml_item_id || '').trim().toUpperCase();
    const catalog = Boolean(listing.catalogo);
    upsert(productId, itemId, {
      type: catalog ? 'catalog' : 'standard',
      status: normalizeListingStatus(listing.status),
      price: Number(listing.preco_ml || 0),
      permalink: listing.permalink || null,
      catalogStatus: catalog
        ? (listingsByProductId.get(productId)?.get(itemId)?.catalogStatus || 'perdendo')
        : 'sem_catalogo',
    });
  }

  const { data: groups, error: groupError } = await serviceClient.from('ml_pricing_groups')
    .select('id,produto_id,current_version,state,observed_at').in('produto_id', productIds).neq('state', 'retired');
  if (groupError) throw new Error('listing_groups_read_failed');
  const groupIds = (groups || []).map(group => group.id);
  if (groupIds.length) {
    const [{ data: members, error: membersError }, { data: revisions, error: revisionsError }] = await Promise.all([
      serviceClient.from('ml_pricing_group_members').select('group_id,version,ml_item_id,variation_id,catalog_listing').in('group_id', groupIds).eq('is_current', true),
      serviceClient.from('ml_pricing_group_revisions').select('group_id,version,catalog_synchronized_pair')
        .or((groups || []).map(group => `and(group_id.eq.${group.id},version.eq.${group.current_version})`).join(',')),
    ]);
    if (membersError || revisionsError) throw new Error('listing_group_members_read_failed');
    for (const group of groups || []) {
      const currentMembers = (members || []).filter(member => member.group_id === group.id && member.version === group.current_version);
      const revision = (revisions || []).find(row => row.group_id === group.id && row.version === group.current_version);
      for (const member of currentMembers) {
        const listing = listingsByProductId.get(group.produto_id)?.get(member.ml_item_id);
        if (!listing) continue;
        // Um item com várias variações não pode ser reduzido a um grupo arbitrário no DTO legado.
        if (listing.pricingGroup !== undefined) { listing.pricingGroup = null; continue; }
        listing.pricingGroup = { groupId: group.id, version: group.current_version, state: group.state,
          observedAt: group.observed_at, catalogSynchronizedPair: group.state === 'verified' && revision?.catalog_synchronized_pair === true,
          members: currentMembers.map(row => ({ itemId: row.ml_item_id, variationId: row.variation_id, catalog: row.catalog_listing })) };
      }
    }
  }
  for (const listings of listingsByProductId.values()) for (const listing of listings.values()) listing.pricingGroup ??= null;

  return new Map(
    [...listingsByProductId.entries()].map(([productId, listings]) => [
      productId,
      [...listings.values()].sort((left, right) => {
        const rank = listingRank(left) - listingRank(right);
        if (rank !== 0) return rank;
        return left.itemId.localeCompare(right.itemId);
      }),
    ]),
  );
}
