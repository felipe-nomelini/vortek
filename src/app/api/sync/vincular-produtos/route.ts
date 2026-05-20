import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST() {
  const client = createServiceClient();

  // 1. Buscar anuncios_ml com SKU
  const { data: anuncios } = await client
    .from('anuncios_ml')
    .select('ml_item_id, sku')
    .not('sku', 'is', null);

  if (!anuncios?.length) {
    return NextResponse.json({ ok: false, mensagem: 'Nenhum anuncio encontrado' });
  }

  let atualizadosProdutos = 0;
  let atualizadosAnuncios = 0;

  for (const a of anuncios) {
    // Atualizar produto: ml_item_id
    const { data: produto } = await client
      .from('produtos')
      .select('id, ml_item_id')
      .eq('sku', a.sku)
      .maybeSingle();

    if (produto?.id && !produto.ml_item_id) {
      await client
        .from('produtos')
        .update({ ml_item_id: a.ml_item_id })
        .eq('id', produto.id);
      atualizadosProdutos++;
    }

    // Atualizar anuncio: produto_id
    if (produto?.id) {
      await client
        .from('anuncios_ml')
        .update({ produto_id: produto.id })
        .eq('ml_item_id', a.ml_item_id);
      atualizadosAnuncios++;
    }
  }

  return NextResponse.json({
    ok: true,
    produtosAtualizados: atualizadosProdutos,
    anunciosAtualizados: atualizadosAnuncios,
  });
}
