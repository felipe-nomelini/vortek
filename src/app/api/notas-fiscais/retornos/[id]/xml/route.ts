import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 });
  const { data, error } = await createServiceClient()
    .from('notas_fiscais_retorno')
    .select('nfe_xml,nfe_numero')
    .eq('id', parsed.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar o XML' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  const xml = String(data.nfe_xml || '').trim();
  if (!xml) return NextResponse.json({ error: 'XML ainda não disponível' }, { status: 404 });
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="nfe_retorno_${data.nfe_numero || parsed.data}.xml"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
