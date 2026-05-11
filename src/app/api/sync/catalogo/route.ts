import { NextResponse } from 'next/server';
import { sincronizarCatalogo } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { fornecedorId } = await req.json();
    if (!fornecedorId) {
      return NextResponse.json({ error: 'fornecedorId é obrigatório' }, { status: 400 });
    }

    const catalogo = await sincronizarCatalogo(fornecedorId);
    if (!catalogo || catalogo.length === 0) {
      return NextResponse.json({ error: 'Catálogo vazio ou DSLite não configurado' }, { status: 502 });
    }

    const client = createServiceClient();
    let inseridos = 0;
    let atualizados = 0;

    for (const item of catalogo) {
      const { data: existing } = await client
        .from('produtos')
        .select('id')
        .eq('sku', String(item.codigo || item.id))
        .maybeSingle();

      if (existing) {
        await client
          .from('produtos')
          .update({
            nome: item.nome,
            marca: item.marca || null,
            gtin: item.gtin || null,
            dslite_fornecedor_id: String(fornecedorId),
            dslite_produto_id: String(item.id),
            dslite_ultima_sync: new Date().toISOString(),
          })
          .eq('id', existing.id);
        atualizados++;
      } else {
        await client
          .from('produtos')
          .insert({
            sku: String(item.codigo || item.id),
            nome: item.nome,
            marca: item.marca || null,
            gtin: item.gtin || null,
            categoria: item.categoria || null,
            dslite_fornecedor_id: String(fornecedorId),
            dslite_produto_id: String(item.id),
            dslite_ultima_sync: new Date().toISOString(),
            custo: item.preco || 0,
            estoque: item.estoque || 0,
          });
        inseridos++;
      }
    }

    return NextResponse.json({
      success: true,
      total: catalogo.length,
      inseridos,
      atualizados,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
