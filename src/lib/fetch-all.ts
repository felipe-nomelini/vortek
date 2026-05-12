/**
 * Utilitário para paginar todas as linhas de uma tabela do Supabase.
 * Lida com o limite de 1000 linhas por requisição da API REST.
 * Retorna null em caso de erro.
 */
import type { Database } from '@/types/database';

export async function fetchAll<T extends keyof Database['public']['Tables']>(
  supabase: any,
  table: T
): Promise<Database['public']['Tables'][T]['Row'][] | null> {
  const all: any[] = [];
  const pageSize = 1000;
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = (page + 1) * pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  return all;
}
