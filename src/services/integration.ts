import { createServiceClient } from '@/lib/supabase';

type IntegracaoTipo = 'mercadolivre' | 'bling' | 'dslite';

interface Integracao {
  id: string;
  tipo: IntegracaoTipo;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  url: string | null;
  conectado: boolean;
}

async function getIntegracao(tipo: IntegracaoTipo): Promise<Integracao | null> {
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

export async function getValidMLToken(): Promise<string | null> {
  const integracao = await getIntegracao('mercadolivre');
  if (!integracao?.refresh_token) return null;

  if (integracao.access_token && !isExpired(integracao.token_expires_at)) {
    return integracao.access_token;
  }

  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integracao.client_id!,
        client_secret: integracao.client_secret!,
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

export async function getValidBlingToken(): Promise<string | null> {
  const integracao = await getIntegracao('bling');
  if (!integracao?.refresh_token) return null;

  if (integracao.access_token && !isExpired(integracao.token_expires_at)) {
    return integracao.access_token;
  }

  const basicAuth = Buffer.from(`${integracao.client_id}:${integracao.client_secret}`).toString('base64');

  try {
    const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: integracao.refresh_token,
      }),
    });

    if (!res.ok) {
      await createServiceClient().from('integracoes').update({ conectado: false }).eq('tipo', 'bling');
      return null;
    }

    const data = await res.json();
    await updateTokens('bling', data.access_token, data.refresh_token, data.expires_in || 21600);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function fetchML<T>(path: string, options?: RequestInit): Promise<T | null> {
  const token = await getValidMLToken();
  if (!token) return null;

  const res = await fetch(`https://api.mercadolibre.com${path}`, {
    ...options,
    headers: { ...options?.headers, Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  return res.json();
}

export async function fetchBling<T>(path: string, options?: RequestInit): Promise<T | null> {
  const token = await getValidBlingToken();
  if (!token) return null;

  const res = await fetch(`https://api.bling.com.br/Api/v3${path}`, {
    ...options,
    headers: { ...options?.headers, Authorization: `Bearer ${token}`, Accept: '1.0' },
  });

  if (!res.ok) return null;
  return res.json();
}
