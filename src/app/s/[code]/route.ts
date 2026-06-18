import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt).getTime();
  return Number.isFinite(parsed) && parsed < Date.now();
}

export async function GET(_request: Request, context: { params: { code: string } }) {
  const code = String(context?.params?.code || '').trim();
  if (!code) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 404 });
  }

  const client = createServiceClient();
  const { data, error } = await (client as any)
    .from('short_links')
    .select('code,target_url,expires_at,hit_count')
    .eq('code', code)
    .maybeSingle();

  if (error || !data?.target_url || isExpired(data.expires_at)) {
    return NextResponse.json({ error: 'Link não encontrado ou expirado' }, { status: 404 });
  }

  void (client as any)
    .from('short_links')
    .update({
      hit_count: Number(data.hit_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq('code', code);

  return NextResponse.redirect(String(data.target_url), 302);
}
