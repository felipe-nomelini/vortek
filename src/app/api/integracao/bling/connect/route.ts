import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { data: integracao } = await supabase
    .from('integracoes')
    .select('*')
    .eq('tipo', 'bling')
    .single();

  if (!integracao?.client_id) {
    return NextResponse.json({ erro: 'Configure o Client ID do Bling nas Configurações primeiro' }, { status: 400 });
  }

  const state = crypto.randomUUID();

  const url = new URL('https://www.bling.com.br/Api/v3/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', integracao.client_id);
  url.searchParams.set('state', state);

  return NextResponse.redirect(url.toString());
}
