import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.read');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('operationId'));
  if (!id.success) return NextResponse.json({ error: 'Operação inválida' }, { status: 422 });
  const row = await createServiceClient().from('pricing_operations')
    .select('id,state,item_id,previous_price_cents,new_price_cents,requested_at,actor_id')
    .eq('id', id.data).maybeSingle();
  if (row.error) return NextResponse.json({ error: 'Operação indisponível' }, { status: 503 });
  if (!row.data || row.data.actor_id !== auth.userId)
    return NextResponse.json({ error: 'Operação não encontrada' }, { status: 404 });
  return NextResponse.json(row.data, { headers: { 'Cache-Control': 'no-store' } });
}
