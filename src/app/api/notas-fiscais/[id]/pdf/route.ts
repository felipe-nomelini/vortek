import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { createDanfeSignedUrl, ensureDanfeStoredForPedido, resolveDanfeStoragePath, DANFE_SIGNED_URL_TTL_SECONDS } from '@/lib/fiscal/danfe-storage';
import { getFiscalProvider } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

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
    .select('id, numero, nota_fiscal_numero, nfe_external_id, ml_order_id')
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
  let resolvedPath = resolved.path;
  let usedLegacyFallback = resolved.usedLegacyFallback;
  let signedUrl = resolvedPath
    ? await createDanfeSignedUrl(serviceClient, resolvedPath, DANFE_SIGNED_URL_TTL_SECONDS)
    : null;

  if (!signedUrl) {
    await registrarEventoNfAuditoria({
      pedidoId: pedido.id,
      mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
      evento: 'nfe_danfe_persistencia',
      payloadEnviado: {
        source: 'pdf_route_on_read_recovery',
        canonical_path: resolved.canonicalPath,
        legacy_path: resolved.legacyPath,
      },
      respostaMl: {
        storage_miss_canonical: Boolean(resolved.canonicalPath),
        storage_miss_legacy: Boolean(resolved.legacyPath),
        provider_fetch_attempt: Boolean(pedido.nfe_external_id),
      },
      statusResultante: 'storage_miss',
    });

    if (pedido.nfe_external_id) {
      const provider = getFiscalProvider('brasilnfe');
      const danfeBackfill = await ensureDanfeStoredForPedido({
        client: serviceClient,
        provider,
        pedido,
        pedidoId: pedido.id,
        mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
        source: 'pdf_route_on_read_recovery',
      });

      if (danfeBackfill.ok && danfeBackfill.signedUrl) {
        signedUrl = danfeBackfill.signedUrl;
        resolvedPath = danfeBackfill.canonicalPath;
        usedLegacyFallback = false;
        await serviceClient
          .from('pedidos')
          .update({
            nota_fiscal_emitida: true,
            nfe_danfe_url: signedUrl,
            nfe_last_sync_at: new Date().toISOString(),
          } as any)
          .eq('id', pedido.id);
      } else {
        await serviceClient
          .from('pedidos')
          .update({
            nota_fiscal_emitida: false,
            nfe_danfe_url: null,
            nfe_last_sync_at: new Date().toISOString(),
          } as any)
          .eq('id', pedido.id);

        return NextResponse.json({
          error: danfeBackfill.error || 'PDF da DANFE não encontrado no storage e a recuperação no provider falhou',
        }, { status: 404 });
      }
    } else {
      await serviceClient
        .from('pedidos')
        .update({
          nota_fiscal_emitida: false,
          nfe_danfe_url: null,
          nfe_last_sync_at: new Date().toISOString(),
        } as any)
        .eq('id', pedido.id);
      return NextResponse.json({ error: 'PDF da DANFE não encontrado no storage' }, { status: 404 });
    }
  }

  return NextResponse.json({
    success: true,
    url: signedUrl,
    expires_in: DANFE_SIGNED_URL_TTL_SECONDS,
    fallback_legacy: usedLegacyFallback,
    storage_path: resolvedPath,
  });
}
