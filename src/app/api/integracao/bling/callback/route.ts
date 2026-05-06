import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.json({ erro: 'Autorização negada ou código ausente' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: integracao } = await supabase
    .from('integracoes')
    .select('*')
    .eq('tipo', 'bling')
    .single();

  if (!integracao?.client_id || !integracao?.client_secret) {
    return NextResponse.json({ erro: 'Credenciais do Bling não configuradas' }, { status: 400 });
  }

  const basicAuth = Buffer.from(`${integracao.client_id}:${integracao.client_secret}`).toString('base64');

  try {
    const tokenResponse = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.json({ erro: `Erro ao obter token: ${tokenData.error || 'desconhecido'}` }, { status: 400 });
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();

    const serviceClient = createServiceClient();
    await serviceClient
      .from('integracoes')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        conectado: true,
        updated_at: new Date().toISOString(),
      })
      .eq('tipo', 'bling');

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/configuracoes?tab=integracoes`);
  } catch {
    return NextResponse.json({ erro: 'Erro de rede ao conectar com Bling' }, { status: 502 });
  }
}
