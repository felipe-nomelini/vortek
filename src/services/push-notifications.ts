import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase';

type PushEventType = 'new_sale' | 'new_question' | 'claim_opened' | 'test';

type PushInput = {
  eventType: PushEventType;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  userId?: string;
};

const MAX_ATTEMPTS = 5;

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function appUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop';
  return new URL(path, base).toString();
}

async function recipients(input: PushInput): Promise<string[]> {
  if (input.userId) return [input.userId];
  const client = createServiceClient();
  const { data } = await client
    .from('profiles')
    .select('id')
    .in('cargo', ['admin', 'gerente']);
  return Array.from(new Set((data || []).map((row: any) => String(row.id)).filter(Boolean)));
}

export async function enqueuePushNotification(input: PushInput) {
  const client = createServiceClient();
  const { data: config } = await client
    .from('configuracoes')
    .select('notificacoes_push')
    .maybeSingle();
  if (config?.notificacoes_push !== true) return { queued: 0, skipped: true };

  const userIds = await recipients(input);
  if (!userIds.length) return { queued: 0, skipped: true };

  const rows = userIds.map((userId) => ({
    user_id: userId,
    event_type: input.eventType,
    title: input.title,
    body: input.body,
    url: appUrl(input.url),
    payload: input.payload || {},
    dedupe_key: input.dedupeKey,
    status: 'pending',
    available_at: new Date().toISOString(),
  }));
  const { error } = await (client.from('push_notification_outbox' as any)
    .upsert(rows as any, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }) as any);
  if (error) throw new Error(`Falha ao enfileirar push: ${error.message}`);
  return { queued: rows.length, skipped: false };
}

export async function dispatchPushNotifications(limit = 50) {
  if (!configureWebPush()) return { sent: 0, retry: 0, failed: 0, skipped: 'vapid_not_configured' };
  const client = createServiceClient();
  const now = new Date().toISOString();
  const { data: pending } = await (client.from('push_notification_outbox' as any)
    .select('*')
    .in('status', ['pending', 'retry'])
    .lte('available_at', now)
    .order('created_at', { ascending: true })
    .limit(limit) as any);

  let sent = 0;
  let retry = 0;
  let failed = 0;
  for (const notification of pending || []) {
    const attempts = Number(notification.attempts || 0) + 1;
    await (client.from('push_notification_outbox' as any).update({ status: 'processing', attempts, updated_at: now }).eq('id', notification.id) as any);
    const { data: subscriptions } = await (client.from('push_subscriptions' as any)
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', notification.user_id) as any);
    if (!subscriptions?.length) {
      await (client.from('push_notification_outbox' as any).update({ status: 'skipped', last_error: 'Usuário sem inscrição push ativa', updated_at: now }).eq('id', notification.id) as any);
      continue;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: `${notification.event_type}:${notification.dedupe_key}`,
      data: notification.payload || {},
    });
    let delivered = false;
    let lastError = '';
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
        delivered = true;
      } catch (error: any) {
        lastError = error?.body || error?.message || 'Falha ao enviar push';
        if ([404, 410].includes(Number(error?.statusCode))) {
          await (client.from('push_subscriptions' as any).delete().eq('id', subscription.id) as any);
        }
      }
    }
    if (delivered) {
      sent += 1;
      await (client.from('push_notification_outbox' as any).update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', notification.id) as any);
    } else if (attempts >= MAX_ATTEMPTS) {
      failed += 1;
      await (client.from('push_notification_outbox' as any).update({ status: 'failed', last_error: lastError.slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', notification.id) as any);
    } else {
      retry += 1;
      await (client.from('push_notification_outbox' as any).update({ status: 'retry', last_error: lastError.slice(0, 1000), available_at: new Date(Date.now() + attempts * 60000).toISOString(), updated_at: new Date().toISOString() }).eq('id', notification.id) as any);
    }
  }
  return { sent, retry, failed };
}

async function notify(input: PushInput) {
  const result = await enqueuePushNotification(input);
  if (result.queued > 0) void dispatchPushNotifications().catch(() => null);
  return result;
}

export function pushEvents() {
  return {
    newSale: (order: { id?: string | null; ml_order_id?: string | null; contato_nome?: string | null; total?: number | null }) => {
      const orderId = String(order.ml_order_id || order.id || 'unknown');
      return notify({ eventType: 'new_sale', title: 'Nova venda', body: `Pedido #${orderId} · ${order.contato_nome || 'Cliente'} · R$ ${Number(order.total || 0).toFixed(2)}`, url: `/pedidos?search=${encodeURIComponent(orderId)}`, dedupeKey: `new_sale:${orderId}`, payload: order as Record<string, unknown> });
    },
    newQuestion: (question: { id: string | number; item_title?: string | null; text?: string | null }) => notify({ eventType: 'new_question', title: 'Nova pergunta ML', body: question.item_title || question.text || 'Pergunta aguardando resposta', url: '/perguntas', dedupeKey: `new_question:${question.id}`, payload: question }),
    claimOpened: (claim: { id?: string | null; ml_order_id?: string | null; ml_claim_id?: string | null; contato_nome?: string | null }) => notify({ eventType: 'claim_opened', title: 'Nova reclamação ML', body: `Pedido #${claim.ml_order_id || claim.id || '—'} · Claim ${claim.ml_claim_id || '—'}`, url: `/pedidos?search=${encodeURIComponent(String(claim.ml_order_id || claim.id || ''))}`, dedupeKey: `claim_opened:${claim.ml_claim_id}`, payload: claim as Record<string, unknown> }),
  };
}
