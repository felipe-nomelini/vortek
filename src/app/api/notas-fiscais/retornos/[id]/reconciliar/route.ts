import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { normalizeNfePersistedStatus } from '@/lib/fiscal/nfe-status';
import { getFiscalProvider } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 });
  const client = createServiceClient();
  const { data: note, error } = await client
    .from('notas_fiscais_retorno')
    .select('id,pedido_id,status,nfe_external_id')
    .eq('id', id.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar a nota' }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  if (!note.nfe_external_id) return NextResponse.json({ error: 'Nota sem identificador externo para consulta' }, { status: 422 });
  const result = await getFiscalProvider('brasilnfe').consultarNota(note.nfe_external_id);
  if (!result.ok) return NextResponse.json({ error: result.error || 'Falha ao consultar a Brasil NFe' }, { status: 502 });
  const observedStatus = normalizeNfePersistedStatus(result.status);
  const status = observedStatus === 'authorized' || observedStatus === 'cancelled'
    ? observedStatus
    : observedStatus === 'rejected' || observedStatus === 'denied'
      ? 'rejected'
      : observedStatus === 'pending' || observedStatus === 'processing'
        ? observedStatus
        : 'interrupted';
  await client.from('notas_fiscais_retorno')
    .update({ status, nfe_last_sync_at: new Date().toISOString(), erro: null } as any)
    .eq('id', note.id);
  await registrarEventoNfAuditoria({
    pedidoId: note.pedido_id,
    notaRetornoId: note.id,
    evento: 'nota_fiscal_retorno_reconciliado',
    statusResultante: status,
  });
  return NextResponse.json({ success: true, status });
}
