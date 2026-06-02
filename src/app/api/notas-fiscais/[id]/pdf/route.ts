import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { createDanfeSignedUrl, resolveDanfeStoragePath, DANFE_SIGNED_URL_TTL_SECONDS } from '@/lib/fiscal/danfe-storage';

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
    .select('id, numero, nota_fiscal_numero, nfe_external_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }

  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }

  if (!pedido.nota_fiscal_numero) {
    return NextResponse.json({ error: 'Nota fiscal sem número para gerar PDF' }, { status: 422 });
  }

  const resolved = await resolveDanfeStoragePath(serviceClient, pedido);
  if (!resolved.path) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado no storage' }, { status: 404 });
  }
  const signedUrl = await createDanfeSignedUrl(serviceClient, resolved.path, DANFE_SIGNED_URL_TTL_SECONDS);
  if (!signedUrl) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado no storage' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    url: signedUrl,
    expires_in: DANFE_SIGNED_URL_TTL_SECONDS,
    fallback_legacy: resolved.usedLegacyFallback,
  });
}
