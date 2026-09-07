import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';

const querySchema = z.object({ before: z.string().regex(/^\d+$/).refine(value => Number.isSafeInteger(Number(value))).optional(), itemId: z.string().regex(/^ML[A-Z]\d+$/).optional(), groupId: z.string().uuid().optional(), clearanceId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { id } = await props.params;
  const input = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: 'Filtro inválido' }, { status: 422 });
  const client = createServiceClient();
  const product = await client.from('produtos').select('id').eq('id', id).maybeSingle();
  if (product.error) return NextResponse.json({ error: 'Histórico indisponível' }, { status: 503 });
  if (!product.data) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
  let query = client.from('pricing_events').select('id,created_at,item_id,group_id,group_version,operation_id,evaluation_id,override_id,clearance_id,kind,pricing_source,actor_id,reason,rule_id,job_id,previous_price_cents,new_price_cents,observed_at,projection,source_override_ids:evidence->sourceOverrideIds')
    .eq('produto_id', id).order('id', { ascending: false }).limit(input.data.limit);
  if (input.data.before) query = query.lt('id', Number(input.data.before));
  if (input.data.itemId) query = query.eq('item_id', input.data.itemId);
  if (input.data.groupId) query = query.eq('group_id', input.data.groupId);
  if (input.data.clearanceId) query = query.eq('clearance_id', input.data.clearanceId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Histórico indisponível' }, { status: 503 });
  return NextResponse.json({ data, nextCursor: data?.length === input.data.limit ? String(data[data.length - 1].id) : null }, { headers: { 'Cache-Control': 'no-store' } });
}
