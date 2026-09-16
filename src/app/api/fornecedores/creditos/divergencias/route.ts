import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const parsed = z.object({
    fornecedorId: z.string().regex(/^[0-9]{1,20}$/).optional(),
    status: z.enum(['open', 'closed']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Filtros inválidos' }, { status: 422 });
  const pageSize = 30;
  let query = createServiceClient().from('supplier_cancellation_cases')
    .select('id,compra_id,pedido_id,fornecedor_id,supplier_settlement_id,movement_id,classification,status,source,evidence,resolution,resolution_note,resolved_at,version,created_at', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((parsed.data.page - 1) * pageSize, parsed.data.page * pageSize - 1);
  if (parsed.data.fornecedorId) query = query.eq('fornecedor_id', parsed.data.fornecedorId);
  if (parsed.data.status) query = query.eq('status', parsed.data.status);
  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao consultar divergências' }, { status: 500 });
  return NextResponse.json({ data: data || [], total: count || 0, page: parsed.data.page },
    { headers: { 'Cache-Control': 'no-store' } });
}
