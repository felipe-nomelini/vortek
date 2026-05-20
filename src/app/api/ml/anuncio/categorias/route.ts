import { NextResponse } from 'next/server';
import { getCategoryAttributes, predictCategory } from '@/services/mercadolibre';
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

    const categorias = await Promise.all(predictions.map(async (p) => {
      const attrs = await getCategoryAttributes(p.category_id);
      const requiredAttributes = (attrs || [])
        .filter(a => (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed)
        .map(a => ({
          id: a.id,
          name: a.name,
          value_type: a.value_type,
          values: (a.values || []).slice(0, 50).map(v => ({ id: v.id, name: v.name })),
        }));

      return {
        id: p.category_id,
        nome: p.category_name,
        dominio: p.domain_name,
        attributes: p.attributes,
        requiredAttributes,
      };
    }));

    return NextResponse.json({
      produto: { id: produtoId, nome: produto.nome, sku: produto.sku },
      tituloSugerido: titulo,
      categorias,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
