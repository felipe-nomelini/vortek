import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashWebhookBody, loadConfiguredCompanyCnpj } from '@/lib/fiscal/incoming-nfe';
import { resolveStockNfeEnvironment } from '@/lib/estoque-recebimento';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const envelopeSchema = z.object({
  event: z.string().min(1),
  deliveryId: z.string().min(8).max(200),
  timestamp: z.string().datetime({ offset: true }),
  data: z.record(z.any()),
});

function validSignature(rawBody: string, received: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const secret = String(process.env.BRASILNFE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error('[brasilnfe_webhook_not_configured]');
    return NextResponse.json({ error: 'Webhook indisponível.' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';
  if (!validSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody || 'null');
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  const deliveryHeader = request.headers.get('x-webhook-delivery') || '';
  const eventHeader = request.headers.get('x-webhook-event') || '';
  const timestampHeader = request.headers.get('x-webhook-timestamp') || '';
  if (
    deliveryHeader !== parsed.data.deliveryId
    || eventHeader !== parsed.data.event
    || timestampHeader !== parsed.data.timestamp
  ) {
    return NextResponse.json({ error: 'Headers divergentes do payload.' }, { status: 400 });
  }

  const eventAt = new Date(parsed.data.timestamp);
  if (Math.abs(Date.now() - eventAt.getTime()) > 2 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Evento fora da janela aceita.' }, { status: 409 });
  }
  if (parsed.data.event === 'test.ping') {
    return NextResponse.json({ received: true, event: 'test.ping' });
  }
  if (!['documento.entrada.recebida', 'documento.entrada.cancelada'].includes(parsed.data.event)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const db = createServiceClient();
    const companyCnpj = await loadConfiguredCompanyCnpj(db);
    const attempt = Number(request.headers.get('x-webhook-attempt') || 1);
    const { data, error } = await (db as any).rpc('process_brasilnfe_incoming_webhook', {
      p_delivery_id: parsed.data.deliveryId,
      p_event: parsed.data.event,
      p_event_at: parsed.data.timestamp,
      p_attempt: Number.isInteger(attempt) ? attempt : 1,
      p_body_sha256: hashWebhookBody(rawBody),
      p_tipo_ambiente: resolveStockNfeEnvironment(),
      p_expected_recipient_cnpj: companyCnpj,
      p_data: parsed.data.data,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ received: true, result: data });
  } catch (error: any) {
    console.error('[brasilnfe_webhook_failed]', { error: error?.message || error });
    return NextResponse.json({ error: 'Falha ao persistir o evento.' }, { status: 500 });
  }
}
