import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  DANFE_BUCKET,
  ensureDanfeStoredForPedido,
  resolveDanfeStoragePath,
} from '@/lib/fiscal/danfe-storage';
import { verifyPublicNfeToken } from '@/lib/public-nfe-links';
import { getFiscalProvider } from '@/services/fiscal-provider';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context?.params)?.id;
  const token = new URL(request.url).searchParams.get('token');
  if (!id || !verifyPublicNfeToken(id, 'danfe', token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 403 });
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
  let storagePath = resolved.path;

  if (!storagePath && pedido.nfe_external_id) {
    const provider = getFiscalProvider('brasilnfe');
    const backfill = await ensureDanfeStoredForPedido({
      client: serviceClient,
      provider,
      pedido,
      pedidoId: pedido.id,
      mlOrderId: String((pedido as any).ml_order_id || '').trim() || null,
      source: 'public_danfe_route_on_read_recovery',
    });
    storagePath = backfill.ok ? backfill.canonicalPath : null;
  }

  if (!storagePath) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado' }, { status: 404 });
  }

  const { data: pdf, error: downloadError } = await serviceClient.storage
    .from(DANFE_BUCKET)
    .download(storagePath);
  if (downloadError || !pdf) {
    return NextResponse.json({ error: 'Falha ao carregar PDF da DANFE' }, { status: 404 });
  }

  return new Response(pdf.stream(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="danfe_${pedido.nota_fiscal_numero}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
