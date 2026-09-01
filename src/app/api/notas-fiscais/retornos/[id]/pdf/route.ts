import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { getFiscalProvider } from '@/services/fiscal-provider';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 });
  const client = createServiceClient();
  const { data, error } = await client
    .from('notas_fiscais_retorno')
    .select('nfe_external_id,nfe_chave,nfe_danfe_url,status')
    .eq('id', parsed.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar a DANFE' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  if (data.status !== 'authorized') return NextResponse.json({ error: 'DANFE disponível somente após autorização' }, { status: 422 });
  let url = String(data.nfe_danfe_url || '').trim() || null;
  if (!url && data.nfe_external_id) {
    const result = await getFiscalProvider('brasilnfe').obterDanfe(data.nfe_external_id, { chaveNf: data.nfe_chave });
    url = result.url;
    if (url) {
      await client.from('notas_fiscais_retorno').update({ nfe_danfe_url: url } as any).eq('id', parsed.data);
    }
  }
  if (!url) return NextResponse.json({ error: 'DANFE ainda não disponível' }, { status: 404 });
  return NextResponse.json({ success: true, url });
}
