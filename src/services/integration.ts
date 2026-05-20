/**
 * Gerenciamento de tokens OAuth para integrações com APIs externas.
 * Atualmente suporta Mercado Livre (OAuth2 com refresh automático).
 * Os tokens são armazenados na tabela `integracoes` do Supabase.
 */
import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';

type IntegracaoRow = Database['public']['Tables']['integracoes']['Row'];
type IntegracaoTipo = IntegracaoRow['tipo'];

export type MLFailureCategory = 'expected_operational' | 'retryable' | 'auth_fatal' | 'error';

export interface MLRequestError {
  status: number;
  code: string | null;
  message: string;
  category: MLFailureCategory;
  traceId: string | null;
}

export interface MLRequestResult<T> {
  ok: boolean;
  status: number | null;
  data: T | null;
  error: MLRequestError | null;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REFRESH_WAIT_MS = 700;
const REFRESH_WAIT_ATTEMPTS = 8;
let inflightForcedRefresh: Promise<string | null> | null = null;

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - Date.now() < 300000;
}

function classifyMLFailure(path: string, status: number, body: string): MLFailureCategory {
  const lowerBody = body.toLowerCase();
  if (status === 401) return 'auth_fatal';
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(status)) return 'retryable';

  const expectedInvoice404 = path.includes('/invoices/orders/') && status === 404;
  const expectedShipment404 = /\/orders\/.+\/shipments/.test(path) && status === 404;
  const expectedCarrier404 =
    /\/shipments\/.+\/carrier/.test(path) &&
    status === 404 &&
    lowerBody.includes('tracking url');
  const expectedShipping404 =
    path.includes('/shipping_options') &&
    status === 404 &&
    (lowerBody.includes('stock out') || lowerBody.includes('no coverage'));

  if (expectedInvoice404 || expectedShipment404 || expectedCarrier404 || expectedShipping404) {
    return 'expected_operational';
  }

  return 'error';
}

function tryParseJson(body: string): any | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function extractErrorCode(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed.code || parsed.error || parsed.error_code || null;
}

function extractTraceId(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const cause = parsed.cause;
  if (Array.isArray(cause)) {
    for (const c of cause) {
      if (!c || typeof c !== 'object') continue;
      if (typeof c['trace-id'] === 'string') return c['trace-id'];
      if (typeof c.trace_id === 'string') return c.trace_id;
    }
  }
  return null;
}

function logMLFailure(method: string, path: string, status: number, body: string, error: MLRequestError) {
  const base = `[ML API] ${method} ${path} → ${status}`;
  const snippet = body.substring(0, 500);
  const trace = error.traceId ? ` trace-id=${error.traceId}` : '';

  if (error.category === 'expected_operational' || error.category === 'retryable') {
    console.warn(`${base} (${error.category})${trace}: ${snippet}`);
    return;
  }

  console.error(`${base} (${error.category})${trace}: ${snippet}`);
}

async function getIntegracao(tipo: IntegracaoTipo): Promise<IntegracaoRow | null> {
  const client = createServiceClient();
  const { data } = await client
    .from('integracoes')
    .select('*')
    .eq('tipo', tipo)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function updateIntegracao(tipo: IntegracaoTipo, values: Database['public']['Tables']['integracoes']['Update']) {
  const client = createServiceClient();
  await client.from('integracoes').update(values).eq('tipo', tipo);
}

async function updateTokens(tipo: IntegracaoTipo, accessToken: string, refreshToken: string, expiresIn: number) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await updateIntegracao(tipo, {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: expiresAt,
    conectado: true,
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: null,
    last_refresh_error_code: null,
  });
}

async function acquireRefreshLock(tipo: IntegracaoTipo, owner: string): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await (client as any).rpc('acquire_integracao_refresh_lock', {
    p_tipo: tipo,
    p_owner: owner,
    p_ttl_seconds: 25,
  });
  if (error) {
    // Backward compatibility while migration is not applied yet.
    console.warn('[ML OAuth] Lock de refresh indisponível, seguindo sem lock distribuído:', error.message);
    return true;
  }
  return Boolean(data);
}

async function releaseRefreshLock(tipo: IntegracaoTipo, owner: string) {
  const client = createServiceClient();
  const { error } = await (client as any).rpc('release_integracao_refresh_lock', {
    p_tipo: tipo,
    p_owner: owner,
  });
  if (error) {
    console.warn('[ML OAuth] Falha ao liberar lock de refresh:', error.message);
  }
}

async function markRefreshFailure(
  fatalAuth: boolean,
  errorCode: string | null,
  errorMessage: string | null,
) {
  await updateIntegracao('mercadolivre', {
    conectado: fatalAuth ? false : true,
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: errorMessage,
    last_refresh_error_code: errorCode,
  });
}

function isFatalAuthRefreshError(errorCode: string | null): boolean {
  return ['invalid_grant', 'invalid_client', 'unauthorized_client', 'unauthorized_application'].includes(errorCode || '');
}

async function waitTokenFromOtherRefresher(): Promise<string | null> {
  for (let i = 0; i < REFRESH_WAIT_ATTEMPTS; i++) {
    await delay(REFRESH_WAIT_MS);
    const current = await getIntegracao('mercadolivre');
    if (current?.access_token && !isExpired(current.token_expires_at)) {
      return current.access_token;
    }
  }
  return null;
}

async function refreshMLTokenFromDB(force: boolean): Promise<string | null> {
  const initial = await getIntegracao('mercadolivre');
  if (!initial?.refresh_token) return null;

  if (!force && initial.access_token && !isExpired(initial.token_expires_at)) {
    return initial.access_token;
  }

  const owner = randomUUID();
  const lockAcquired = await acquireRefreshLock('mercadolivre', owner);

  if (!lockAcquired) {
    return waitTokenFromOtherRefresher();
  }

  try {
    const latest = await getIntegracao('mercadolivre');
    if (!latest?.refresh_token) return null;

    if (!force && latest.access_token && !isExpired(latest.token_expires_at)) {
      return latest.access_token;
    }

    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: latest.client_id || '',
        client_secret: latest.client_secret || '',
        refresh_token: latest.refresh_token,
      }),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const code = payload?.error || payload?.code || null;
      const message = payload?.error_description || payload?.message || `OAuth refresh HTTP ${res.status}`;
      const fatalAuth = isFatalAuthRefreshError(code);
      await markRefreshFailure(fatalAuth, code, message);
      console.error(`[ML OAuth] Falha no refresh (${code || 'sem_codigo'}): ${message}`);
      return null;
    }

    const accessToken = payload?.access_token;
    const refreshToken = payload?.refresh_token;
    if (!accessToken || !refreshToken) {
      await markRefreshFailure(false, 'invalid_refresh_payload', 'Resposta de refresh sem access_token/refresh_token');
      return null;
    }

    await updateTokens('mercadolivre', accessToken, refreshToken, payload?.expires_in || 10800);
    return accessToken;
  } catch (err: any) {
    await markRefreshFailure(false, 'refresh_exception', err?.message || 'Erro de rede ao atualizar token');
    console.error('[ML OAuth] Exceção no refresh:', err?.message || err);
    return null;
  } finally {
    await releaseRefreshLock('mercadolivre', owner);
  }
}

export async function getValidMLToken(force = false): Promise<string | null> {
  const integracao = await getIntegracao('mercadolivre');
  if (!integracao?.refresh_token) return null;

  if (!force && integracao.access_token && !isExpired(integracao.token_expires_at)) {
    return integracao.access_token;
  }

  if (!force) {
    return refreshMLTokenFromDB(false);
  }

  if (!inflightForcedRefresh) {
    inflightForcedRefresh = refreshMLTokenFromDB(true).finally(() => {
      inflightForcedRefresh = null;
    });
  }
  return inflightForcedRefresh;
}

export async function fetchMLResult<T>(path: string, options?: RequestInit): Promise<MLRequestResult<T>> {
  let token = await getValidMLToken();
  if (!token) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: {
        status: 401,
        code: 'missing_token',
        message: 'Token do Mercado Livre indisponível',
        category: 'auth_fatal',
        traceId: null,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const method = options?.method || 'GET';

  const doFetch = async (tok: string) => {
    return fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...options?.headers, Authorization: `Bearer ${tok}` },
    });
  };

  try {
    let res = await doFetch(token);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      await delay(Math.min(Math.max(retryAfter, 1), 5) * 1000);
      res = await doFetch(token);
    }

    if (res.status === 401) {
      const freshToken = await getValidMLToken(true);
      if (!freshToken) {
        return {
          ok: false,
          status: 401,
          data: null,
          error: {
            status: 401,
            code: 'refresh_failed',
            message: 'Falha ao renovar token do Mercado Livre',
            category: 'auth_fatal',
            traceId: null,
          },
        };
      }
      token = freshToken;
      res = await doFetch(token);
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: true, status: res.status, data, error: null };
    }

    const body = await res.text().catch(() => '');
    const parsed = tryParseJson(body);
    const code = extractErrorCode(parsed);
    const traceId = extractTraceId(parsed);
    const category = classifyMLFailure(path, res.status, body);
    const message =
      parsed?.message ||
      parsed?.error_description ||
      parsed?.detail ||
      `Mercado Livre retornou HTTP ${res.status}`;

    const error: MLRequestError = {
      status: res.status,
      code,
      message,
      category,
      traceId,
    };

    logMLFailure(method, path, res.status, body, error);

    return {
      ok: false,
      status: res.status,
      data: null,
      error,
    };
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'network_error');
    const error: MLRequestError = {
      status: 0,
      code: 'network_error',
      message,
      category: 'retryable',
      traceId: null,
    };
    console.warn(`[ML API] ${method} ${path} → exception (${error.category}): ${message}`);
    return { ok: false, status: null, data: null, error };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchML<T>(path: string, options?: RequestInit): Promise<T | null> {
  const result = await fetchMLResult<T>(path, options);
  return result.ok ? result.data : null;
}

export async function fetchMLRaw(path: string, options?: RequestInit): Promise<{ status: number; body: string } | null> {
  let token = await getValidMLToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const doFetch = async (tok: string) => {
    return fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...options?.headers, Authorization: `Bearer ${tok}` },
    });
  };

  try {
    let res = await doFetch(token);

    if (res.status === 401) {
      const freshToken = await getValidMLToken(true);
      if (!freshToken) return null;
      token = freshToken;
      res = await doFetch(token);
    }

    const body = await res.text();
    if (!res.ok) {
      const parsed = tryParseJson(body);
      const error: MLRequestError = {
        status: res.status,
        code: extractErrorCode(parsed),
        message: parsed?.message || parsed?.error_description || `HTTP ${res.status}`,
        category: classifyMLFailure(path, res.status, body),
        traceId: extractTraceId(parsed),
      };
      logMLFailure(options?.method || 'GET', path, res.status, body, error);
    }
    return { status: res.status, body };
  } catch (err: any) {
    console.warn(`[ML API] ${options?.method || 'GET'} ${path} → exception (retryable): ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMLConnectionStatus(): Promise<{ conectado: boolean; precisaReconectar: boolean; erro?: string }> {
  const me = await fetchMLResult<{ id?: number }>('/users/me');
  if (me.ok && me.data?.id) {
    return { conectado: true, precisaReconectar: false };
  }

  if (me.error?.category === 'auth_fatal') {
    return { conectado: false, precisaReconectar: true, erro: me.error.message };
  }

  return { conectado: true, precisaReconectar: false, erro: me.error?.message || 'Falha transitória ao validar conexão ML' };
}

export async function buscarXmlDaNF(orderId: string): Promise<{ xml: string | null; error?: string }> {
  try {
    const me = await fetchML<any>('/users/me');
    if (!me?.id) {
      return { xml: null, error: 'Não foi possível obter seller ID do ML' };
    }

    const sellerId = me.id;
    console.log(`[buscarXmlDaNF] Buscando invoice pelo order_id=${orderId}`);

    const invoiceResult = await fetchML<any>(`/users/${sellerId}/invoices/orders/${orderId}`);
    if (!invoiceResult) {
      return { xml: null, error: 'NF não encontrada para este pedido no ML' };
    }

    const invoiceId = invoiceResult.id;
    if (!invoiceId) {
      return { xml: null, error: 'Invoice ID não retornado pelo ML' };
    }

    console.log(`[buscarXmlDaNF] Invoice encontrada: id=${invoiceId}, status=${invoiceResult.status}`);

    if (invoiceResult.status !== 'authorized') {
      return { xml: null, error: `NF ainda não autorizada (status: ${invoiceResult.status})` };
    }

    console.log(`[buscarXmlDaNF] Baixando XML pelo invoice_id=${invoiceId}`);

    const xmlResult = await fetchMLRaw(`/users/${sellerId}/invoices/documents/xml/${invoiceId}/authorized`);
    if (!xmlResult) {
      return { xml: null, error: 'Falha ao baixar XML do ML' };
    }

    if (xmlResult.status !== 200) {
      return { xml: null, error: `ML retornou HTTP ${xmlResult.status}: ${xmlResult.body.substring(0, 200)}` };
    }

    if (xmlResult.body && xmlResult.body.length > 50) {
      console.log(`[buscarXmlDaNF] XML baixado com sucesso, tamanho: ${xmlResult.body.length} chars`);
      return { xml: xmlResult.body };
    }

    return { xml: null, error: 'XML vazio ou inválido retornado pelo ML' };
  } catch (err: any) {
    return { xml: null, error: `Exceção: ${err?.message || err}` };
  }
}

export async function baixarEtiquetaML(shipmentId: string): Promise<{ pdf: Buffer | null; error?: string }> {
  try {
    const token = await getValidMLToken();
    if (!token) {
      return { pdf: null, error: 'Token do ML não disponível' };
    }

    console.log(`[baixarEtiquetaML] Baixando etiqueta para shipment ${shipmentId}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[baixarEtiquetaML] ML retornou HTTP ${res.status}: ${text.substring(0, 300)}`);
        return { pdf: null, error: `ML retornou HTTP ${res.status}` };
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
        console.error(`[baixarEtiquetaML] Resposta não é um PDF válido (tamanho: ${buffer.length})`);
        return { pdf: null, error: 'Resposta do ML não é um PDF válido' };
      }

      console.log(`[baixarEtiquetaML] Etiqueta baixada com sucesso: ${buffer.length} bytes`);
      return { pdf: buffer };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    console.error('[baixarEtiquetaML] Erro:', err);
    return { pdf: null, error: err?.message || 'Erro ao baixar etiqueta' };
  }
}
