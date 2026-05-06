import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { data: integracao } = await supabase
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .single();

  if (!integracao?.client_id) {
    return NextResponse.json({ erro: 'Configure o Client ID do ML nas Configurações primeiro' }, { status: 400 });
  }

  const redirectUri = integracao.redirect_uri || `${process.env.NEXT_PUBLIC_APP_URL}/api/integracao/ml/callback`;
  const state = crypto.randomUUID();

  const url = new URL('https://auth.mercadolivre.com.br/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', integracao.client_id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  return NextResponse.redirect(url.toString());
}
