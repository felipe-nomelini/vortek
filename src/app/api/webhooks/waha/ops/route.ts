import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { processOpsWhatsappCommand } from '@/services/ops-whatsapp-agent';
import { sendWahaText } from '@/services/waha';

export const runtime = 'nodejs';
export const maxDuration = 60;

type IncomingMessage = {
  chatId: string;
  phone: string;
  text: string;
  fromMe: boolean;
};

const DEFAULT_AUTHORIZED_PHONES = ['21981172939', '21970066090'];

function onlyDigits(input: unknown) {
  return String(input || '').replace(/\D/g, '');
}

function normalizePhone(input: unknown) {
  const digits = onlyDigits(input);
  if (digits.startsWith('55') && digits.length > 11) return digits.slice(2);
  return digits;
}

function getAuthorizedPhones() {
  const raw = String(process.env.OPS_WHATSAPP_AUTHORIZED_PHONES || process.env.WHATSAPP_ALERT_PHONES || '').trim();
  const phones = raw ? raw.split(',') : DEFAULT_AUTHORIZED_PHONES;
  return new Set(phones.map(normalizePhone).filter(Boolean));
}

function isAuthorized(phone: string) {
  return getAuthorizedPhones().has(normalizePhone(phone));
}

function checkWebhookSecret(req: Request) {
  const expected = String(process.env.WAHA_OPS_WEBHOOK_SECRET || '').trim();
  if (!expected) return process.env.NODE_ENV !== 'production';

  const url = new URL(req.url);
  const received = req.headers.get('x-vortek-webhook-secret')
    || req.headers.get('x-webhook-secret')
    || url.searchParams.get('secret')
    || '';
  return received === expected;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractIncomingMessage(body: any): IncomingMessage | null {
  const payload = body?.payload || body?.data || body?.message || body || {};
  const fromMe = Boolean(
    payload.fromMe
    || payload.from_me
    || payload?._data?.id?.fromMe
    || payload?.id?.fromMe
  );

  const chatId = firstString(
    payload.chatId,
    payload.from,
    payload.fromId,
    payload?._data?.from,
    payload?._data?.id?.remote,
    body?.chatId,
  );

  const text = firstString(
    payload.body,
    payload.text,
    payload.caption,
    payload?._data?.body,
    payload?.message?.conversation,
    body?.body,
    body?.text,
  );

  if (!chatId || !text) return null;
  const phone = normalizePhone(chatId.split('@')[0]);
  return { chatId, phone, text, fromMe };
}

async function auditEvent(input: {
  chatId: string;
  phone?: string | null;
  direction: 'in' | 'out';
  command?: string | null;
  action?: string | null;
  issueNumber?: number | null;
  status: string;
  message?: string | null;
  payload?: unknown;
  error?: string | null;
}) {
  const client = createServiceClient();
  await (client as any).from('ops_whatsapp_events').insert({
    chat_id: input.chatId,
    phone: input.phone || null,
    direction: input.direction,
    command: input.command || null,
    action: input.action || null,
    issue_number: input.issueNumber || null,
    status: input.status,
    message: input.message || null,
    payload: input.payload || null,
    error: input.error || null,
  } as any);
}

async function getRecentHistory(chatId: string) {
  const client = createServiceClient();
  const { data } = await (client as any)
    .from('ops_whatsapp_events')
    .select('direction, command, action, issue_number, message, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(10);

  return (data || []).map((item: any) => ({
    direction: item.direction || null,
    command: item.command || null,
    action: item.action || null,
    issueNumber: item.issue_number || null,
    message: item.message || null,
  }));
}

export async function POST(req: Request) {
  if (!checkWebhookSecret(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized_webhook' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const incoming = extractIncomingMessage(body);
  if (!incoming) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_message' });
  }

  if (incoming.fromMe) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'from_me' });
  }

  await auditEvent({
    chatId: incoming.chatId,
    phone: incoming.phone,
    direction: 'in',
    command: incoming.text,
    status: isAuthorized(incoming.phone) ? 'received' : 'unauthorized',
    payload: body,
  }).catch(() => null);

  if (!isAuthorized(incoming.phone)) {
    await sendWahaText({
      chatId: incoming.chatId,
      text: 'Número não autorizado para comandos operacionais Vortek.',
    }).catch(() => null);
    return NextResponse.json({ ok: true, skipped: true, reason: 'unauthorized_phone' });
  }

  try {
    const result = await processOpsWhatsappCommand({
      text: incoming.text,
      phone: incoming.phone,
      history: await getRecentHistory(incoming.chatId).catch(() => []),
    });

    await sendWahaText({ chatId: incoming.chatId, text: result.text });
    await auditEvent({
      chatId: incoming.chatId,
      phone: incoming.phone,
      direction: 'out',
      command: incoming.text,
      action: result.command.intent,
      issueNumber: result.command.issueNumber || null,
      status: result.status,
      message: result.text,
      payload: result,
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      action: result.command.intent,
      issueNumber: result.command.issueNumber || null,
      status: result.status,
    });
  } catch (err: any) {
    const message = err?.message || 'Erro ao processar comando operacional.';
    await sendWahaText({
      chatId: incoming.chatId,
      text: `Falha ao processar comando: ${message}`,
    }).catch(() => null);
    await auditEvent({
      chatId: incoming.chatId,
      phone: incoming.phone,
      direction: 'out',
      command: incoming.text,
      status: 'error',
      message,
      payload: body,
      error: message,
    }).catch(() => null);

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
