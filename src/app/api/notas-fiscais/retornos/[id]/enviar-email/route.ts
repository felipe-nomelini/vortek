import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { getFiscalProvider } from '@/services/fiscal-provider';
import { sendEmail } from '@/services/email';

const bodySchema = z.object({
  to: z.string().trim().email().optional().or(z.literal('')),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(3000).optional(),
});

function documentCandidates(value: unknown): string[] {
  const doc = String(value || '').replace(/\D/g, '');
  if (doc.length === 11) return [doc, `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`];
  if (doc.length === 14) return [doc, `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`];
  return doc ? [doc] : [];
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!id.success || !body.success) return NextResponse.json({ error: 'Dados de e-mail inválidos' }, { status: 422 });
  const client = createServiceClient();
  const { data: note, error } = await client
    .from('notas_fiscais_retorno')
    .select('id,status,nfe_numero,nfe_external_id,nfe_chave,nfe_danfe_url,pedidos(numero,contato_nome,contato_documento)')
    .eq('id', id.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao buscar a nota' }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
  if (note.status !== 'authorized') return NextResponse.json({ error: 'E-mail disponível somente após autorização' }, { status: 422 });
  const order = Array.isArray(note.pedidos) ? note.pedidos[0] : note.pedidos;
  let to = body.data.to || '';
  if (!to) {
    const candidates = documentCandidates((order as any)?.contato_documento);
    if (candidates.length) {
      const { data: customer } = await client.from('clientes').select('email').in('documento', candidates).limit(1).maybeSingle();
      to = String(customer?.email || '').trim();
    }
  }
  if (!to) return NextResponse.json({ error: 'Informe o e-mail do destinatário' }, { status: 422 });
  let danfeUrl = String(note.nfe_danfe_url || '').trim() || null;
  if (!danfeUrl && note.nfe_external_id) {
    const result = await getFiscalProvider('brasilnfe').obterDanfe(note.nfe_external_id, { chaveNf: note.nfe_chave });
    danfeUrl = result.url;
  }
  if (!danfeUrl) return NextResponse.json({ error: 'DANFE ainda não disponível' }, { status: 404 });
  const pdfResponse = await fetch(danfeUrl, { cache: 'no-store' });
  if (!pdfResponse.ok) return NextResponse.json({ error: 'Falha ao baixar a DANFE' }, { status: 502 });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  await sendEmail({
    to,
    subject: body.data.subject || `NF-e de devolução ${note.nfe_numero || ''} - Bentevi`,
    text: body.data.message || [
      `Olá ${(order as any)?.contato_nome || ''},`, '',
      `Segue a DANFE da NF-e de devolução ${note.nfe_numero || ''}.`, '',
      'Mensagem automática Bentevi.',
    ].join('\n'),
    attachments: [{
      filename: `danfe_retorno_${note.nfe_numero || note.id}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    }],
  });
  return NextResponse.json({ success: true, to });
}
