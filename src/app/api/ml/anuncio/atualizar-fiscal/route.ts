import { NextResponse } from 'next/server';
import { updateListingFiscalData } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createServiceClient();

    // Buscar todos os anúncios do ML (tabela anuncios_ml)
    const { data: anuncios, error: anunciosError } = await supabase
      .from('anuncios_ml')
      .select('ml_item_id, sku')
      .not('ml_item_id', 'is', null);

    if (anunciosError) return NextResponse.json({ error: anunciosError.message }, { status: 500 });
    if (!anuncios || anuncios.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum anúncio encontrado. Execute o sync de anúncios primeiro.' }, { status: 404 });
    }

    // Filtrar por produtoIds se informado
    const anunciosFiltrados = body.produtoIds?.length
      ? anuncios.filter((a: any) => body.produtoIds.includes(a.sku))
      : anuncios;

    const resultados: any[] = [];
    let sucesso = 0;
    let erro = 0;
    let ignorados = 0;

    for (const a of anunciosFiltrados) {
      const { data: produto } = await supabase
        .from('produtos')
        .select('gtin, ncm, cest, csosn')
        .eq('sku', a.sku)
        .maybeSingle();

      if (!produto || (!produto.gtin && !produto.ncm)) {
        ignorados++;
        resultados.push({
          sku: a.sku,
          ml_item_id: a.ml_item_id,
          status: 'ignorado',
          motivo: !produto ? 'produto não encontrado no banco' : 'sem dados fiscais',
        });
        continue;
      }

      const ok = await updateListingFiscalData(a.ml_item_id, {
        gtin: produto.gtin || undefined,
        ncm: produto.ncm || undefined,
        cest: produto.cest || undefined,
        csosn: produto.csosn || '101',
      });

      if (ok) {
        sucesso++;
        resultados.push({ sku: a.sku, ml_item_id: a.ml_item_id, status: 'ok' });
      } else {
        erro++;
        resultados.push({ sku: a.sku, ml_item_id: a.ml_item_id, status: 'erro' });
      }
    }

    return NextResponse.json({
      success: true,
      totalAnuncios: anuncios.length,
      processados: anunciosFiltrados.length,
      sucesso,
      erro,
      ignorados,
      resultados,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
