import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const search = searchParams.get('search') || '';
    const tipo = searchParams.get('tipo') || '';

    const pageSize = 100;
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    const supabase = createServiceClient();

    let countQuery = supabase
      .from('clientes')
      .select('*', { count: 'exact', head: false })
      .range(0, 0);

    let dataQuery = supabase
      .from('clientes')
      .select('*')
      .order('nome', { ascending: true })
      .range(start, end);

    if (search) {
      const filter = `nome.ilike.%${search}%,documento.ilike.%${search}%,nickname.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%,endereco.ilike.%${search}%`;
      countQuery = countQuery.or(filter);
      dataQuery = dataQuery.or(filter);
    }

    if (tipo) {
      countQuery = countQuery.eq('tipo_pessoa', tipo);
      dataQuery = dataQuery.eq('tipo_pessoa', tipo);
    }

    const [{ count, error: countError }, { data, error: dataError }] = await Promise.all([
      countQuery,
      dataQuery,
    ]);

    if (countError || dataError) {
      return NextResponse.json(
        { error: countError?.message || dataError?.message },
        { status: 500 }
      );
    }

    // Contar total de pedidos por cliente (join via nickname extraído do contato_nome)
    let vendasMap: Record<string, number> = {};
    const { data: allPedidos } = await supabase
      .from('pedidos')
      .select('contato_nome');

    if (allPedidos) {
      for (const p of allPedidos) {
        const match = p.contato_nome?.match(/\(([^)]+)\)$/);
        const nickname = match ? match[1] : '';
        if (nickname) {
          vendasMap[nickname] = (vendasMap[nickname] || 0) + 1;
        }
      }
    }

    const enriched = (data || []).map(c => ({
      ...c,
      total_vendas: vendasMap[c.ml_nickname || ''] || 0,
    }));

    return NextResponse.json({
      data: enriched,
      total: count || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
