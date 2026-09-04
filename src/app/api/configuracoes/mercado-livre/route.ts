import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import {
  configurationValidationMessage,
  mercadoLivreConfigurationPatchSchema,
} from '@/lib/configuracoes/contracts';
import { getMercadoLivreRedirectUri } from '@/lib/ml-oauth-config';
import { getMLAuthDiagnostics, fetchMLResult } from '@/services/integration';
import {
  loadMercadoLivreConfiguration,
  toMercadoLivreWarrantyDto,
} from '@/services/mercado-livre-configuration';
import { CONFIGURATION_ROW_ID } from '@/services/operation-configuration';
import { recordConfigurationAudit } from '@/services/configuration-audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ML_FIELDS = 'client_id,client_secret,access_token,refresh_token,conectado,last_refresh_at,last_refresh_error,last_refresh_error_code,token_expires_at,updated_at' as const;

function isConfigured(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, 'Cache-Control': 'no-store' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const serviceClient = createServiceClient();
  const [{ data: integration, error }, warranty, diagnostics] = await Promise.all([
    serviceClient.from('integracoes').select(ML_FIELDS).eq('tipo', 'mercadolivre').single(),
    loadMercadoLivreConfiguration(serviceClient),
    getMLAuthDiagnostics(),
  ]);
  if (error || !integration) return noStoreJson({ erro: error?.message || 'Integração Mercado Livre ausente' }, { status: 500 });

  let seller: { id: string; nickname: string | null; siteId: string | null } | null = null;
  let application: { active: boolean | null; certificationStatus: string | null; scopes: string[]; mixedMercadoPagoScopes: boolean; diagnosticsError: string | null } = {
    active: null,
    certificationStatus: null,
    scopes: [],
    mixedMercadoPagoScopes: false,
    diagnosticsError: null,
  };
  if (diagnostics.conectado && diagnostics.has_access_token) {
    const me = await fetchMLResult<{ id?: number; nickname?: string; site_id?: string }>('/users/me?attributes=id,nickname,site_id');
    if (me.ok && me.data?.id) {
      seller = { id: String(me.data.id), nickname: me.data.nickname || null, siteId: me.data.site_id || null };
      const [appResult, grantsResult] = await Promise.all([
        integration.client_id
          ? fetchMLResult<Record<string, unknown>>(`/applications/${encodeURIComponent(integration.client_id)}`)
          : Promise.resolve(null),
        fetchMLResult<Array<{ app_id?: number; scopes?: string[] }>>(`/users/${me.data.id}/applications`),
      ]);
      const grant = grantsResult.ok && Array.isArray(grantsResult.data)
        ? grantsResult.data?.find((item) => String(item.app_id || '') === String(integration.client_id || ''))
        : null;
      const scopes = Array.isArray(grant?.scopes) ? grant.scopes.map(String) : [];
      const appData = appResult?.ok ? appResult.data : null;
      const status = appData && typeof appData.status === 'string' ? appData.status : null;
      application = {
        active: status ? status === 'active' : null,
        certificationStatus: appData && typeof appData.certification_status === 'string' ? appData.certification_status : null,
        scopes,
        mixedMercadoPagoScopes: scopes.some((scope) => /payment|mercadopago/i.test(scope)),
        diagnosticsError: appResult && !appResult.ok
          ? appResult.error?.message || 'Não foi possível consultar o aplicativo'
          : !grantsResult.ok
            ? grantsResult.error?.message || 'Não foi possível consultar os escopos'
            : null,
      };
    } else {
      application.diagnosticsError = me.error?.message || 'Não foi possível consultar a conta conectada';
    }
  }

  let redirectUri: string | null = null;
  try { redirectUri = getMercadoLivreRedirectUri(); } catch { redirectUri = null; }
  return noStoreJson({
    application: {
      clientId: integration.client_id || '',
      clientSecretConfigured: isConfigured(integration.client_secret),
      accessTokenConfigured: isConfigured(integration.access_token),
      refreshTokenConfigured: isConfigured(integration.refresh_token),
      redirectUri,
      connected: diagnostics.conectado,
      authState: diagnostics.state,
      needsReconnect: diagnostics.state === 'reauth_required',
      tokenExpiresAt: diagnostics.token_expires_at,
      lastRefreshAt: diagnostics.last_refresh_at,
      lastError: diagnostics.last_refresh_error,
    },
    seller,
    app: application,
    warranty: toMercadoLivreWarrantyDto(warranty),
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const parsed = mercadoLivreConfigurationPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return noStoreJson({ erro: configurationValidationMessage(parsed.error, 'Configuração Mercado Livre inválida') }, { status: 422 });
  const serviceClient = createServiceClient();

  if (parsed.data.section === 'application') {
    const { data: previous, error: previousError } = await serviceClient.from('integracoes').select(ML_FIELDS).eq('tipo', 'mercadolivre').single();
    if (previousError || !previous) return noStoreJson({ erro: previousError?.message || 'Integração ausente' }, { status: 500 });
    if (previous.conectado || isConfigured(previous.access_token) || isConfigured(previous.refresh_token)) {
      return noStoreJson({ erro: 'Desconecte explicitamente o Mercado Livre antes de alterar as credenciais do aplicativo.' }, { status: 409 });
    }
    const updates = {
      client_id: parsed.data.clientId,
      ...(parsed.data.clientSecret ? { client_secret: parsed.data.clientSecret } : {}),
      updated_at: new Date().toISOString(),
    };
    const { error } = await serviceClient.from('integracoes').update(updates).eq('tipo', 'mercadolivre');
    if (error) return noStoreJson({ erro: error.message }, { status: 500 });
    await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [
      { key: 'integracoes.mercadolivre.client_id', targetId: 'mercadolivre', before: previous.client_id, after: updates.client_id },
      ...(parsed.data.clientSecret ? [{ key: 'integracoes.mercadolivre.client_secret' as const, targetId: 'mercadolivre', before: previous.client_secret, after: parsed.data.clientSecret, force: true }] : []),
    ]);
    return noStoreJson({ ok: true });
  }

  const previous = await loadMercadoLivreConfiguration(serviceClient);
  const next = { typeId: parsed.data.warrantyTypeId, duration: parsed.data.warrantyDuration, unit: parsed.data.warrantyUnit };
  const { error } = await serviceClient.from('configuracoes').update({
    ml_default_warranty_type_id: next.typeId,
    ml_default_warranty_duration: next.duration,
    ml_default_warranty_unit: next.unit,
    updated_at: new Date().toISOString(),
  }).eq('id', CONFIGURATION_ROW_ID);
  if (error) return noStoreJson({ erro: error.message }, { status: 500 });
  await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [
    { key: 'configuracoes.ml_default_warranty', before: previous, after: next },
  ]);
  return noStoreJson({ ok: true, warranty: toMercadoLivreWarrantyDto(next) });
}

export async function DELETE() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const serviceClient = createServiceClient();
  const { data: previous, error: previousError } = await serviceClient.from('integracoes').select(ML_FIELDS).eq('tipo', 'mercadolivre').single();
  if (previousError || !previous) return noStoreJson({ erro: previousError?.message || 'Integração ausente' }, { status: 500 });

  if (previous.conectado && isConfigured(previous.access_token)) {
    const me = await fetchMLResult<{ id?: number }>('/users/me?attributes=id');
    if (me.ok && me.data?.id && previous.client_id) {
      const revoked = await fetchMLResult<null>(`/users/${me.data.id}/applications/${encodeURIComponent(previous.client_id)}`, { method: 'DELETE' });
      const definitive = revoked.ok || revoked.status === 404 || revoked.error?.category === 'auth_fatal';
      if (!definitive) {
        return noStoreJson({ erro: 'O Mercado Livre não confirmou a revogação. As credenciais locais foram preservadas para evitar uma desconexão parcial.' }, { status: 502 });
      }
    } else if (!me.ok && me.error?.category !== 'auth_fatal') {
      return noStoreJson({ erro: 'Não foi possível validar a conta no Mercado Livre. As credenciais locais foram preservadas.' }, { status: 502 });
    }
  }

  const { error } = await serviceClient.from('integracoes').update({
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    conectado: false,
    last_refresh_error: null,
    last_refresh_error_code: null,
    updated_at: new Date().toISOString(),
  }).eq('tipo', 'mercadolivre');
  if (error) return noStoreJson({ erro: error.message }, { status: 500 });
  await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [
    { key: 'integracoes.mercadolivre.oauth_tokens', targetId: 'mercadolivre', before: previous.access_token || previous.refresh_token, after: null, force: true },
    { key: 'integracoes.mercadolivre.conectado', targetId: 'mercadolivre', before: previous.conectado, after: false, action: 'disabled', force: true },
  ]);
  return noStoreJson({ ok: true });
}
