import { NextResponse } from 'next/server';
import { predictCategory } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { produtoId } = await req.json();
    if (!produtoId) {
      return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('sku, nome, marca, categoria')
      .eq('id', produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const titulo = produto.marca
      ? `${produto.nome} ${produto.marca}`.substring(0, 60)
      : produto.nome.substring(0, 60);

    const predictions = await predictCategory(titulo);
    if (!predictions || predictions.length === 0) {
      return NextResponse.json({ error: 'Não foi possível prever a categoria' }, { status: 502 });
    }

    return NextResponse.json({
      produto: { id: produtoId, nome: produto.nome, sku: produto.sku },
      tituloSugerido: titulo,
      categorias: predictions.map(p => ({
        id: p.category_id,
        nome: p.category_name,
        dominio: p.domain_name,
        attributes: p.attributes,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
