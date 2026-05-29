import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { applyNoCatalogFilters, parseNoCatalogFilters } from '@/lib/catalogo/no-catalogo';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const { searchParams } = new URL(request.url);
  const filters = parseNoCatalogFilters(searchParams);
  const sellerIdParam = searchParams.get('sellerId');
  const sellerId = sellerIdParam !== null ? Number(sellerIdParam) : null;

  const countBase = () =>
    applyNoCatalogFilters(
      (() => {
        let q: any = service.from('catalogo_ml_snapshot').select('id', { count: 'exact', head: false });
        if (sellerId !== null && Number.isFinite(sellerId)) {
          q = q.eq('seller_id', sellerId);
        }
        return q;
      })(),
      filters,
    );

  const [{ count: total, error: totalError }, { count: ativos, error: ativosError }, { count: pausados, error: pausadosError }, { count: ganhando, error: ganhandoError }, { count: perdendo, error: perdendoError }] = await Promise.all([
    countBase().range(0, 0),
    countBase().eq('status', 'active').range(0, 0),
    countBase().eq('status', 'paused').range(0, 0),
    countBase().eq('buy_box_winning', true).range(0, 0),
    countBase().eq('buy_box_winning', false).range(0, 0),
  ]);

  const firstError = totalError || ativosError || pausadosError || ganhandoError || perdendoError;
  if (firstError) {
    return NextResponse.json({ erro: firstError.message }, { status: 500 });
  }

  console.log(JSON.stringify({
    event: 'catalog_no_catalogo_resumo_query',
    seller_id: sellerId,
    total_filtered: total || 0,
    status_ml: filters.statusMl,
    buy_box: filters.buyBox,
    search: Boolean(filters.search),
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json({
    total: total || 0,
    ativos: ativos || 0,
    pausados: pausados || 0,
    ganhando: ganhando || 0,
    perdendo: perdendo || 0,
  });
}
