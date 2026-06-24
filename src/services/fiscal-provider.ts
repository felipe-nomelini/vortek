import { BrasilNFe } from 'brasilnfe';
import { createServiceClient } from '@/lib/supabase';
import { extractCfopsFromXml } from '@/lib/fiscal/cfop';

export type NfeProvider = 'brasilnfe';

export interface FiscalEmitContext {
  pedidoId: string;
  mlOrderId?: string | null;
  nfePayload?: Record<string, any> | null;
}

export interface EmitResult {
  ok: boolean;
  status?: string;
  externalId?: string;
  chave?: string | null;
  numero?: string | null;
  protocolo?: string | null;
  xml?: string | null;
  danfeUrl?: string | null;
  cfop?: string | null;
  error?: string;
  errorDetails?: Record<string, any> | null;
  temporary?: boolean;
}

export interface ConsultResult {
  ok: boolean;
  status?: string;
  externalId?: string;
  error?: string;
  temporary?: boolean;
}

export interface XmlResult {
  xml: string | null;
  error?: string;
  temporary?: boolean;
}

export interface BrasilNfeChaveCheckResult {
  exists: boolean;
  environment: 1 | 2;
  raw: {
    quantidade: number;
    error: string | null;
    avisos: string[];
  };
}

export interface BrasilNfeNotaByIdentifier {
  chave: string;
  identificadorInterno: string | null;
  numero: number | null;
  status: number | null;
  dtEmissao: string | null;
  numeroProtocolo: string | null;
}

export interface BrasilNfeDuplicateParseResult {
  isDuplicateIdentifier: boolean;
  identificadorInterno: string | null;
  message: string | null;
}

export interface FiscalProvider {
  type: NfeProvider;
  emitirNota(ctx: FiscalEmitContext): Promise<EmitResult>;
  consultarNota(externalIdOrOrderId: string): Promise<ConsultResult>;
  obterXml(
    externalIdOrOrderId: string,
    options?: { chaveNf?: string | null },
  ): Promise<XmlResult>;
  obterDanfe(
    _externalIdOrOrderId: string,
    options?: { storagePath?: string | null; signedUrlTtlSeconds?: number; chaveNf?: string | null },
  ): Promise<{ url: string | null; path?: string | null; error?: string }>;
}

async function getBrasilNfeClient() {
  const client = createServiceClient();
  const { data } = await client
    .from('integracoes')
    .select('access_token, refresh_token, url, conectado')
    .eq('tipo', 'brasilnfe')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const token = data?.access_token || process.env.BRASILNFE_TOKEN || '';
  const userToken = data?.refresh_token || process.env.BRASILNFE_USER_TOKEN || undefined;
  const baseUrl = data?.url || process.env.BRASILNFE_BASE_URL || 'https://api.brasilnfe.com.br/services/';

  if (!token) {
    throw new Error('Token da integração Brasil NFe não configurado');
  }

  return new BrasilNFe(token, userToken, baseUrl);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCauseCode(err: any): string {
  return String(
    err?.cause?.code
    || err?.code
    || err?.errno
    || err?.error?.cause?.code
    || err?.response?.cause?.code
    || '',
  ).trim();
}

function isBrasilNfeTemporaryDnsError(err: any): boolean {
  const code = getErrorCauseCode(err);
  const message = String(err?.message || err?.error?.message || '').toLowerCase();
  return code === 'EAI_AGAIN' || message.includes('getaddrinfo eai_again');
}

async function withBrasilNfeDnsRetry<T>(
  operation: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Number(options?.attempts || 3));
  const delayMs = Math.max(100, Number(options?.delayMs || 750));
  let lastError: any = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      if (!isBrasilNfeTemporaryDnsError(err) || attempt >= attempts) throw err;
      console.warn(JSON.stringify({
        event: 'brasilnfe_dns_retry',
        attempt,
        attempts,
        error_code: getErrorCauseCode(err) || null,
        message: err?.message || null,
      }));
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

export async function checkBrasilNfeChaveExists(chave: string, tpAmb: 1 | 2): Promise<BrasilNfeChaveCheckResult> {
  const bnfe = await getBrasilNfeClient();
  const resp: any = await withBrasilNfeDnsRetry(() => bnfe.arquivos.obterArquivosPorRange({
    Chaves: [chave],
    TipoAmbiente: tpAmb,
    TipoNota: 1,
    Type: 1,
  } as any));

  const quantidade = Number(resp?.Quantidade || 0);
  const avisos = Array.isArray(resp?.Avisos) ? resp.Avisos.map((v: any) => String(v)) : [];
  const error = resp?.Error ? String(resp.Error) : null;
  return {
    exists: quantidade > 0,
    environment: tpAmb,
    raw: {
      quantidade,
      error,
      avisos,
    },
  };
}

export function parseBrasilNfeDuplicateIdentifier(errorDetails: any): BrasilNfeDuplicateParseResult {
  const rawMessage = String(
    errorDetails?.rawResponse?.Error
    || errorDetails?.error?.response?.data?.Error
    || errorDetails?.error?.message
    || '',
  ).trim();
  const normalized = rawMessage.toLowerCase();
  const isDuplicateIdentifier =
    normalized.includes('já foi emitida uma nota fiscal com o identificador interno')
    || normalized.includes('ja foi emitida uma nota fiscal com o identificador interno');
  const identifierMatch = rawMessage.match(/identificador interno\s+([^\s(]+)/i);
  const identificadorInterno = identifierMatch?.[1] ? String(identifierMatch[1]).trim() : null;
  return {
    isDuplicateIdentifier,
    identificadorInterno,
    message: rawMessage || null,
  };
}

export async function buscarNotaBrasilNfePorIdentificadorInterno(input: {
  identificadorInterno: string;
  dtInicio?: string;
  dtFim?: string;
}): Promise<{
  ok: boolean;
  nota?: BrasilNfeNotaByIdentifier | null;
  error?: string;
  raw?: any;
}> {
  const bnfe = await getBrasilNfeClient();
  const dtFim = input.dtFim || new Date().toISOString();
  const dtInicio = input.dtInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const resp: any = await withBrasilNfeDnsRetry(() => bnfe.consultas.buscarNotaFiscal({
    TipoDocumentoFiscal: 1,
    DtInicio: dtInicio,
    DtFim: dtFim,
    IndentificadorInterno: input.identificadorInterno,
  } as any));

  const notas = Array.isArray(resp?.Notas) ? resp.Notas : [];
  if (!notas.length) {
    return {
      ok: false,
      nota: null,
      error: String(resp?.Error || 'NF não encontrada por identificador interno'),
      raw: resp,
    };
  }

  const isAuthorizedNota = (nota: any): boolean => {
    const numericCandidates = [
      nota?.Status,
      nota?.CodStatus,
      nota?.CodStatusRespostaSefaz,
      nota?.CodStatusSefaz,
    ];
    const hasAuthorizedCode = numericCandidates.some((v: any) => {
      const n = Number(v);
      return Number.isFinite(n) && [100, 150].includes(n);
    });
    if (hasAuthorizedCode) return true;

    const textCandidates = [
      nota?.DsStatus,
      nota?.DsSituacao,
      nota?.Situacao,
      nota?.StatusDescricao,
      nota?.DescricaoStatus,
      nota?.DsStatusRespostaSefaz,
    ];
    return textCandidates.some((v: any) => String(v || '').toLowerCase().includes('autoriz'));
  };

  const sorted = notas
    .filter((n: any) => String(n?.Chave || '').trim())
    .sort((a: any, b: any) => {
      const aAuthorized = isAuthorizedNota(a) ? 1 : 0;
      const bAuthorized = isAuthorizedNota(b) ? 1 : 0;
      if (aAuthorized !== bAuthorized) return bAuthorized - aAuthorized;

      const da = new Date(String(a?.DtEmissao || a?.DtRecebimento || 0)).getTime();
      const db = new Date(String(b?.DtEmissao || b?.DtRecebimento || 0)).getTime();
      return db - da;
    });
  const n = sorted[0] || notas[0];
  return {
    ok: true,
    nota: {
      chave: String(n?.Chave || '').trim(),
      identificadorInterno: String(n?.IdentificadorInterno || '').trim() || null,
      numero: Number.isFinite(Number(n?.Numero)) ? Number(n.Numero) : null,
      status: Number.isFinite(Number(n?.Status)) ? Number(n.Status) : null,
      dtEmissao: String(n?.DtEmissao || '').trim() || null,
      numeroProtocolo: String(n?.NumeroProtocolo || '').trim() || null,
    },
    raw: resp,
  };
}

export async function obterXmlBrasilNfePorChave(chave: string): Promise<{
  ok: boolean;
  xml?: string | null;
  error?: string;
}> {
  try {
    const bnfe = await getBrasilNfeClient();
    const buffer: Buffer = await withBrasilNfeDnsRetry(() => bnfe.arquivos.pegarArquivo({
      ChaveNF: chave,
      FileType: 1,
      TipoDocumentoFiscal: 1,
    } as any));
    const xml = buffer?.toString('utf-8') || null;
    if (!xml) return { ok: false, xml: null, error: 'XML não retornado por chave na Brasil NFe' };
    return { ok: true, xml };
  } catch (err: any) {
    return { ok: false, xml: null, error: err?.message || 'Erro ao obter XML por chave na Brasil NFe' };
  }
}

export async function cancelarNotaBrasilNfePorChave(input: {
  chave: string;
  protocolo?: string | null;
  justificativa?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  raw?: any;
}> {
  try {
    const bnfe = await getBrasilNfeClient();
    const resp: any = await withBrasilNfeDnsRetry(() => bnfe.eventos.cancelarNotaFiscal({
      ChaveNF: input.chave,
      NumeroProtocolo: input.protocolo || undefined,
      Justificativa: input.justificativa || 'Cancelamento para reemissão operacional',
      TipoDocumento: 0,
      NumeroSequencial: 1,
    } as any));

    const status = Number(resp?.Status || 0);
    const cod = Number(resp?.CodStatusRespostaSefaz || 0);
    const ds = String(resp?.DsMotivo || '').toLowerCase();
    const ok = status === 1 || [135, 136, 155].includes(cod) || ds.includes('evento registrado');
    if (!ok) {
      return {
        ok: false,
        error: String(resp?.Error || resp?.DsMotivo || 'Falha ao cancelar nota na Brasil NFe'),
        raw: resp,
      };
    }
    return { ok: true, raw: resp };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Erro ao cancelar nota na Brasil NFe', raw: err?.response?.data || null };
  }
}

export async function enviarCartaCorrecaoBrasilNfePorChave(input: {
  chave: string;
  correcao: string;
  numeroSequencial?: number;
  tipoAmbiente?: 1 | 2;
}): Promise<{
  ok: boolean;
  protocolo?: string | null;
  error?: string;
  raw?: any;
}> {
  try {
    const bnfe = await getBrasilNfeClient();
    const resp: any = await withBrasilNfeDnsRetry(() => bnfe.eventos.enviarCartaCorrecao({
      ChaveNF: input.chave,
      Correcao: input.correcao,
      NumeroSequencial: Number(input.numeroSequencial || 1),
      TipoAmbiente: Number(input.tipoAmbiente || 1),
    } as any));

    const status = Number(resp?.Status || 0);
    const cod = Number(resp?.CodStatusRespostaSefaz || 0);
    const ds = String(resp?.DsMotivo || '').toLowerCase();
    const ok = status === 1 || [135, 136].includes(cod) || ds.includes('evento registrado');
    if (!ok) {
      return {
        ok: false,
        error: String(resp?.Error || resp?.DsMotivo || 'Falha ao enviar carta de correção na Brasil NFe'),
        raw: resp,
      };
    }

    return {
      ok: true,
      protocolo: String(resp?.NuProtocolo || resp?.NumeroProtocolo || '').trim() || null,
      raw: resp,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Erro ao enviar carta de correção na Brasil NFe',
      raw: err?.response?.data || null,
    };
  }
}

function extractFirstCfop(xml: string | null | undefined): string | null {
  if (!xml) return null;
  return extractCfopsFromXml(xml)[0] || null;
}

class BrasilNfeFiscalProvider implements FiscalProvider {
  readonly type: NfeProvider = 'brasilnfe';

  private async getClient() {
    return getBrasilNfeClient();
  }

  async emitirNota(ctx: FiscalEmitContext): Promise<EmitResult> {
    if (!ctx.nfePayload) {
      return {
        ok: false,
        error: 'nfePayload é obrigatório para emissão com Brasil NFe',
        errorDetails: null,
      };
    }

    try {
      const bnfe = await this.getClient();
      const resp: any = await withBrasilNfeDnsRetry(() => bnfe.notaFiscal.enviarNotaFiscal(ctx.nfePayload as any));
      const ok = Boolean(resp?.ReturnNF?.Ok);
      const externalId = String(resp?.ReturnNF?.Id || resp?.ReturnNF?.Numero || resp?.codigo || '').trim() || undefined;
      const chave = resp?.ReturnNF?.ChaveNF || null;
      const numero = resp?.ReturnNF?.NumeroNF || resp?.ReturnNF?.Numero || null;
      const protocolo = resp?.ReturnNF?.Numero || null;
      const xml = resp?.Base64Xml ? Buffer.from(resp.Base64Xml, 'base64').toString('utf-8') : null;
      const danfeUrl = resp?.UrlDanfe || null;
      const errorMessage = ok
        ? undefined
        : (
          resp?.ReturnNF?.DsStatusRespostaSefaz
          || resp?.ReturnNF?.Mensagem
          || resp?.ReturnNF?.Msg
          || resp?.Mensagem
          || resp?.Message
          || resp?.erros?.[0]?.descricao
          || resp?.erros?.[0]?.mensagem
          || 'Emissão rejeitada'
        );

      return {
        ok,
        status: ok ? 'authorized' : 'rejected',
        externalId,
        chave,
        numero,
        protocolo,
        xml,
        danfeUrl,
        cfop: extractFirstCfop(xml),
        error: errorMessage,
        errorDetails: ok ? null : {
          provider: 'brasilnfe',
          rawResponse: resp,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Erro ao emitir nota no Brasil NFe',
        errorDetails: {
          provider: 'brasilnfe',
          rawResponse: err?.response?.data || null,
          error: {
            message: err?.message || null,
            name: err?.name || null,
            stack: err?.stack || null,
            response: err?.response || null,
          },
        },
        temporary: true,
      };
    }
  }

  async consultarNota(externalIdOrOrderId: string): Promise<ConsultResult> {
    try {
      const bnfe = await this.getClient();
      const resp: any = await withBrasilNfeDnsRetry(() => bnfe.consultas.buscarNotaFiscal({
        NumeroRecibo: externalIdOrOrderId,
      } as any));
      const found = resp?.ReturnNF || resp?.NotasFiscais?.[0] || null;
      if (!found) return { ok: false, error: 'NF não encontrada no Brasil NFe', temporary: true };
      return {
        ok: true,
        status: String(found?.Situacao || found?.Status || 'processing').toLowerCase(),
        externalId: String(found?.Id || found?.Numero || externalIdOrOrderId),
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Erro ao consultar nota no Brasil NFe', temporary: true };
    }
  }

  async obterXml(externalIdOrOrderId: string, options?: { chaveNf?: string | null }): Promise<XmlResult> {
    try {
      const bnfe = await this.getClient();
      const chaveNf = String(options?.chaveNf || '').trim();
      const requests = chaveNf
        ? [
          { ChaveNF: chaveNf, FileType: 1, TipoDocumentoFiscal: 1 },
          { NumeroRecibo: externalIdOrOrderId, FileType: 1 },
        ]
        : [
          { NumeroRecibo: externalIdOrOrderId, FileType: 1 },
        ];
      let buffer: Buffer | null = null;
      let lastError: any = null;
      for (const payload of requests) {
        try {
          buffer = await withBrasilNfeDnsRetry(() => bnfe.arquivos.pegarArquivo(payload as any));
          if (buffer?.length) break;
        } catch (err: any) {
          lastError = err;
        }
      }
      const xml = buffer?.toString('utf-8') || null;
      if (!xml && lastError) {
        return { xml: null, error: lastError?.message || 'Erro ao obter XML no Brasil NFe', temporary: true };
      }
      return { xml };
    } catch (err: any) {
      return { xml: null, error: err?.message || 'Erro ao obter XML no Brasil NFe', temporary: true };
    }
  }

  async obterDanfe(
    externalIdOrOrderId: string,
    options?: { storagePath?: string | null; signedUrlTtlSeconds?: number; chaveNf?: string | null },
  ): Promise<{ url: string | null; path?: string | null; error?: string }> {
    try {
      const bnfe = await this.getClient();
      const chaveNf = String(options?.chaveNf || '').trim();
      const requests = chaveNf
        ? [
          { ChaveNF: chaveNf, FileType: 2, TipoDocumentoFiscal: 1 },
          { NumeroRecibo: externalIdOrOrderId, FileType: 2 },
        ]
        : [
          { NumeroRecibo: externalIdOrOrderId, FileType: 2 },
        ];
      let buffer: Buffer | null = null;
      let lastError: any = null;
      for (const payload of requests) {
        try {
          buffer = await withBrasilNfeDnsRetry(() => bnfe.arquivos.pegarArquivo(payload as any));
          if (buffer?.length) break;
        } catch (err: any) {
          lastError = err;
        }
      }
      if (!buffer || !buffer.length) return { url: null, error: 'DANFE não retornado' };

      const serviceClient = createServiceClient();
      const fileName = `${externalIdOrOrderId}.pdf`;
      const filePath = String(options?.storagePath || `brasilnfe/${fileName}`).trim();
      const up = await serviceClient.storage
        .from('danfes')
        .upload(filePath, buffer, { contentType: 'application/pdf', upsert: true });
      if (up.error) return { url: null, error: up.error.message };

      const signed = await serviceClient.storage
        .from('danfes')
        .createSignedUrl(filePath, Number(options?.signedUrlTtlSeconds || 60 * 60));
      if (signed.error || !signed.data?.signedUrl) return { url: null, error: signed.error?.message || 'Falha ao assinar URL da DANFE' };
      return { url: signed.data.signedUrl, path: filePath };
    } catch (err: any) {
      return { url: null, error: err?.message || 'Erro ao obter DANFE no Brasil NFe' };
    }
  }
}

export function getFiscalProvider(provider: NfeProvider): FiscalProvider {
  if (provider !== 'brasilnfe') {
    throw new Error('Provedor fiscal inválido. Apenas brasilnfe é permitido.');
  }
  return new BrasilNfeFiscalProvider();
}

export async function getDefaultFiscalProvider(): Promise<NfeProvider> {
  const client = createServiceClient();
  const { data } = await client.from('configuracoes').select('nfe_provider_default').limit(1).maybeSingle();
  const configured = String((data as any)?.nfe_provider_default || '').trim().toLowerCase();
  if (configured === 'brasilnfe') return 'brasilnfe';
  return 'brasilnfe';
}
