import { NextResponse } from 'next/server';
import { emitirNFe, EmitirNFeInput } from '@/services/nfe';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pedidoId, cliente, produtos, frete, naturezaOperacao } = body;

    if (!pedidoId || !cliente || !produtos?.length) {
      return NextResponse.json({ error: 'pedidoId, cliente e produtos são obrigatórios' }, { status: 400 });
    }

    const input: EmitirNFeInput = {
      cliente: {
        cpfCnpj: cliente.cpfCnpj,
        nome: cliente.nome,
        ie: cliente.ie,
        endereco: cliente.endereco,
        telefone: cliente.telefone,
        email: cliente.email,
      },
      naturezaOperacao: naturezaOperacao || 'Venda de Mercadoria',
      produtos: produtos.map((p: any) => ({
        nome: p.nome,
        ncm: p.ncm || '84713012',
        cfop: p.cfop || 5102,
        quantidade: p.quantidade || 1,
        valorUnitario: p.valorUnitario,
        gtin: p.gtin,
        unidade: p.unidade || 'UN',
      })),
      frete: frete || 0,
    };

    const result = await emitirNFe(input);

    if (result.success) {
      const client = createServiceClient();
      await client
        .from('pedidos')
        .update({
          nota_fiscal_numero: String(result.numero || ''),
          nota_fiscal_emitida: true,
          nfe_chave: result.chave,
          nfe_xml: result.xml,
          nfe_danfe_url: result.danfe,
          nfe_protocolo: result.protocolo,
          nfe_status: 'autorizada',
        })
        .eq('id', pedidoId);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
