import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase';
import { getMercadoLivreRedirectUri } from '@/lib/ml-oauth-config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { data: integracao } = await serviceClient
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .single();

  if (!integracao?.client_id) {
    return NextResponse.json({ erro: 'Configure o Client ID do ML nas Configurações primeiro' }, { status: 400 });
  }

  const redirectUri = getMercadoLivreRedirectUri();
  const state = randomUUID();

  const url = new URL('https://auth.mercadolivre.com.br/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', integracao.client_id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('ml_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
