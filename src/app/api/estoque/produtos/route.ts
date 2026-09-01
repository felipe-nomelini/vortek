import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request, 'inventory.read');
  if (!auth.ok) return auth.response;
  const search = String(request.nextUrl.searchParams.get('q') || '').trim().replace(/[,()]/g, ' ').slice(0, 100);
  if (search.length < 2) return NextResponse.json({ products: [] });
  const db = createServiceClient();
  const { data, error } = await db
    .from('produtos')
    .select('id,sku,nome,gtin')
    .or(`sku.ilike.%${search}%,nome.ilike.%${search}%,gtin.ilike.%${search}%`)
    .eq('ativo', true)
    .order('nome')
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data || [] });
}
