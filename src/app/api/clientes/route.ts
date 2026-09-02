import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { ClienteSortKey, ClientesListResponse } from '@/types/clientes';

const DEFAULT_SORT: { sortBy: ClienteSortKey; sortOrder: 'asc' | 'desc' } = {
  sortBy: 'name',
  sortOrder: 'asc',
};

const SORT_KEYS: ClienteSortKey[] = [
  'name',
  'ml_id',
  'person_type',
  'document',
  'location',
  'orders',
];

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSort(searchParams: URLSearchParams): { sortBy: ClienteSortKey; sortOrder: 'asc' | 'desc' } {
  const requested = searchParams.get('sortBy');
  return {
    sortBy: SORT_KEYS.includes(requested as ClienteSortKey)
      ? requested as ClienteSortKey
      : DEFAULT_SORT.sortBy,
    sortOrder: searchParams.get('sortOrder') === 'desc' ? 'desc' : DEFAULT_SORT.sortOrder,
  };
}

function isClientesListResponse(value: Json | null): value is Json & ClientesListResponse {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const summary = candidate.summary;
  return Array.isArray(candidate.data)
    && typeof candidate.page === 'number'
    && typeof candidate.pageSize === 'number'
    && typeof candidate.total === 'number'
    && Boolean(summary)
    && !Array.isArray(summary)
    && typeof summary === 'object';
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const page = positiveInteger(searchParams.get('page'), 1);
    const pageSize = Math.min(positiveInteger(searchParams.get('pageSize'), 100), 100);
    const search = searchParams.get('search')?.trim() || null;
    const requestedType = searchParams.get('tipo');
    const personType = requestedType === 'F' || requestedType === 'J' ? requestedType : null;
    const { sortBy, sortOrder } = parseSort(searchParams);
    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc('search_clientes_paginated', {
      p_page: page,
      p_page_size: pageSize,
      p_search: search,
      p_person_type: personType,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    });

    if (error) {
      return NextResponse.json(
        { error: 'Não foi possível carregar os clientes' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (!isClientesListResponse(data)) {
      return NextResponse.json(
        { error: 'A consulta de clientes retornou um formato inválido' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível carregar os clientes' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
