import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { enviarCartaCorrecaoBrasilNfePorChave } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

const bodySchema = z.object({
  correcao: z.string().trim().min(15).max(1000),
  numeroSequencial: z.coerce.number().int().min(1).max(20).default(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return NextResponse.json({ error: 'Dados da carta de correção inválidos' }, { status: 422 });
  const client = createServiceClient();
  const { data: note, error } = await client
    .from('notas_fiscais_retorno')
    .select('id,pedido_id,status,nfe_chave,tipo_ambiente')
    .eq('id', id.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar a nota' }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  if (note.status !== 'authorized' || !note.nfe_chave) {
    return NextResponse.json({ error: 'CC-e disponível somente para nota autorizada' }, { status: 422 });
  }
  const result = await enviarCartaCorrecaoBrasilNfePorChave({
    chave: note.nfe_chave,
    correcao: body.data.correcao,
    numeroSequencial: body.data.numeroSequencial,
    tipoAmbiente: note.tipo_ambiente as 1 | 2,
  });
  if (!result.ok) {
    await registrarEventoNfAuditoria({
      pedidoId: note.pedido_id,
      notaRetornoId: note.id,
      evento: 'nota_fiscal_retorno_carta_correcao_failed',
      respostaMl: { error: result.error || null },
      statusResultante: 'failed',
    });
    return NextResponse.json({ error: result.error || 'Carta de correção rejeitada' }, { status: 502 });
  }
  await client.from('notas_fiscais_retorno')
    .update({ nfe_last_sync_at: new Date().toISOString() } as any)
    .eq('id', note.id);
  await registrarEventoNfAuditoria({
    pedidoId: note.pedido_id,
    notaRetornoId: note.id,
    evento: 'nota_fiscal_retorno_carta_correcao_success',
    respostaMl: { protocolo: result.protocolo || null },
    statusResultante: 'success',
  });
  return NextResponse.json({ success: true, protocolo: result.protocolo || null });
}
