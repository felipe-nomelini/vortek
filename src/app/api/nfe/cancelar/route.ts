import { NextResponse } from 'next/server';
import { cancelarNFe } from '@/services/nfe';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { pedidoId, chave, motivo } = await req.json();
    if (!chave || !motivo) {
      return NextResponse.json({ error: 'chave e motivo são obrigatórios' }, { status: 400 });
    }

    const result = await cancelarNFe({ chave, motivo });

    if (result.success && pedidoId) {
      const client = createServiceClient();
      await client
        .from('pedidos')
        .update({
          nota_fiscal_emitida: false,
          nfe_status: 'cancelada',
        })
        .eq('id', pedidoId);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
