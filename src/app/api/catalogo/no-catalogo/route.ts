import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { applyNoCatalogFilters, parseNoCatalogFilters } from '@/lib/catalogo/no-catalogo';
import type { Database } from '@/types/database';

type SnapshotRow = Database['public']['Tables']['catalogo_ml_snapshot']['Row'];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 100)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sellerIdParam = searchParams.get('sellerId');
  const sellerId = sellerIdParam !== null ? Number(sellerIdParam) : null;

  const filters = parseNoCatalogFilters(searchParams);

  let countQuery: any = service
    .from('catalogo_ml_snapshot')
    .select('id', { count: 'exact', head: false });
  if (sellerId !== null && Number.isFinite(sellerId)) {
    countQuery = countQuery.eq('seller_id', sellerId);
  }
  countQuery = applyNoCatalogFilters(countQuery, filters);
  const { count, error: countError } = await countQuery.range(0, 0);
  if (countError) {
    return NextResponse.json({ erro: countError.message }, { status: 500 });
  }

  let dataQuery: any = service
    .from('catalogo_ml_snapshot')
    .select('*');
  if (sellerId !== null && Number.isFinite(sellerId)) {
    dataQuery = dataQuery.eq('seller_id', sellerId);
  }
  dataQuery = applyNoCatalogFilters(dataQuery, filters);
  const { data, error } = await dataQuery
    .order('ml_item_id', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const rows = ((data || []) as SnapshotRow[]).map((row) => ({
    anuncio_id: row.ml_item_id,
    ml_item_id: row.ml_item_id,
    relacionado_id: row.related_item_id,
    related_permalink: row.related_permalink,
    title: row.title || '',
    seller_sku: row.seller_sku,
    sku_local: row.sku_local,
    produto_id: row.produto_id,
    catalog_product_id: row.catalog_product_id,
    status: row.status,
    buy_box_status: row.buy_box_status,
    price_to_win: row.price_to_win,
    price: Number(row.price || 0),
    permalink: row.permalink,
    thumbnail: row.thumbnail,
    category_id: row.category_id,
    domain_id: row.domain_id,
    catalog_listing: true,
    item_relations: null,
    last_updated: row.last_updated_ml,
  }));

  console.log(JSON.stringify({
    event: 'catalog_no_catalogo_query',
    seller_id: sellerId,
    page,
    page_size: pageSize,
    total_filtered: count || 0,
    status_ml: filters.statusMl,
    buy_box: filters.buyBox,
    search: Boolean(filters.search),
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json({
    data: rows,
    total: count || 0,
    page,
    pageSize,
  });
}
