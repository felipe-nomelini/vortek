import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { cancelarNotaBrasilNfePorChave } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

const bodySchema = z.object({ justificativa: z.string().trim().min(15).max(255) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return NextResponse.json({ error: 'Dados de cancelamento inválidos' }, { status: 422 });
  const client = createServiceClient();
  const { data: note, error } = await client
    .from('notas_fiscais_retorno')
    .select('id,pedido_id,status,nfe_chave,nfe_protocolo')
    .eq('id', id.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar a nota' }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  if (note.status === 'cancelled') return NextResponse.json({ success: true, alreadyCanceled: true });
  if (note.status !== 'authorized' || !note.nfe_chave) {
    return NextResponse.json({ error: 'Somente uma nota autorizada pode ser cancelada' }, { status: 422 });
  }
  const result = await cancelarNotaBrasilNfePorChave({
    chave: note.nfe_chave,
    protocolo: note.nfe_protocolo,
    justificativa: body.data.justificativa,
  });
  if (!result.ok) {
    await registrarEventoNfAuditoria({
      pedidoId: note.pedido_id,
      notaRetornoId: note.id,
      evento: 'nota_fiscal_retorno_cancelamento_failed',
      respostaMl: { error: result.error || null },
      statusResultante: 'failed',
    });
    return NextResponse.json({ error: result.error || 'Cancelamento rejeitado' }, { status: 502 });
  }
  const { error: updateError } = await client
    .from('notas_fiscais_retorno')
    .update({ status: 'cancelled', nfe_last_sync_at: new Date().toISOString(), erro: null } as any)
    .eq('id', note.id);
  if (updateError) return NextResponse.json({ error: 'Falha ao persistir o cancelamento' }, { status: 500 });
  await registrarEventoNfAuditoria({
    pedidoId: note.pedido_id,
    notaRetornoId: note.id,
    evento: 'nota_fiscal_retorno_cancelamento_success',
    statusResultante: 'cancelled',
  });
  return NextResponse.json({ success: true });
}
