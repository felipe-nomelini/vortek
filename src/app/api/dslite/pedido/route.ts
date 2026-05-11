import { NextResponse } from 'next/server';
import { criarPedidoDropshipping, consultarPedido } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { pedidoId, fornecedorId, transportadoraId, xmlConteudo } = await req.json();

    if (!pedidoId || !fornecedorId || !xmlConteudo) {
      return NextResponse.json({ error: 'pedidoId, fornecedorId e xmlConteudo são obrigatórios' }, { status: 400 });
    }

    const result = await criarPedidoDropshipping(fornecedorId, transportadoraId || '', xmlConteudo);

    if (result) {
      const client = createServiceClient();
      await client
        .from('pedidos')
        .update({
          dslite_id: String(result.dsid),
          dslite_status: result.status,
        })
        .eq('id', pedidoId);
    }

    return NextResponse.json({ success: !!result, data: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
