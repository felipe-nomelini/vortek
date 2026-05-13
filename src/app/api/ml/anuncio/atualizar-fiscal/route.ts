import { NextResponse } from 'next/server';
import { updateListingFiscalData } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { produtoIds } = await req.json().catch(() => ({}));
    const supabase = createServiceClient();

    let query = supabase.from('produtos').select('id, sku, fornecedor, gtin, ncm, cest, csosn, ml_item_id');
    if (produtoIds && produtoIds.length > 0) {
      query = query.in('id', produtoIds);
    } else {
      query = query.not('ml_item_id', 'is', null);
    }

    const { data: produtos, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!produtos || produtos.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum produto encontrado' }, { status: 404 });
    }

    const resultados: any[] = [];
    let sucesso = 0;
    let erro = 0;

    for (const p of produtos) {
      if (!p.ml_item_id) continue;

      if (!p.gtin && !p.ncm) {
        resultados.push({ sku: p.sku, ml_item_id: p.ml_item_id, status: 'ignorado', motivo: 'sem dados fiscais' });
        continue;
      }

      const ok = await updateListingFiscalData(p.ml_item_id, {
        gtin: p.gtin || undefined,
        ncm: p.ncm || undefined,
        cest: p.cest || undefined,
        csosn: p.csosn || '101',
      });

      if (ok) {
        sucesso++;
        resultados.push({ sku: p.sku, ml_item_id: p.ml_item_id, status: 'ok' });
      } else {
        erro++;
        resultados.push({ sku: p.sku, ml_item_id: p.ml_item_id, status: 'erro' });
      }
    }

    return NextResponse.json({
      success: true,
      total: produtos.length,
      sucesso,
      erro,
      resultados,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
