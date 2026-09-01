import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createDanfeSignedUrl, ensureDanfeStoredForPedido, resolveDanfeStoragePath, DANFE_SIGNED_URL_TTL_SECONDS } from '@/lib/fiscal/danfe-storage';
import { getFiscalProvider } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
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
    .select('id, numero, nota_fiscal_numero, nfe_external_id, nfe_chave, ml_order_id, snapshot_source')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }

  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }
  if (isHomologationFixtureSource((pedido as any).snapshot_source)) {
    return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
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
