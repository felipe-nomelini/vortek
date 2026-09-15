import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

const filters = z.object({
  state: z.enum(['all','SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO']).default('all'),
  risk: z.enum(['all','CRITICO','ALTO','MEDIO','BAIXO']).default('all'),
  search: z.string().trim().max(80).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.read');
  if (!auth.ok) return auth.response;
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Filtros inválidos.' }, { status: 422 });
  const { id } = await context.params;
  const { state, risk, search, page } = parsed.data;
  const term = search.replace(/[^A-Za-z0-9_-]/g, '');
  let query: any = (createServiceClient().from('ml_catalog_identity_audits' as any) as any)
    .select('id,ml_item_id,source_origin,produto_id,sku,ml_item_id_related,catalog_product_id,identity_state,reason_code,conflict_type,risk_tier,gap_pct,block_price_write,ml_live_source_available,old_relation,proposed_relation,comparisons,action,action_result,error,finished_at', { count: 'exact' })
    .eq('run_id', id);
  if (state !== 'all') query = query.eq('identity_state', state);
  if (risk !== 'all') query = query.eq('risk_tier', risk);
  if (term) query = query.or(`ml_item_id.ilike.%${term}%,sku.ilike.%${term}%,catalog_product_id.ilike.%${term}%`);
  const from = (page - 1) * 50;
  const result = await query.order('ordinal', { ascending: true }).range(from, from + 49);
  if (result.error) return NextResponse.json({ error: 'Fila indisponível.' }, { status: 503 });
  return NextResponse.json({ data: result.data || [], total: result.count || 0, page, pageSize: 50 }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
