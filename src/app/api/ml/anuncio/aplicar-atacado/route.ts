import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  return NextResponse.json({
    success: false,
    code: 'quantity_pricing_retired',
    error: 'Desconto por quantidade foi aposentado. Compras múltiplas preservam o preço unitário.',
  }, { status: 410 });
}
