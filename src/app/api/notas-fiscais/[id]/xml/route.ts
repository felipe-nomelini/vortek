import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  HOMOLOGATION_FIXTURE_READ_ONLY_ERROR,
  isHomologationFixtureSource,
} from '@/lib/homologation-fixture';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;

  const id = (await context?.params)?.id;
  if (!id) {
    return NextResponse.json({ error: 'ID da nota fiscal é obrigatório' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const { data: pedido, error } = await serviceClient
    .from('pedidos')
    .select('id,numero,nota_fiscal_numero,nfe_chave,nfe_xml,snapshot_source')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar XML da nota fiscal' }, { status: 500 });
  }
  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }
  if (isHomologationFixtureSource((pedido as any).snapshot_source)) {
    return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
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
