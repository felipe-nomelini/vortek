import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyPublicNfeToken } from '@/lib/public-nfe-links';

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context?.params?.id;
  const token = new URL(request.url).searchParams.get('token');
  if (!id || !verifyPublicNfeToken(id, 'xml', token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 403 });
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
      'Cache-Control': 'private, max-age=300',
    },
  });
}
