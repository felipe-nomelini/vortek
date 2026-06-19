import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const service = createServiceClient();
  const [
    activeZeroStockResp,
    authFailuresResp,
  ] = await Promise.all([
    service
      .from('produtos')
      .select('id,sku,nome,ml_item_id,estoque,ml_status,updated_at', { count: 'exact' })
      .eq('ml_status', 'ativo')
      .lte('estoque', 0)
      .not('ml_item_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(10),
    (service
      .from('anuncios_ml_outbox' as any) as any)
      .select('id,ml_item_id,desired_status,desired_quantity,status,last_error,updated_at,payload', { count: 'exact' })
      .in('status', ['failed', 'retry'])
      .ilike('last_error', '%not authorized%')
      .order('updated_at', { ascending: false })
      .limit(10),
  ]);

  if (activeZeroStockResp.error) {
    return NextResponse.json({ error: activeZeroStockResp.error.message }, { status: 500 });
  }
  if (authFailuresResp.error) {
    return NextResponse.json({ error: authFailuresResp.error.message }, { status: 500 });
  }

  return NextResponse.json({
    activeZeroStock: {
      count: activeZeroStockResp.count || 0,
      items: activeZeroStockResp.data || [],
    },
    mlPublishAuthFailures: {
      count: authFailuresResp.count || 0,
      items: authFailuresResp.data || [],
    },
  });
}
