import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { validateMercadoLivreTokenOwner } from '@/lib/ml-account-guard';
import { getMercadoLivreAppUrl, getMercadoLivreRedirectUri } from '@/lib/ml-oauth-config';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { requireAdminUser } from '@/lib/auth/admin';
import { recordConfigurationAudit } from '@/services/configuration-audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');
  const expectedState = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ml_oauth_state='))
    ?.split('=')
    .slice(1)
    .join('=');

  if (error || !code) {
    return NextResponse.json({ erro: 'Autorização negada ou código ausente' }, { status: 400 });
  }

  if (!state || !expectedState || state !== decodeURIComponent(expectedState)) {
    return NextResponse.json({ erro: 'Estado OAuth inválido. Inicie a conexão novamente.' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { data: integracao } = await serviceClient
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .single();

  if (!integracao?.client_id || !integracao?.client_secret) {
    return NextResponse.json({ erro: 'Credenciais do ML não configuradas' }, { status: 400 });
  }

  const redirectUri = getMercadoLivreRedirectUri();

  try {
    const tokenResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: integracao.client_id,
        client_secret: integracao.client_secret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.json({ erro: `Erro ao obter token: ${tokenData.error || tokenData.message || 'desconhecido'}` }, { status: 400 });
    }

    const account = await validateMercadoLivreTokenOwner(tokenData.access_token);
    if (!account.ok) {
      const identity = account.nickname || account.userId || account.error || 'desconhecida';
      if (account.reason !== 'account_not_allowed') {
        return NextResponse.json({
          erro: `Não foi possível validar a conta Mercado Livre: ${identity}. Tente conectar novamente.`,
        }, { status: 502 });
      }

      await serviceClient
        .from('integracoes')
        .update({
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          conectado: false,
          last_refresh_at: new Date().toISOString(),
          last_refresh_error: `Conta Mercado Livre não permitida: ${identity}`,
          last_refresh_error_code: 'ml_account_not_allowed',
          updated_at: new Date().toISOString(),
        })
        .eq('tipo', 'mercadolivre');

      await registrarEventoNfAuditoria({
        evento: 'ml_account_not_allowed',
        respostaMl: {
          source: 'oauth_callback',
          action: 'cleared_tokens',
          user_id: account.userId,
          nickname: account.nickname,
          error: account.error,
          timestamp_utc: new Date().toISOString(),
        },
        statusResultante: 'cleared_tokens',
      });

      return NextResponse.json({
        erro: `Conta Mercado Livre não permitida. Conecte apenas a conta Vortek. Conta detectada: ${identity}`,
      }, { status: 403 });
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 10800) * 1000).toISOString();

    const { error: persistError } = await serviceClient
      .from('integracoes')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        conectado: true,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tipo', 'mercadolivre');
    if (persistError) {
      return NextResponse.json({ erro: 'O token foi emitido, mas não pôde ser salvo com segurança.' }, { status: 500 });
    }

    await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [
      { key: 'integracoes.mercadolivre.oauth_tokens', targetId: 'mercadolivre', before: null, after: tokenData.access_token, force: true },
      { key: 'integracoes.mercadolivre.conectado', targetId: 'mercadolivre', before: false, after: true, action: 'enabled', force: true },
    ]);

    const response = NextResponse.redirect(`${getMercadoLivreAppUrl()}/configuracoes?tab=mercado-livre`);
    response.cookies.delete('ml_oauth_state');
    return response;
  } catch (err) {
    return NextResponse.json({ erro: 'Erro de rede ao conectar com ML' }, { status: 502 });
  }
}
