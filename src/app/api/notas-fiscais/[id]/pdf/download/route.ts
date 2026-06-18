import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  createDanfeSignedUrl,
  ensureDanfeStoredForPedido,
  resolveDanfeStoragePath,
  DANFE_SIGNED_URL_TTL_SECONDS,
} from '@/lib/fiscal/danfe-storage';
import { getFiscalProvider } from '@/services/fiscal-provider';

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
    .select('id, numero, nota_fiscal_numero, nfe_external_id, nfe_chave, ml_order_id')
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
  let signedUrl = resolved.path
    ? await createDanfeSignedUrl(serviceClient, resolved.path, DANFE_SIGNED_URL_TTL_SECONDS)
    : null;

  if (!signedUrl && pedido.nfe_external_id) {
    const provider = getFiscalProvider('brasilnfe');
    const backfill = await ensureDanfeStoredForPedido({
      client: serviceClient,
      provider,
      pedido,
      pedidoId: pedido.id,
      mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
      source: 'pdf_download_route_on_read_recovery',
    });
    signedUrl = backfill.signedUrl;
  }

  if (!signedUrl) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado' }, { status: 404 });
  }

  return NextResponse.redirect(signedUrl, 302);
}
