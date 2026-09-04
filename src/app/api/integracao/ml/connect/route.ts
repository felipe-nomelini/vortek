import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase';
import { getMercadoLivreRedirectUri } from '@/lib/ml-oauth-config';
import { requireAdminUser } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const serviceClient = createServiceClient();

  const { data: integracao } = await serviceClient
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .single();

  if (!integracao?.client_id) {
    return NextResponse.json({ erro: 'Configure o Client ID do ML nas Configurações primeiro' }, { status: 400 });
  }

  let redirectUri: string;
  try {
    redirectUri = getMercadoLivreRedirectUri();
  } catch (error) {
    return NextResponse.json({ erro: error instanceof Error ? error.message : 'URL OAuth inválida' }, { status: 500 });
  }
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
