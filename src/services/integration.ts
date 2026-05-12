/**
 * Gerenciamento de tokens OAuth para integrações com APIs externas.
 * Atualmente suporta Mercado Livre (OAuth2 com refresh automático).
 * Os tokens são armazenados na tabela `integracoes` do Supabase.
 */
import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';

type IntegracaoRow = Database['public']['Tables']['integracoes']['Row'];
type IntegracaoTipo = IntegracaoRow['tipo'];

async function getIntegracao(tipo: IntegracaoTipo): Promise<IntegracaoRow | null> {
  const client = createServiceClient();
  const { data } = await client.from('integracoes').select('*').eq('tipo', tipo).single();
  return data;
}

async function updateTokens(tipo: IntegracaoTipo, accessToken: string, refreshToken: string, expiresIn: number) {
  const client = createServiceClient();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await client
    .from('integracoes')
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: expiresAt,
      conectado: true,
    })
    .eq('tipo', tipo);
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - Date.now() < 300000;
}

async function refreshMLTokenFromDB(integracao: IntegracaoRow): Promise<string | null> {
  if (!integracao.refresh_token) return null;

  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integracao.client_id || '',
        client_secret: integracao.client_secret || '',
        refresh_token: integracao.refresh_token,
      }),
    });

    if (!res.ok) {
      await createServiceClient().from('integracoes').update({ conectado: false }).eq('tipo', 'mercadolivre');
      return null;
    }

    const data = await res.json();
    await updateTokens('mercadolivre', data.access_token, data.refresh_token, data.expires_in || 10800);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function getValidMLToken(): Promise<string | null> {
  const integracao = await getIntegracao('mercadolivre');
  if (!integracao?.refresh_token) return null;

  if (integracao.access_token && !isExpired(integracao.token_expires_at)) {
    return integracao.access_token;
  }

  return refreshMLTokenFromDB(integracao);
}

export async function fetchML<T>(path: string, options?: RequestInit): Promise<T | null> {
  let token = await getValidMLToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const doFetch = async (tok: string) => {
    const res = await fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...options?.headers, Authorization: `Bearer ${tok}` },
    });
    return res;
  };

  try {
    let res = await doFetch(token);

    if (res.status === 401) {
      // Force refresh by clearing cached token via getValidMLToken on retry
      // The refresh is handled by the next call to getValidMLToken below
      const freshToken = await getValidMLToken();
      if (!freshToken) return null;
      token = freshToken;
      res = await doFetch(token);
    }

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

