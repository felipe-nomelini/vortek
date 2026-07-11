import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

function parseSubscription(body: any) {
  const endpoint = String(body?.endpoint || '').trim();
  const p256dh = String(body?.keys?.p256dh || '').trim();
  const auth = String(body?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const subscription = parseSubscription(await request.json().catch(() => null));
  if (!subscription) return NextResponse.json({ erro: 'Inscrição push inválida' }, { status: 422 });

  const client = createServiceClient();
  const { error } = await (client.from('push_subscriptions' as any).upsert({
    user_id: user.id,
    ...subscription,
    user_agent: request.headers.get('user-agent'),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any, { onConflict: 'endpoint' }) as any);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const endpoint = String((await request.json().catch(() => ({})))?.endpoint || '').trim();
  if (!endpoint) return NextResponse.json({ erro: 'Endpoint obrigatório' }, { status: 422 });
  const client = createServiceClient();
  const { error } = await (client.from('push_subscriptions' as any).delete().eq('user_id', user.id).eq('endpoint', endpoint) as any);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
