import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { fornecedorId } = await req.json();
    if (!fornecedorId) {
      return NextResponse.json({ error: 'fornecedorId é obrigatório' }, { status: 400 });
    }

    const precos = await sincronizarPrecoEstoque(fornecedorId);
    if (!precos || precos.length === 0) {
      return NextResponse.json({ error: 'Preços vazios ou DSLite não configurado' }, { status: 502 });
    }

    const client = createServiceClient();
    let atualizados = 0;

    for (const item of precos) {
      const { data: produto } = await client
        .from('produtos')
        .select('id')
        .eq('dslite_produto_id', String(item.id))
        .maybeSingle();

      if (produto) {
        await client
          .from('produtos')
          .update({
            custo: item.preco,
            estoque: item.estoque,
            dslite_ultima_sync: new Date().toISOString(),
          })
          .eq('id', produto.id);
        atualizados++;
      }
    }

    return NextResponse.json({
      success: true,
      total: precos.length,
      atualizados,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
