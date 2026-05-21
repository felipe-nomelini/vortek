import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { sendEmail } from '@/services/email';

const DANFE_BUCKET = 'danfes';
const SIGNED_URL_TTL_SECONDS = 60 * 10;

function normalizeDocument(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function formatCpfCnpj(doc: string): string[] {
  if (doc.length === 11) {
    const cpf = `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9, 11)}`;
    return [doc, cpf];
  }
  if (doc.length === 14) {
    const cnpj = `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12, 14)}`;
    return [doc, cnpj];
  }
  return [doc];
}

export async function POST(request: Request, context: { params: { id: string } }) {
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

  const body = await request.json().catch(() => ({}));
  const manualTo = String(body?.to || '').trim();
  const customSubject = String(body?.subject || '').trim();
  const customMessage = String(body?.message || '').trim();

  const serviceClient = createServiceClient();
  const { data: pedido, error: pedidoError } = await serviceClient
    .from('pedidos')
    .select('id, numero, contato_nome, contato_documento, nota_fiscal_numero')
    .eq('id', id)
    .maybeSingle();

  if (pedidoError) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }

  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }

  if (!pedido.nota_fiscal_numero) {
    return NextResponse.json({ error: 'Nota fiscal sem número para envio' }, { status: 422 });
  }

  let autoEmail = '';
  const doc = normalizeDocument(pedido.contato_documento);
  if (doc) {
    const candidates = formatCpfCnpj(doc);
    const { data: cliente } = await serviceClient
      .from('clientes')
      .select('email, documento')
      .in('documento', candidates)
      .limit(1)
      .maybeSingle();
    autoEmail = String(cliente?.email || '').trim();
  }

  const to = manualTo || autoEmail;
  if (!to) {
    return NextResponse.json({ error: 'E-mail do destinatário não encontrado. Informe manualmente.' }, { status: 422 });
  }

  const filePath = `${pedido.numero}/${pedido.nota_fiscal_numero}.pdf`;
  const { data: signedData, error: signedError } = await serviceClient.storage
    .from(DANFE_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado para envio' }, { status: 404 });
  }

  const { data: pdfData, error: pdfError } = await serviceClient.storage
    .from(DANFE_BUCKET)
    .download(filePath);

  if (pdfError || !pdfData) {
    return NextResponse.json({ error: 'Falha ao baixar PDF da DANFE' }, { status: 500 });
  }

  const pdfBuffer = Buffer.from(await pdfData.arrayBuffer());
  const subject = customSubject || `NF-e ${pedido.nota_fiscal_numero} - Pedido #${String(pedido.numero).padStart(6, '0')}`;
  const text =
    customMessage ||
    [
      `Olá ${pedido.contato_nome || ''},`,
      '',
      `Segue em anexo a DANFE da NF-e ${pedido.nota_fiscal_numero}.`,
      `Você também pode acessar pelo link temporário: ${signedData.signedUrl}`,
      '',
      'Mensagem automática Vortek.',
    ].join('\n');

  try {
    await sendEmail({
      to,
      subject,
      text,
      attachments: [
        {
          filename: `danfe_${pedido.nota_fiscal_numero}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    console.log(JSON.stringify({
      event: 'nota_fiscal_email_sent',
      nota_fiscal_numero: pedido.nota_fiscal_numero,
      pedido_numero: pedido.numero,
      to,
      user_id: user.id,
      timestamp_utc: new Date().toISOString(),
    }));

    return NextResponse.json({ success: true, to, nota: pedido.nota_fiscal_numero });
  } catch (err: any) {
    console.error(JSON.stringify({
      event: 'nota_fiscal_email_failed',
      nota_fiscal_numero: pedido.nota_fiscal_numero,
      pedido_numero: pedido.numero,
      to,
      user_id: user.id,
      error: err?.message || 'send_failed',
      timestamp_utc: new Date().toISOString(),
    }));
    return NextResponse.json({ error: 'Falha ao enviar e-mail da nota fiscal' }, { status: 500 });
  }
}
