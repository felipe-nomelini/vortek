import { NextResponse } from 'next/server';
import { updateListingFiscalData } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';
import { fiscalStrictSchema, mapOriginType, normalizeNcm } from '@/lib/fiscal-strict';

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

      if (!produto) {
        ignorados++;
        resultados.push({
          sku: a.sku,
          ml_item_id: a.ml_item_id,
          status: 'ignorado',
          motivo: 'produto não encontrado',
        });
        continue;
      }

      const parsed = fiscalStrictSchema.safeParse({
        ncm: produto.ncm,
        origem_fiscal: produto.origem_fiscal,
        csosn: produto.csosn,
        sku: produto.sku,
        title: produto.nome,
      });

      if (!parsed.success) {
        ignorados++;
        resultados.push({
          sku: a.sku,
          ml_item_id: a.ml_item_id,
          status: 'ignorado',
          motivo: parsed.error.issues.map((i) => i.message).join(' | '),
        });
        continue;
      }

      const originDetail = parsed.data.origem_fiscal;
      const originType = mapOriginType(originDetail);

      const fiscalResult = await updateListingFiscalData({
        itemId: a.ml_item_id,
        sku: parsed.data.sku,
        title: parsed.data.title,
        ncm: normalizeNcm(parsed.data.ncm),
        origin_type: originType,
        origin_detail: originDetail,
        gtin: produto.gtin || undefined,
        cest: produto.cest || undefined,
        csosn: parsed.data.csosn,
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
