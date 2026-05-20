import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getItemFiscalData, checkCanInvoice, searchItemBySellerSku, updateListingFiscalData } from '@/services/mercadolibre';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sku = body.sku || 'HYX80610';
    const supabase = createServiceClient();

    const produto = await supabase.from('produtos').select('*').eq('sku', sku).maybeSingle();
    if (!produto.data) {
      return NextResponse.json({ success: false, error: 'Produto não encontrado no banco', sku }, { status: 404 });
    }

    const prod = produto.data;

    let mlItemId = prod.ml_item_id;
    if (!mlItemId) {
      const anuncio = await supabase.from('anuncios_ml').select('ml_item_id').eq('sku', sku).maybeSingle();
      mlItemId = anuncio.data?.ml_item_id || null;
    }
    if (!mlItemId) {
      mlItemId = await searchItemBySellerSku(sku);
    }
    if (!mlItemId) {
      return NextResponse.json({ success: false, error: 'Anúncio ML não encontrado', sku }, { status: 404 });
    }

    const existing = await getItemFiscalData(mlItemId);
    if (existing.success) {
      return NextResponse.json({
        success: true,
        message: 'SKU já possui dados fiscais',
        mlItemId,
        dadosFiscais: existing.data,
      });
    }

    if (!prod.ncm) {
      return NextResponse.json({ success: false, error: 'Produto sem NCM', sku }, { status: 200 });
    }

    const originDetail = prod.origem_fiscal || '0';
    const originType = originDetail === '3' || originDetail === '5' || originDetail === '8' ? 'imported'
      : originDetail === '1' ? 'manufacturer'
      : 'reseller';

    const fiscalResult = await updateListingFiscalData({
      itemId: mlItemId,
      sku,
      title: prod.nome,
      ncm: prod.ncm,
      origin_type: originType,
      origin_detail: originDetail,
      gtin: prod.gtin || undefined,
      cest: prod.cest || undefined,
      csosn: prod.csosn || undefined,
      net_weight: prod.peso_liq || undefined,
      gross_weight: prod.peso_bruto || undefined,
      measurement_unit: 'UN',
      cost: prod.custo,
    });

    if (!fiscalResult.success) {
      return NextResponse.json({
        success: false,
        step: fiscalResult.step,
        error: fiscalResult.error,
        fields: fiscalResult.fields,
      }, { status: 200 });
    }

    const verifyResult = await getItemFiscalData(mlItemId);
    const canInvoiceResult = await checkCanInvoice(mlItemId);

    return NextResponse.json({
      success: true,
      sku,
      mlItemId,
      dadosFiscais: verifyResult.success ? verifyResult.data : null,
      podeFaturar: canInvoiceResult.success ? canInvoiceResult.data : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
