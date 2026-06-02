import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { FiscalProvider } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

export const DANFE_BUCKET = 'danfes';
export const DANFE_SIGNED_URL_TTL_SECONDS = 60 * 10;

type ServiceClient = SupabaseClient<Database>;

type PedidoDanfeRef = {
  id?: string | null;
  numero: number | string;
  nota_fiscal_numero: string | number | null;
  nfe_external_id?: string | null;
  nfe_chave?: string | null;
  nota_fiscal_emitida?: boolean | null;
};

type EnsureDanfeStoredInput = {
  client: ServiceClient;
  provider: FiscalProvider;
  pedido: PedidoDanfeRef;
  pedidoId?: string | null;
  mlOrderId?: string | null;
  source: string;
};

type EnsureDanfeStoredResult = {
  ok: boolean;
  usedLegacyFallback: boolean;
  canonicalPath: string | null;
  signedUrl: string | null;
  error?: string;
};

function normalizeDanfeSegment(value: string | number | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

export function buildCanonicalDanfePath(
  pedidoNumero: string | number | null | undefined,
  notaFiscalNumero: string | number | null | undefined,
): string | null {
  const pedido = normalizeDanfeSegment(pedidoNumero);
  const nota = normalizeDanfeSegment(notaFiscalNumero);
  if (!pedido || !nota) return null;
  return `${pedido}/${nota}.pdf`;
}

export function buildLegacyDanfePath(externalId: string | number | null | undefined): string | null {
  const normalized = normalizeDanfeSegment(externalId);
  if (!normalized) return null;
  return `brasilnfe/${normalized}.pdf`;
}

async function fileExists(client: ServiceClient, filePath: string): Promise<boolean> {
  const { data, error } = await client.storage
    .from(DANFE_BUCKET)
    .createSignedUrl(filePath, 60);
  return !error && Boolean(data?.signedUrl);
}

export async function createDanfeSignedUrl(
  client: ServiceClient,
  filePath: string,
  ttlSeconds = DANFE_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(DANFE_BUCKET)
    .createSignedUrl(filePath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function resolveDanfeStoragePath(
  client: ServiceClient,
  pedido: PedidoDanfeRef,
): Promise<{
  path: string | null;
  usedLegacyFallback: boolean;
  canonicalPath: string | null;
  legacyPath: string | null;
}> {
  const canonicalPath = buildCanonicalDanfePath(pedido.numero, pedido.nota_fiscal_numero);
  if (canonicalPath && await fileExists(client, canonicalPath)) {
    return { path: canonicalPath, usedLegacyFallback: false, canonicalPath, legacyPath: null };
  }

  const legacyPath = buildLegacyDanfePath(pedido.nfe_external_id);
  if (legacyPath && await fileExists(client, legacyPath)) {
    return { path: legacyPath, usedLegacyFallback: true, canonicalPath, legacyPath };
  }

  return { path: null, usedLegacyFallback: false, canonicalPath, legacyPath };
}

export async function ensureDanfeStoredForPedido(input: EnsureDanfeStoredInput): Promise<EnsureDanfeStoredResult> {
  const canonicalPath = buildCanonicalDanfePath(input.pedido.numero, input.pedido.nota_fiscal_numero);
  if (!canonicalPath) {
    return {
      ok: false,
      canonicalPath: null,
      signedUrl: null,
      usedLegacyFallback: false,
      error: 'Pedido sem número/caminho canônico da DANFE',
    };
  }

  const alreadyExists = await fileExists(input.client, canonicalPath);
  if (alreadyExists) {
    const signedUrl = await createDanfeSignedUrl(input.client, canonicalPath);
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId || input.pedido.id || null,
      mlOrderId: input.mlOrderId || null,
      evento: 'nfe_danfe_persistencia',
      payloadEnviado: {
        source: input.source,
        storage_path: canonicalPath,
        used_legacy_fallback: false,
        action: 'reuse_existing',
        download_mode: 'storage_existing',
        nfe_chave: input.pedido.nfe_chave || null,
      },
      respostaMl: {
        success: true,
        signed_url_generated: Boolean(signedUrl),
      },
      statusResultante: 'success',
    });
    return {
      ok: true,
      canonicalPath,
      signedUrl,
      usedLegacyFallback: false,
    };
  }

  const chaveNf = normalizeDanfeSegment(input.pedido.nfe_chave);
  const externalId = normalizeDanfeSegment(input.pedido.nfe_external_id);
  if (!externalId && !chaveNf) {
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId || input.pedido.id || null,
      mlOrderId: input.mlOrderId || null,
      evento: 'nfe_danfe_persistencia',
      payloadEnviado: {
        source: input.source,
        storage_path: canonicalPath,
        download_mode: chaveNf ? 'chave_nf' : 'legacy_external_id',
        nfe_chave: chaveNf,
      },
      respostaMl: {
        provider_fetch_success: false,
        provider_fetch_failed_reason: 'provider_pdf_not_found',
        detail: 'nfe_external_id e nfe_chave ausentes',
      },
      statusResultante: 'failed',
    });
    return {
      ok: false,
      canonicalPath,
      signedUrl: null,
      usedLegacyFallback: false,
      error: 'nfe_external_id e nfe_chave ausentes para recuperar DANFE',
    };
  }

  const downloadMode = chaveNf ? 'chave_nf' : 'legacy_external_id';
  const providerDanfe = await input.provider.obterDanfe(externalId || chaveNf || '', {
    storagePath: canonicalPath,
    chaveNf,
  });
  if (!providerDanfe.url) {
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId || input.pedido.id || null,
      mlOrderId: input.mlOrderId || null,
      evento: 'nfe_danfe_persistencia',
      payloadEnviado: {
        source: input.source,
        storage_path: canonicalPath,
        download_mode: downloadMode,
        nfe_chave: chaveNf,
      },
      respostaMl: {
        provider_fetch_success: false,
        provider_fetch_failed_reason: providerDanfe.error || 'provider_pdf_not_found',
      },
      statusResultante: 'failed',
    });
    return {
      ok: false,
      canonicalPath,
      signedUrl: null,
      usedLegacyFallback: false,
      error: providerDanfe.error || 'Falha ao obter DANFE no provider',
    };
  }

  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId || input.pedido.id || null,
    mlOrderId: input.mlOrderId || null,
    evento: 'nfe_danfe_persistencia',
    payloadEnviado: {
      source: input.source,
      storage_path: canonicalPath,
      used_legacy_fallback: false,
      action: 'download_and_store',
      download_mode: downloadMode,
      nfe_chave: chaveNf,
    },
    respostaMl: {
      provider_fetch_success: true,
      signed_url_generated: true,
      provider_storage_path: providerDanfe.path || canonicalPath,
    },
    statusResultante: 'success',
  });
  return {
    ok: true,
    canonicalPath,
    signedUrl: providerDanfe.url,
    usedLegacyFallback: false,
  };
}
