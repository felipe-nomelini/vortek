import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

const CONFIG_ROW_ID = '00000000-0000-0000-0000-000000000001';

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const provider = String(body?.defaultProvider || '').trim().toLowerCase();
  if (provider !== 'brasilnfe') {
    return NextResponse.json({ erro: 'defaultProvider inválido. Use brasilnfe.' }, { status: 422 });
  }

  const { data, error } = await supabase
    .from('configuracoes')
    .upsert({ id: CONFIG_ROW_ID, nfe_provider_default: provider } as any)
    .select('id, nfe_provider_default')
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ success: true, defaultProvider: (data as any)?.nfe_provider_default || provider });
}
