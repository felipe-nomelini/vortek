import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const sku = String(req.nextUrl.searchParams.get('sku') || '').trim().toUpperCase();
  if (!sku) return NextResponse.json({ error: 'Informe o SKU.' }, { status: 400 });

  const db = createServiceClient();
  const { data: produto, error } = await db
    .from('produtos')
    .select('id,sku,nome')
    .eq('sku', sku)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!produto) return NextResponse.json({ error: 'Produto não encontrado para este SKU.' }, { status: 404 });
  return NextResponse.json({ produto });
}
