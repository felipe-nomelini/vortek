import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';

    const client = createServiceClient();
    let query = client
      .from('compras')
      .select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`destinatario_nome.ilike.%${search}%,produto_descricao.ilike.%${search}%,dsid.ilike.%${search}%`);
    if (dateFrom) query = query.gte('data_criacao', dateFrom);
    if (dateTo) query = query.lte('data_criacao', dateTo + 'T23:59:59');

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await query
      .order('data_criacao', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[api/compras] Erro:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const compras = data || [];
    let pedidoNumeroPorDsliteId = new Map<string, number>();

    if (compras.length > 0) {
      const dsids = Array.from(
        new Set(compras.map((item: any) => String(item.dsid)).filter(Boolean))
      );

      if (dsids.length > 0) {
        const { data: pedidosVinculados, error: pedidosError } = await client
          .from('pedidos')
          .select('dslite_id, numero')
          .in('dslite_id', dsids);

        if (pedidosError) {
          console.error('[api/compras] Erro ao buscar pedidos vinculados:', pedidosError);
        } else if (pedidosVinculados?.length) {
          pedidoNumeroPorDsliteId = new Map(
            pedidosVinculados
              .filter((p: any) => p?.dslite_id)
              .map((p: any) => [String(p.dslite_id), Number(p.numero)])
          );
        }
      }
    }

    const comprasEnriquecidas = compras.map((item: any) => ({
      ...item,
      pedido_vendas_numero: pedidoNumeroPorDsliteId.get(String(item.dsid)) ?? null,
    }));

    return NextResponse.json({
      data: comprasEnriquecidas,
      total: count || 0,
      page,
      pageSize: limit,
    });
  } catch (err: any) {
    console.error('[api/compras] Erro geral:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
