import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
      return NextResponse.json({ erro: 'Autorização negada ou código ausente' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data: integracao } = await serviceClient
      .from('integracoes')
      .select('*')
      .eq('tipo', 'bling')
      .single();

    if (!integracao?.client_id || !integracao?.client_secret) {
      return NextResponse.json({ erro: 'Credenciais do Bling não configuradas' }, { status: 400 });
    }

    const basicAuth = Buffer.from(`${integracao.client_id}:${integracao.client_secret}`).toString('base64');

    const tokenResponse = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
        'Authorization': `Basic ${basicAuth}`,
        'enable-jwt': '1',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }),
    });

    const text = await tokenResponse.text();
    let tokenData: any;
    try {
      tokenData = JSON.parse(text);
    } catch {
      return NextResponse.json({ erro: `Resposta do Bling: ${text.substring(0, 500)}` }, { status: 400 });
    }

    if (!tokenResponse.ok) {
      return NextResponse.json({ erro: `Erro ao obter token: ${JSON.stringify(tokenData.error || tokenData)}` }, { status: 400 });
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();

    const updateClient = createServiceClient();
    await updateClient
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
  } catch (err) {
    console.error('[Bling Callback] Erro:', err);
    return NextResponse.json({ erro: `${err instanceof Error ? err.message : 'Erro desconhecido'}` }, { status: 500 });
  }
}
