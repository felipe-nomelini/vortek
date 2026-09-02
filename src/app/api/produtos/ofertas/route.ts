import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import {
  listBntD09VisualReview,
  type SupplierOffersView,
} from '@/lib/products/supplier-offers';

const PAGE_SIZE = 100;
const allowedViews = new Set<SupplierOffersView>(['operational', 'alternatives', 'problems', 'historical', 'all']);
const allowedSortFields = new Set(['sku', 'offer', 'product', 'supplier', 'stock', 'cost', 'status', 'last_sync']);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const search = String(searchParams.get('search') || '').trim();
  const supplierDsliteIds = (searchParams.get('fornecedores') || '').split(',').map((value) => value.trim()).filter(Boolean);
  const rawView = searchParams.get('view') || 'operational';
  const view: SupplierOffersView = allowedViews.has(rawView as SupplierOffersView)
    ? rawView as SupplierOffersView
    : 'operational';
  const stockStatus = ['todos', 'com_estoque', 'sem_estoque'].includes(searchParams.get('estoque') || '')
    ? String(searchParams.get('estoque'))
    : 'todos';
  const preference = ['todos', 'preferenciais', 'alternativas'].includes(searchParams.get('preferencia') || '')
    ? String(searchParams.get('preferencia'))
    : 'todos';
  const rawSortBy = searchParams.get('sortBy') || 'cost';
  const sortBy = allowedSortFields.has(rawSortBy) ? rawSortBy : 'cost';
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const serviceClient = createServiceClient();

  try {
    const visualReview = await loadBntD07VisualReview();
    if (visualReview) {
      return NextResponse.json({
        ...listBntD09VisualReview({
          review: visualReview,
          page,
          pageSize: PAGE_SIZE,
          search,
          supplierDsliteIds,
          view,
          stockStatus,
          preference,
          sortBy,
          sortOrder,
        }),
        visualReview: visualReview.metadata,
      });
    }

    const { data, error } = await (serviceClient as any).rpc('search_supplier_offers_paginated', {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_search: search || null,
      p_supplier_dslite_ids: supplierDsliteIds,
      p_view: view,
      p_stock_status: stockStatus,
      p_preference: preference,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);

    const result = (data || {}) as Record<string, unknown>;
    return NextResponse.json({
      data: Array.isArray(result.data) ? result.data : [],
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || PAGE_SIZE),
      metrics: result.metrics || {},
      queueCounts: result.queueCounts || {},
      suppliers: Array.isArray(result.suppliers) ? result.suppliers : [],
    });
  } catch (error: any) {
    console.error('[api/produtos/ofertas] Falha ao consultar ofertas:', error?.message || error);
    return NextResponse.json(
      { erro: error?.message || 'Falha ao carregar ofertas de fornecedor' },
      { status: 500 },
    );
  }
}
