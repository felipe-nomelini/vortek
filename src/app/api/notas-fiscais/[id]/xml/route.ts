import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(_request: Request, context: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: 'ID da nota fiscal é obrigatório' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const { data: pedido, error } = await serviceClient
    .from('pedidos')
    .select('id,numero,nota_fiscal_numero,nfe_chave,nfe_xml')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar XML da nota fiscal' }, { status: 500 });
  }
  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }

  const xml = String((pedido as any).nfe_xml || '').trim();
  if (!xml) {
    return NextResponse.json({ error: 'XML da nota fiscal não encontrado' }, { status: 404 });
  }

  const filename = `nfe_${String((pedido as any).nota_fiscal_numero || (pedido as any).numero || id)}.xml`;
  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
