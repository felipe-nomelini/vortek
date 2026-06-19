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
  const recentAuthFailureSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [
    activeZeroStockResp,
    retryAuthFailuresResp,
    recentFailedAuthFailuresResp,
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
      .eq('status', 'retry')
      .ilike('last_error', '%not authorized%')
      .order('updated_at', { ascending: false })
      .limit(10),
    (service
      .from('anuncios_ml_outbox' as any) as any)
      .select('id,ml_item_id,desired_status,desired_quantity,status,last_error,updated_at,payload', { count: 'exact' })
      .eq('status', 'failed')
      .gte('updated_at', recentAuthFailureSince)
      .ilike('last_error', '%not authorized%')
      .order('updated_at', { ascending: false })
      .limit(10),
  ]);

  if (activeZeroStockResp.error) {
    return NextResponse.json({ error: activeZeroStockResp.error.message }, { status: 500 });
  }
  if (retryAuthFailuresResp.error || recentFailedAuthFailuresResp.error) {
    return NextResponse.json(
      { error: retryAuthFailuresResp.error?.message || recentFailedAuthFailuresResp.error?.message },
      { status: 500 },
    );
  }

  const authFailureItemsById = new Map<string, any>();
  for (const item of [...(retryAuthFailuresResp.data || []), ...(recentFailedAuthFailuresResp.data || [])]) {
    authFailureItemsById.set(String((item as any).id), item);
  }

  return NextResponse.json({
    activeZeroStock: {
      count: activeZeroStockResp.count || 0,
      items: activeZeroStockResp.data || [],
    },
    mlPublishAuthFailures: {
      count: (retryAuthFailuresResp.count || 0) + (recentFailedAuthFailuresResp.count || 0),
      items: Array.from(authFailureItemsById.values()).slice(0, 10),
    },
  });
}
