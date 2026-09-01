import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { extractNfeAccessKey } from '@/lib/estoque-nfe';
import { resolveStockNfeEnvironment } from '@/lib/estoque-recebimento';
import { createServiceClient } from '@/lib/supabase';
import { manifestarCienciaNotaEntradaBrasilNfe } from '@/services/fiscal-provider';

const schema = z.object({ chave: z.string().max(500), confirmar: z.literal(true) });

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Confirme explicitamente a manifestação.' }, { status: 400 });
  const chave = extractNfeAccessKey(parsed.data.chave);
  if (!chave) return NextResponse.json({ error: 'Chave de NF-e inválida.' }, { status: 400 });

  const tipoAmbiente = resolveStockNfeEnvironment();
  try {
    const result = await manifestarCienciaNotaEntradaBrasilNfe({ chave, tipoAmbiente });
    const successful = result.status === 1 || result.status === 2;
    const db = createServiceClient();
    const { error } = await (db as any).from('estoque_manifestacoes_nfe').upsert({
      chave_nfe: chave,
      tipo_ambiente: tipoAmbiente,
      tipo_manifestacao: 2,
      status: successful ? (result.status === 1 ? 'processada' : 'aguardando_processamento') : 'falha',
      protocolo: result.protocolo,
      motivo: result.motivo,
      requested_by: auth.userId,
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'chave_nfe' });
    if (error) throw new Error(error.message);
    if (!successful) return NextResponse.json({ error: result.motivo || 'A manifestação foi rejeitada.' }, { status: 422 });
    return NextResponse.json({
      success: true,
      pending: result.status === 2,
      message: result.status === 2
        ? 'Ciência enviada e aguardando processamento. Tente obter o XML novamente depois.'
        : 'Ciência da operação registrada. Tente obter o XML novamente.',
    });
  } catch (error: any) {
    const db = createServiceClient();
    const { error: auditError } = await (db as any).from('estoque_manifestacoes_nfe').upsert({
      chave_nfe: chave,
      tipo_ambiente: tipoAmbiente,
      tipo_manifestacao: 2,
      status: 'falha',
      protocolo: null,
      motivo: error?.message || 'Falha ao manifestar ciência da NF-e.',
      requested_by: auth.userId,
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'chave_nfe' });
    if (auditError) console.error('[stock_receipt_manifest_audit_failed]', { chaveSuffix: chave.slice(-6), error: auditError.message });
    return NextResponse.json({ error: error?.message || 'Falha ao manifestar ciência da NF-e.' }, { status: 502 });
  }
}
