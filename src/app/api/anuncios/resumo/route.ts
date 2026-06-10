import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;

  function applyFilters(query: any) {
    if (search) {
      query = query.or(`titulo.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (priceMin !== null) {
      query = query.gte('preco_ml', priceMin);
    }
    if (priceMax !== null) {
      query = query.lte('preco_ml', priceMax);
    }
    return query;
  }

  let query = serviceClient.from('anuncios_ml').select('status, qualidade');
  query = applyFilters(query);

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const rows = data || [];
  let ativos = 0;
  let pausados = 0;
  let qualidadeBaixa = 0;
  let qualidadeAlta = 0;
  let qualidade100 = 0;

  for (const row of rows) {
    const statusValue = String(row.status || '').toLowerCase();
    const qualidade = Number(row.qualidade || 0);
    if (statusValue === 'ativo') ativos++;
    if (statusValue === 'pausado') pausados++;
    if (qualidade < 80) qualidadeBaixa++;
    if (qualidade >= 80) qualidadeAlta++;
    if (qualidade === 100) qualidade100++;
  }

  return NextResponse.json({
    total: rows.length,
    ativos,
    pausados,
    qualidade_baixa: qualidadeBaixa,
    qualidade_alta: qualidadeAlta,
    qualidade_100: qualidade100,
  });
}
