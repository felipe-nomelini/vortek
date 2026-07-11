import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { dispatchPushNotifications, enqueuePushNotification } from '@/services/push-notifications';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const key = `push_test:${user.id}:${new Date().toISOString().slice(0, 16)}`;
  const queued = await enqueuePushNotification({
    userId: user.id,
    eventType: 'test',
    title: 'Push Vortek funcionando',
    body: 'Seu dispositivo está pronto para receber alertas importantes.',
    url: '/configuracoes?tab=preferencias',
    dedupeKey: key,
  });
  if (queued.skipped) return NextResponse.json({ erro: 'Ative e salve notificações push antes de testar.' }, { status: 409 });
  const result = await dispatchPushNotifications(10);
  return NextResponse.json({ ok: true, result });
}
