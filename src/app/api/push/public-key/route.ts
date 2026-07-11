import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ erro: 'VAPID não configurado' }, { status: 503 });
  return NextResponse.json({ publicKey });
}
