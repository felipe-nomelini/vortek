import { NextResponse } from 'next/server';
import { createListing, getCategoryAttributes, predictCategory } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { produtoId, categoriaId, listingType } = await req.json();
    if (!produtoId || !categoriaId) {
      return NextResponse.json({ error: 'produtoId e categoriaId são obrigatórios' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (!produto) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const titulo = (produto.marca
      ? `${produto.nome} ${produto.marca}`
      : produto.nome
    ).substring(0, 60);

    // Buscar attributes obrigatórios da categoria
    const attrs = await getCategoryAttributes(categoriaId);
    const attributes: Array<{ id: string; value_name?: string; value_id?: string }> = [];

    if (attrs) {
      const required = attrs.filter(
        a => (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed
      );

      for (const attr of required) {
        if (attr.value_type === 'string') {
          attributes.push({ id: attr.id, value_name: produto.marca || produto.nome });
        } else if (attr.value_type === 'list' && attr.values?.length) {
          attributes.push({ id: attr.id, value_id: attr.values[0].id });
        } else if (attr.value_type === 'number') {
          attributes.push({ id: attr.id, value_name: '0' });
        } else if (attr.value_type === 'boolean') {
          attributes.push({ id: attr.id, value_name: 'false' });
        }
      }
    }

    // Preencher atributos do predictor se disponíveis
    const predictions = await predictCategory(titulo, 1);
    if (predictions?.[0]?.attributes) {
      for (const predAttr of predictions[0].attributes) {
        if (!attributes.find(a => a.id === predAttr.id)) {
          attributes.push({ id: predAttr.id, value_id: predAttr.value_id, value_name: predAttr.value_name });
        }
      }
    }

    const imagens = produto.imagens || [];
    const pictures = imagens.length > 0
      ? imagens
      : ['https://via.placeholder.com/400'];

    const result = await createListing({
      title: titulo,
      categoryId: categoriaId,
      price: produto.custo || 0,
      availableQuantity: produto.estoque || 1,
      condition: 'new',
      listingTypeId: listingType || 'gold_pro',
      description: produto.descricao || titulo,
      pictures,
      attributes,
      fiscalData: {
        gtin: produto.gtin || undefined,
        ncm: produto.ncm || undefined,
        cest: produto.cest || undefined,
        csosn: produto.csosn || '101',
      },
    });

    if (!result) {
      return NextResponse.json({ error: 'Falha ao criar anúncio no ML' }, { status: 502 });
    }

    // Atualizar produto com ml_item_id e ml_status
    await supabase
      .from('produtos')
      .update({
        ml_item_id: result.id,
        ml_status: 'ativo',
      })
      .eq('id', produtoId);

    return NextResponse.json({
      success: true,
      anuncio: {
        id: result.id,
        title: result.title,
        price: result.price,
        permalink: result.permalink,
        status: result.status,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
