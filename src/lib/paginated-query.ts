/**
 * Helper genérico para APIs paginadas do Vortek.
 * Aplica filtros no banco, faz count exact e retorna página paginada.
 */
import { createServiceClient } from '@/lib/supabase';

export interface PaginatedQueryResult<T> {
  data: T[];
  total: number;
  error?: string;
}

export interface PaginatedQueryOptions {
  table: string;
  page: number;
  pageSize: number;
  orderBy?: string;
  ascending?: boolean;
}

/**
 * Executa uma query paginada com count exact no Supabase.
 * @param buildQuery - função que recebe uma query e aplica filtros
 */
export async function paginatedQuery<T>(
  options: PaginatedQueryOptions,
  buildQuery: (query: any) => any
): Promise<PaginatedQueryResult<T>> {
  const { table, page, pageSize, orderBy = 'id', ascending = true } = options;
  const client = createServiceClient();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Count query (exact)
  let countQuery = (client.from as any)(table).select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = buildQuery(countQuery);
  const { count } = await countQuery;

  // Data query
  let dataQuery = (client.from as any)(table).select('*');
  dataQuery = buildQuery(dataQuery);
  const { data, error } = await dataQuery
    .order(orderBy, { ascending })
    .range(from, to);

  if (error) {
    return { data: [], total: 0, error: error.message };
  }

  return { data: (data || []) as T[], total: count || 0 };
}
