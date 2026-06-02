import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { ensureDanfeStoredForPedido, resolveDanfeStoragePath } from '@/lib/fiscal/danfe-storage';
import { getFiscalProvider } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

function isAuthorizedRequest(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key') || '';
  return Boolean(apiKey && apiKey === process.env.API_SECRET_KEY);
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const pedidoNumeros = Array.isArray(body?.pedidoNumeros)
    ? body.pedidoNumeros.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];

  const client = createServiceClient();
  let query = client
    .from('pedidos')
    .select('id,numero,ml_order_id,nota_fiscal_numero,nota_fiscal_emitida,nfe_status,nfe_external_id,nfe_chave,nfe_danfe_url,nfe_last_sync_at')
    .eq('nfe_status', 'authorized')
    .not('nota_fiscal_numero', 'is', null)
    .not('nfe_chave', 'is', null)
    .order('data', { ascending: false });

  if (pedidoNumeros.length > 0) {
    query = query.in('numero', pedidoNumeros);
  }

  const { data: pedidos, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Falha ao carregar pedidos para backfill de DANFE' }, { status: 500 });
  }

  const provider = getFiscalProvider('brasilnfe');
  const results: Array<Record<string, any>> = [];
  let totalRecuperado = 0;
  let totalFaltante = 0;

  for (const pedido of pedidos || []) {
    const resolved = await resolveDanfeStoragePath(client, pedido as any);
    if (resolved.path) {
      if (!pedido.nota_fiscal_emitida || !pedido.nfe_danfe_url) {
        await client
          .from('pedidos')
          .update({
            nota_fiscal_emitida: true,
            nfe_last_sync_at: new Date().toISOString(),
          } as any)
          .eq('id', pedido.id);
      }
      results.push({
        pedidoNumero: pedido.numero,
        notaFiscalNumero: pedido.nota_fiscal_numero,
        status: 'already_available',
        storagePath: resolved.path,
      });
      totalRecuperado += 1;
      continue;
    }

    await registrarEventoNfAuditoria({
      pedidoId: pedido.id,
      mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
      evento: 'nfe_danfe_persistencia',
      payloadEnviado: {
        source: 'backfill_danfes',
        storage_path: resolved.canonicalPath,
        download_mode: String((pedido as any).nfe_chave || '').trim() ? 'chave_nf' : 'legacy_external_id',
        nfe_chave: (pedido as any).nfe_chave || null,
      },
      respostaMl: {
        storage_miss_canonical: Boolean(resolved.canonicalPath),
        storage_miss_legacy: Boolean(resolved.legacyPath),
        provider_fetch_attempt: true,
      },
      statusResultante: 'storage_miss',
    });

    const backfill = await ensureDanfeStoredForPedido({
      client,
      provider,
      pedido: pedido as any,
      pedidoId: pedido.id,
      mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
      source: 'backfill_danfes',
    });

    if (backfill.ok && backfill.signedUrl) {
      await client
        .from('pedidos')
        .update({
          nota_fiscal_emitida: true,
          nfe_danfe_url: backfill.signedUrl,
          nfe_last_sync_at: new Date().toISOString(),
        } as any)
        .eq('id', pedido.id);
      results.push({
        pedidoNumero: pedido.numero,
        notaFiscalNumero: pedido.nota_fiscal_numero,
        status: 'recovered',
        storagePath: backfill.canonicalPath,
      });
      totalRecuperado += 1;
    } else {
      await client
        .from('pedidos')
        .update({
          nota_fiscal_emitida: false,
          nfe_danfe_url: null,
          nfe_last_sync_at: new Date().toISOString(),
        } as any)
        .eq('id', pedido.id);
      results.push({
        pedidoNumero: pedido.numero,
        notaFiscalNumero: pedido.nota_fiscal_numero,
        status: 'failed',
        error: backfill.error || 'Falha ao recuperar DANFE no provider',
      });
      totalFaltante += 1;
    }
  }

  return NextResponse.json({
    success: true,
    total_analisado: (pedidos || []).length,
    total_recuperado: totalRecuperado,
    total_ainda_faltante: totalFaltante,
    results,
  });
}
