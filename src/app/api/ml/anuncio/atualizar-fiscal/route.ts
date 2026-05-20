import { NextResponse } from 'next/server';
import { updateListingFiscalData } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createServiceClient();

    const { data: anuncios, error: anunciosError } = await supabase
      .from('anuncios_ml')
      .select('ml_item_id, sku')
      .not('ml_item_id', 'is', null);

    if (anunciosError) return NextResponse.json({ error: anunciosError.message }, { status: 500 });
    if (!anuncios || anuncios.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum anúncio encontrado. Execute o sync de anúncios primeiro.' }, { status: 404 });
    }

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
        .select('sku, nome, ncm, gtin, cest, csosn, origem_fiscal, peso_liq, peso_bruto, custo')
        .eq('sku', a.sku)
        .maybeSingle();

      if (!produto || !produto.ncm) {
        ignorados++;
        resultados.push({
          sku: a.sku,
          ml_item_id: a.ml_item_id,
          status: 'ignorado',
          motivo: !produto ? 'produto não encontrado' : 'sem NCM',
        });
        continue;
      }

      const originDetail = produto.origem_fiscal || '0';
      const originType = originDetail === '3' || originDetail === '5' || originDetail === '8' ? 'imported'
        : originDetail === '1' ? 'manufacturer'
        : 'reseller';

      const fiscalResult = await updateListingFiscalData({
        itemId: a.ml_item_id,
        sku: produto.sku,
        title: produto.nome,
        ncm: produto.ncm,
        origin_type: originType,
        origin_detail: originDetail,
        gtin: produto.gtin || undefined,
        cest: produto.cest || undefined,
        csosn: (produto.csosn === '101' || !produto.csosn) ? '102' : produto.csosn,
        net_weight: produto.peso_liq || undefined,
        gross_weight: produto.peso_bruto || undefined,
        measurement_unit: 'UN',
        cost: produto.custo,
      });

      if (fiscalResult.success) {
        sucesso++;
        resultados.push({ sku: a.sku, ml_item_id: a.ml_item_id, status: 'ok' });
      } else {
        erro++;
        resultados.push({
          sku: a.sku,
          ml_item_id: a.ml_item_id,
          status: 'erro',
          step: fiscalResult.step,
          error: fiscalResult.error,
          fields: fiscalResult.fields,
        });
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
