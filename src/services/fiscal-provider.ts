import { BrasilNFe } from "brasilnfe";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { resolveIntegrationConfiguration } from "@/lib/integration-configuration";
import { extractCfopsFromXml } from "@/lib/fiscal/cfop";
import {
  buildBrasilNfeIdentifierLookupPayload,
  classifyBrasilNfeIdentifierLookupResponse,
} from "@/lib/fiscal/brasil-nfe-identifier";
import {
  mapBrasilNfeSearchStatusToPersistedStatus,
  normalizeNfePersistedStatus,
} from "@/lib/fiscal/nfe-status";

export type NfeProvider = "brasilnfe";

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

export interface BrasilNfeCadastroSefazResult {
  ok: boolean;
  active: boolean;
  ie: string | null;
  status: number | null;
  situacao: number | null;
  fonte: string | null;
  regimeApuracao: string | null;
  error?: string;
}

const brasilNfeCadastroSefazSchema = z
  .object({
    status: z.coerce.number().optional(),
    situacao: z.coerce.number().optional(),
    ie: z.string().nullish(),
    ieUnica: z.string().nullish(),
    ieAtual: z.string().nullish(),
    fonte: z.string().nullish(),
    regimeApuracao: z.string().nullish(),
  })
  .passthrough();

export interface BrasilNfeDuplicateParseResult {
  isDuplicateIdentifier: boolean;
  identificadorInterno: string | null;
  message: string | null;
}

export async function preVisualizarNotaBrasilNfe(
  payload: Record<string, any>,
): Promise<{ ok: boolean; error?: string; base64File?: string | null }> {
  try {
    const bnfe = await getBrasilNfeClient();
    const response: any = await withBrasilNfeDnsRetry(() =>
      bnfe.consultas.preVisualizarNotaFiscal({
        notaFiscal: {
          TipoAmbiente: Number(payload.TipoAmbiente),
          ModeloDocumento: Number(payload.ModeloDocumento || 55),
          nFInfos: [payload],
        },
        TipoArquivo: 0,
        TipoEnvio: 1,
        mostrarTarjaPreVisualizacao: true,
      } as any),
    );
    const ok = response?.Status === true || response?.status === true;
    return {
      ok,
      base64File: String(response?.Base64File || "").trim() || null,
      error: ok
        ? undefined
        : String(response?.Error || response?.Message || response?.DsMotivo || "Pré-visualização fiscal rejeitada"),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || "Falha ao pré-visualizar a nota na Brasil NFe",
    };
  }
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
    options?: {
      storagePath?: string | null;
      signedUrlTtlSeconds?: number;
      chaveNf?: string | null;
    },
  ): Promise<{ url: string | null; path?: string | null; error?: string }>;
}

export async function getBrasilNfeClient() {
  const client = createServiceClient();
  const { data } = await client
    .from("integracoes")
    .select("access_token, refresh_token, url, conectado")
    .eq("tipo", "brasilnfe")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const config = resolveIntegrationConfiguration("brasilnfe", data || {}, process.env);
  const token = config.token.value;
  const userToken = config.userToken.value || undefined;
  const baseUrl = config.url.value;

  if (!token) {
    throw new Error("Token da integração Brasil NFe não configurado");
  }

  return new BrasilNFe(token, userToken, baseUrl);
}

export type BrasilNfeIncomingDocument = {
  chave: string;
  numero: string | null;
  modeloDocumento: number | null;
  valor: number;
  valorIcms: number | null;
  status: number | null;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  emitenteIe: string | null;
  destinatarioCnpj: string | null;
  destinatarioNome: string | null;
  numeroProtocolo: string | null;
  cfops: string | null;
  digestValue: string | null;
  emitidaEm: string | null;
  recebidaEm: string | null;
};

function mapBrasilNfeIncomingDocument(note: any): BrasilNfeIncomingDocument {
  return {
    chave: String(note?.Chave || '').replace(/\D/g, ''),
    numero: String(note?.Numero || '').trim() || null,
    modeloDocumento: Number.isFinite(Number(note?.ModeloDocumento)) ? Number(note.ModeloDocumento) : null,
    valor: Number(note?.Valor || 0),
    valorIcms: Number.isFinite(Number(note?.ValorIcms)) ? Number(note.ValorIcms) : null,
    status: Number.isFinite(Number(note?.Status)) ? Number(note.Status) : null,
    emitenteCnpj: String(note?.CnpjEmissor || '').replace(/\D/g, '') || null,
    emitenteNome: String(note?.NomeEmissor || '').trim() || null,
    emitenteIe: String(note?.IeEmissor || '').trim() || null,
    destinatarioCnpj: String(note?.CnpjDestinatario || '').replace(/\D/g, '') || null,
    destinatarioNome: String(note?.NomeDestinatario || '').trim() || null,
    numeroProtocolo: String(note?.NumeroProtocolo || '').trim() || null,
    cfops: String(note?.Cfops || '').trim() || null,
    digestValue: String(note?.DigestValue || '').trim() || null,
    emitidaEm: String(note?.DtEmissao || '').trim() || null,
    recebidaEm: String(note?.DtRecebimento || '').trim() || null,
  };
}

export async function listarNotasEntradaBrasilNfe(input: {
  inicio: string;
  fim: string;
}): Promise<BrasilNfeIncomingDocument[]> {
  const bnfe = await getBrasilNfeClient();
  const response: any = await withBrasilNfeDnsRetry(() =>
    bnfe.consultas.obterNotasFiscais({
      TipoDocumentoFiscal: 0,
      DtInicio: input.inicio,
      DtFim: input.fim,
    }),
  );
  const providerError = String(response?.Error || response?.Message || '').trim();
  if (providerError) throw new Error(providerError);
  return (Array.isArray(response?.Notas) ? response.Notas : [])
    .map(mapBrasilNfeIncomingDocument)
    .filter((note: BrasilNfeIncomingDocument) => note.chave.length === 44);
}

function incomingNfePeriod(chave: string): { start: string; end: string } {
  const year = 2000 + Number(chave.slice(2, 4));
  const month = Number(chave.slice(4, 6));
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new Error("Chave de NF-e com período inválido");
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const format = (value: Date) => value.toISOString().slice(0, 19);
  return { start: format(start), end: format(end) };
}

/** Consulta uma NF-e de entrada no período codificado na própria chave. */
export async function buscarNotaEntradaBrasilNfe(
  chave: string,
): Promise<BrasilNfeIncomingDocument | null> {
  const period = incomingNfePeriod(chave);
  const notes = await listarNotasEntradaBrasilNfe({ inicio: period.start, fim: period.end });
  return notes.find((note) => note.chave === chave) || null;
}

export async function obterXmlEntradaBrasilNfe(chave: string): Promise<string | null> {
  const bnfe = await getBrasilNfeClient();
  const buffer = await withBrasilNfeDnsRetry(() =>
    bnfe.arquivos.pegarArquivo({
      ChaveNF: chave,
      FileType: 1,
      TipoDocumentoFiscal: 0,
    }),
  );
  return buffer?.length ? buffer.toString("utf-8") : null;
}

export async function manifestarNotaEntradaBrasilNfe(input: {
  chave: string;
  tipoAmbiente: 1 | 2;
  tipoManifestacao: 1 | 2 | 3 | 4;
  justificativa?: string;
}): Promise<{
  status: number | null;
  protocolo: string | null;
  motivo: string | null;
  numeroSequencial: number | null;
  codigoSefaz: number | null;
  evento: string | null;
}> {
  const bnfe = await getBrasilNfeClient();
  const response: any = await withBrasilNfeDnsRetry(() =>
    bnfe.eventos.manifestarNotaFiscal({
      Chave: input.chave,
      TipoAmbiente: input.tipoAmbiente,
      TipoManifestacao: input.tipoManifestacao,
      ...(input.justificativa ? { Justificativa: input.justificativa } : {}),
    } as any),
  );
  return {
    status: Number.isFinite(Number(response?.Status)) ? Number(response.Status) : null,
    protocolo: String(response?.NuProtocolo || "").trim() || null,
    motivo: String(response?.DsMotivo || response?.Error || "").trim() || null,
    numeroSequencial: Number.isFinite(Number(response?.NumeroSequencial)) ? Number(response.NumeroSequencial) : null,
    codigoSefaz: Number.isFinite(Number(response?.CodStatusRespostaSefaz)) ? Number(response.CodStatusRespostaSefaz) : null,
    evento: String(response?.DsEvento || '').trim() || null,
  };
}

export async function manifestarCienciaNotaEntradaBrasilNfe(input: {
  chave: string;
  tipoAmbiente: 1 | 2;
}) {
  return manifestarNotaEntradaBrasilNfe({ ...input, tipoManifestacao: 2 });
}

export async function obterDocumentoEntradaBrasilNfe(
  chave: string,
  fileType: 1 | 2,
): Promise<Buffer | null> {
  const bnfe = await getBrasilNfeClient();
  const buffer = await withBrasilNfeDnsRetry(() =>
    bnfe.arquivos.pegarArquivo({ ChaveNF: chave, FileType: fileType, TipoDocumentoFiscal: 0 }),
  );
  return buffer?.length ? buffer : null;
}

/**
 * Consulta o Cadastro Centralizado de Contribuintes pela integração Brasil NFe.
 * Usado para corrigir divergências entre o cadastro fiscal do ML e a SEFAZ.
 */
export async function consultarCadastroSefazBrasilNfe(params: {
  uf: string;
  documento: string;
}): Promise<BrasilNfeCadastroSefazResult> {
  const uf = String(params.uf || "").trim().toUpperCase();
  const documento = String(params.documento || "").replace(/\D/g, "");
  if (!/^[A-Z]{2}$/.test(uf) || !(documento.length === 11 || documento.length === 14)) {
    return {
      ok: false,
      active: false,
      ie: null,
      status: null,
      situacao: null,
      fonte: null,
      regimeApuracao: null,
      error: "UF ou documento inválido para consulta cadastral na SEFAZ",
    };
  }

  try {
    const bnfe = await getBrasilNfeClient();
    const raw = await withBrasilNfeDnsRetry(() =>
      bnfe.consultas.consultarCadastroSefaz({ uf, cpfCnpjIe: documento }),
    );
    const parsed = brasilNfeCadastroSefazSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        active: false,
        ie: null,
        status: null,
        situacao: null,
        fonte: null,
        regimeApuracao: null,
        error: "Resposta inválida da consulta cadastral Brasil NFe/SEFAZ",
      };
    }

    const data = parsed.data;
    const ie = String(data.ieAtual || data.ieUnica || data.ie || "")
      .replace(/\D/g, "") || null;
    const status = Number.isFinite(Number(data.status)) ? Number(data.status) : null;
    const situacao = Number.isFinite(Number(data.situacao))
      ? Number(data.situacao)
      : null;
    const active = status === 1 && situacao === 1;

    return {
      ok: status === 1,
      active,
      ie: active ? ie : null,
      status,
      situacao,
      fonte: String(data.fonte || "").trim() || null,
      regimeApuracao: String(data.regimeApuracao || "").trim() || null,
    };
  } catch (err: any) {
    return {
      ok: false,
      active: false,
      ie: null,
      status: null,
      situacao: null,
      fonte: null,
      regimeApuracao: null,
      error: err?.message || "Falha ao consultar cadastro do destinatário na SEFAZ",
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCauseCode(err: any): string {
  return String(
    err?.cause?.code ||
      err?.code ||
      err?.errno ||
      err?.error?.cause?.code ||
      err?.response?.cause?.code ||
      "",
  ).trim();
}

function isBrasilNfeTemporaryDnsError(err: any): boolean {
  const code = getErrorCauseCode(err);
  const message = String(
    err?.message || err?.error?.message || "",
  ).toLowerCase();
  return code === "EAI_AGAIN" || message.includes("getaddrinfo eai_again");
}

function extractBrasilNfeRetryAfterSeconds(err: any): number | null {
  const direct = Number(
    err?.retryAfterSeconds ??
      err?.error?.retryAfterSeconds ??
      err?.response?.data?.retryAfterSeconds ??
      err?.response?.retryAfterSeconds,
  );
  if (Number.isFinite(direct) && direct > 0) return direct;

  const message = String(err?.message || err?.error?.message || "");
  const match = message.match(/retryAfterSeconds"\s*:\s*(\d+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isBrasilNfeRateLimitError(err: any): boolean {
  const message = String(err?.message || err?.error?.message || "").toLowerCase();
  return message.includes('rate_limited') || message.includes('limite de 60 requisições');
}

function normalizeTemporaryText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isBrasilNfeTemporaryProviderMessage(value: unknown): boolean {
  const message = normalizeTemporaryText(value);
  return (
    message.includes("servico paralisado momentaneamente") ||
    message.includes("paralisado momentaneamente") ||
    message.includes("tempo de processamento excedido") ||
    message.includes("timeout") ||
    message.includes("temporariamente indisponivel")
  );
}

function extractBrasilNfeEmitError(resp: any): string | undefined {
  return (
    resp?.Error ||
    resp?.ReturnNF?.DsStatusRespostaSefaz ||
    resp?.ReturnNF?.Mensagem ||
    resp?.ReturnNF?.Msg ||
    resp?.Mensagem ||
    resp?.Message ||
    resp?.erros?.[0]?.descricao ||
    resp?.erros?.[0]?.mensagem ||
    undefined
  );
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

      if (isBrasilNfeRateLimitError(err) && attempt < attempts) {
        const retryAfterSeconds = extractBrasilNfeRetryAfterSeconds(err) || attempt * 5;
        console.warn(
          JSON.stringify({
            event: "brasilnfe_rate_limit_retry",
            attempt,
            attempts,
            retry_after_seconds: retryAfterSeconds,
            message: err?.message || null,
          }),
        );
        await sleep(retryAfterSeconds * 1000);
        continue;
      }

      if (!isBrasilNfeTemporaryDnsError(err) || attempt >= attempts) throw err;
      console.warn(
        JSON.stringify({
          event: "brasilnfe_dns_retry",
          attempt,
          attempts,
          error_code: getErrorCauseCode(err) || null,
          message: err?.message || null,
        }),
      );
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

export async function checkBrasilNfeChaveExists(
  chave: string,
  tpAmb: 1 | 2,
): Promise<BrasilNfeChaveCheckResult> {
  const bnfe = await getBrasilNfeClient();
  const resp: any = await withBrasilNfeDnsRetry(() =>
    bnfe.arquivos.obterArquivosPorRange({
      Chaves: [chave],
      TipoAmbiente: tpAmb,
      TipoNota: 1,
      Type: 1,
    } as any),
  );

  const quantidade = Number(resp?.Quantidade || 0);
  const avisos = Array.isArray(resp?.Avisos)
    ? resp.Avisos.map((v: any) => String(v))
    : [];
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

export function parseBrasilNfeDuplicateIdentifier(
  errorDetails: any,
): BrasilNfeDuplicateParseResult {
  const rawMessage = String(
    errorDetails?.rawResponse?.Error ||
      errorDetails?.error?.response?.data?.Error ||
      errorDetails?.error?.message ||
      "",
  ).trim();
  const normalized = rawMessage.toLowerCase();
  const isDuplicateIdentifier =
    normalized.includes(
      "já foi emitida uma nota fiscal com o identificador interno",
    ) ||
    normalized.includes(
      "ja foi emitida uma nota fiscal com o identificador interno",
    );
  const identifierMatch = rawMessage.match(
    /identificador interno\s+([^\s(]+)/i,
  );
  const identificadorInterno = identifierMatch?.[1]
    ? String(identifierMatch[1]).trim()
    : null;
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
  preferAuthorized?: boolean;
}): Promise<{
  ok: boolean;
  nota?: BrasilNfeNotaByIdentifier | null;
  error?: string;
  raw?: any;
  outcome: "found" | "not_found" | "transient_error";
  terminal: boolean;
  temporary: boolean;
}> {
  const dtFim = input.dtFim || new Date().toISOString();
  const dtInicio =
    input.dtInicio ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let resp: any = null;

  try {
    const bnfe = await getBrasilNfeClient();
    resp = await withBrasilNfeDnsRetry(() =>
      bnfe.consultas.obterNotasFiscais(
        buildBrasilNfeIdentifierLookupPayload({
          identificadorInterno: input.identificadorInterno,
          dtInicio,
          dtFim,
        }) as any,
      ),
    );
  } catch (err: any) {
    return {
      ok: false,
      nota: null,
      error: err?.message || "Falha transitória ao consultar NF na Brasil NFe",
      raw: err?.response?.data || null,
      outcome: "transient_error",
      terminal: false,
      temporary: true,
    };
  }

  const classified = classifyBrasilNfeIdentifierLookupResponse({
    response: resp,
    identificadorInterno: input.identificadorInterno,
    preferAuthorized: input.preferAuthorized,
  });
  if (classified.kind !== "found") {
    return {
      ok: false,
      nota: null,
      error: classified.error,
      raw: resp,
      outcome: classified.kind,
      terminal: classified.kind === "not_found",
      temporary: classified.kind === "transient_error",
    };
  }

  const n = classified.nota;
  return {
    ok: true,
    nota: {
      chave: String(n?.Chave || "").trim(),
      identificadorInterno:
        String(n?.IdentificadorInterno || "").trim() || null,
      numero: Number.isFinite(Number(n?.Numero)) ? Number(n.Numero) : null,
      status: Number.isFinite(Number(n?.Status)) ? Number(n.Status) : null,
      dtEmissao: String(n?.DtEmissao || "").trim() || null,
      numeroProtocolo: String(n?.NumeroProtocolo || "").trim() || null,
    },
    raw: resp,
    outcome: "found",
    terminal: false,
    temporary: false,
  };
}

export async function obterXmlBrasilNfePorChave(chave: string): Promise<{
  ok: boolean;
  xml?: string | null;
  error?: string;
}> {
  try {
    const bnfe = await getBrasilNfeClient();
    const buffer: Buffer = await withBrasilNfeDnsRetry(() =>
      bnfe.arquivos.pegarArquivo({
        ChaveNF: chave,
        FileType: 1,
        TipoDocumentoFiscal: 1,
      } as any),
    );
    const xml = buffer?.toString("utf-8") || null;
    if (!xml)
      return {
        ok: false,
        xml: null,
        error: "XML não retornado por chave na Brasil NFe",
      };
    return { ok: true, xml };
  } catch (err: any) {
    return {
      ok: false,
      xml: null,
      error: err?.message || "Erro ao obter XML por chave na Brasil NFe",
    };
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
    const resp: any = await withBrasilNfeDnsRetry(() =>
      bnfe.eventos.cancelarNotaFiscal({
        ChaveNF: input.chave,
        NumeroProtocolo: input.protocolo || undefined,
        Justificativa:
          input.justificativa || "Cancelamento para reemissão operacional",
        TipoDocumento: 0,
        NumeroSequencial: 1,
      } as any),
    );

    const status = Number(resp?.Status || 0);
    const cod = Number(resp?.CodStatusRespostaSefaz || 0);
    const ds = String(resp?.DsMotivo || resp?.Error || "").toLowerCase();
    const duplicatedCancelEvent =
      cod === 573 && ds.includes("duplicidade de evento");
    const ok =
      status === 1 ||
      [135, 136, 155].includes(cod) ||
      ds.includes("evento registrado") ||
      duplicatedCancelEvent;
    if (!ok) {
      return {
        ok: false,
        error: String(
          resp?.Error ||
            resp?.DsMotivo ||
            "Falha ao cancelar nota na Brasil NFe",
        ),
        raw: resp,
      };
    }
    return { ok: true, raw: resp };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Erro ao cancelar nota na Brasil NFe",
      raw: err?.response?.data || null,
    };
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
    const resp: any = await withBrasilNfeDnsRetry(() =>
      bnfe.eventos.enviarCartaCorrecao({
        ChaveNF: input.chave,
        Correcao: input.correcao,
        NumeroSequencial: Number(input.numeroSequencial || 1),
        TipoAmbiente: Number(input.tipoAmbiente || 1),
      } as any),
    );

    const status = Number(resp?.Status || 0);
    const cod = Number(resp?.CodStatusRespostaSefaz || 0);
    const ds = String(resp?.DsMotivo || "").toLowerCase();
    const ok =
      status === 1 ||
      [135, 136].includes(cod) ||
      ds.includes("evento registrado");
    if (!ok) {
      return {
        ok: false,
        error: String(
          resp?.Error ||
            resp?.DsMotivo ||
            "Falha ao enviar carta de correção na Brasil NFe",
        ),
        raw: resp,
      };
    }

    return {
      ok: true,
      protocolo:
        String(resp?.NuProtocolo || resp?.NumeroProtocolo || "").trim() || null,
      raw: resp,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Erro ao enviar carta de correção na Brasil NFe",
      raw: err?.response?.data || null,
    };
  }
}

function extractFirstCfop(xml: string | null | undefined): string | null {
  if (!xml) return null;
  return extractCfopsFromXml(xml)[0] || null;
}

class BrasilNfeFiscalProvider implements FiscalProvider {
  readonly type: NfeProvider = "brasilnfe";

  private async getClient() {
    return getBrasilNfeClient();
  }

  async emitirNota(ctx: FiscalEmitContext): Promise<EmitResult> {
    if (!ctx.nfePayload) {
      return {
        ok: false,
        error: "nfePayload é obrigatório para emissão com Brasil NFe",
        errorDetails: null,
      };
    }

    try {
      const bnfe = await this.getClient();
      let resp: any = null;
      let errorMessage: string | undefined;
      let temporaryProviderFailure = false;
      const attempts = 3;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        resp = await withBrasilNfeDnsRetry(() =>
          bnfe.notaFiscal.enviarNotaFiscal(ctx.nfePayload as any),
        );
        const okAttempt = Boolean(resp?.ReturnNF?.Ok);
        errorMessage = okAttempt
          ? undefined
          : extractBrasilNfeEmitError(resp) || "Emissão rejeitada";
        temporaryProviderFailure =
          !okAttempt && isBrasilNfeTemporaryProviderMessage(errorMessage);

        if (okAttempt || !temporaryProviderFailure || attempt >= attempts)
          break;

        console.warn(
          JSON.stringify({
            event: "brasilnfe_emit_retry",
            attempt,
            attempts,
            message: errorMessage,
          }),
        );
        await sleep(1500 * attempt);
      }

      const ok = Boolean(resp?.ReturnNF?.Ok);
      const externalId =
        String(
          resp?.ReturnNF?.Id || resp?.ReturnNF?.Numero || resp?.codigo || "",
        ).trim() || undefined;
      const chave = resp?.ReturnNF?.ChaveNF || null;
      const numero = resp?.ReturnNF?.NumeroNF || resp?.ReturnNF?.Numero || null;
      const protocolo = resp?.ReturnNF?.Numero || null;
      const xml = resp?.Base64Xml
        ? Buffer.from(resp.Base64Xml, "base64").toString("utf-8")
        : null;
      const danfeUrl = resp?.UrlDanfe || null;
      errorMessage = ok
        ? undefined
        : errorMessage ||
          extractBrasilNfeEmitError(resp) ||
          "Emissão rejeitada";

      return {
        ok,
        status: ok
          ? "authorized"
          : temporaryProviderFailure
            ? "temporary_failure"
            : "rejected",
        externalId,
        chave,
        numero,
        protocolo,
        xml,
        danfeUrl,
        cfop: extractFirstCfop(xml),
        error: errorMessage,
        errorDetails: ok
          ? null
          : {
              provider: "brasilnfe",
              rawResponse: resp,
              temporary: temporaryProviderFailure,
            },
        temporary: temporaryProviderFailure,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || "Erro ao emitir nota no Brasil NFe",
        errorDetails: {
          provider: "brasilnfe",
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
      const resp: any = await withBrasilNfeDnsRetry(() =>
        bnfe.consultas.buscarNotaFiscal({
          NumeroRecibo: externalIdOrOrderId,
        } as any),
      );
      const found = resp?.ReturnNF || resp?.NotasFiscais?.[0] || null;
      if (!found)
        return {
          ok: false,
          error: "NF não encontrada no Brasil NFe",
          temporary: true,
        };
      const rawStatus = found?.Situacao ?? found?.Status ?? "processing";
      return {
        ok: true,
        status:
          mapBrasilNfeSearchStatusToPersistedStatus(Number(rawStatus))
          || normalizeNfePersistedStatus(String(rawStatus))
          || "processing",
        externalId: String(found?.Id || found?.Numero || externalIdOrOrderId),
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || "Erro ao consultar nota no Brasil NFe",
        temporary: true,
      };
    }
  }

  async obterXml(
    externalIdOrOrderId: string,
    options?: { chaveNf?: string | null },
  ): Promise<XmlResult> {
    try {
      const bnfe = await this.getClient();
      const chaveNf = String(options?.chaveNf || "").trim();
      const requests = chaveNf
        ? [
            { ChaveNF: chaveNf, FileType: 1, TipoDocumentoFiscal: 1 },
            { NumeroRecibo: externalIdOrOrderId, FileType: 1 },
          ]
        : [{ NumeroRecibo: externalIdOrOrderId, FileType: 1 }];
      let buffer: Buffer | null = null;
      let lastError: any = null;
      for (const payload of requests) {
        try {
          buffer = await withBrasilNfeDnsRetry(() =>
            bnfe.arquivos.pegarArquivo(payload as any),
          );
          if (buffer?.length) break;
        } catch (err: any) {
          lastError = err;
        }
      }
      const xml = buffer?.toString("utf-8") || null;
      if (!xml && lastError) {
        return {
          xml: null,
          error: lastError?.message || "Erro ao obter XML no Brasil NFe",
          temporary: true,
        };
      }
      return { xml };
    } catch (err: any) {
      return {
        xml: null,
        error: err?.message || "Erro ao obter XML no Brasil NFe",
        temporary: true,
      };
    }
  }

  async obterDanfe(
    externalIdOrOrderId: string,
    options?: {
      storagePath?: string | null;
      signedUrlTtlSeconds?: number;
      chaveNf?: string | null;
    },
  ): Promise<{ url: string | null; path?: string | null; error?: string }> {
    try {
      const bnfe = await this.getClient();
      const chaveNf = String(options?.chaveNf || "").trim();
      const requests = chaveNf
        ? [
            { ChaveNF: chaveNf, FileType: 2, TipoDocumentoFiscal: 1 },
            { NumeroRecibo: externalIdOrOrderId, FileType: 2 },
          ]
        : [{ NumeroRecibo: externalIdOrOrderId, FileType: 2 }];
      let buffer: Buffer | null = null;
      let lastError: any = null;
      for (const payload of requests) {
        try {
          buffer = await withBrasilNfeDnsRetry(() =>
            bnfe.arquivos.pegarArquivo(payload as any),
          );
          if (buffer?.length) break;
        } catch (err: any) {
          lastError = err;
        }
      }
      if (!buffer || !buffer.length)
        return { url: null, error: "DANFE não retornado" };

      const serviceClient = createServiceClient();
      const fileName = `${externalIdOrOrderId}.pdf`;
      const filePath = String(
        options?.storagePath || `brasilnfe/${fileName}`,
      ).trim();
      const up = await serviceClient.storage
        .from("danfes")
        .upload(filePath, buffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (up.error) return { url: null, error: up.error.message };

      const signed = await serviceClient.storage
        .from("danfes")
        .createSignedUrl(
          filePath,
          Number(options?.signedUrlTtlSeconds || 60 * 60),
        );
      if (signed.error || !signed.data?.signedUrl)
        return {
          url: null,
          error: signed.error?.message || "Falha ao assinar URL da DANFE",
        };
      return { url: signed.data.signedUrl, path: filePath };
    } catch (err: any) {
      return {
        url: null,
        error: err?.message || "Erro ao obter DANFE no Brasil NFe",
      };
    }
  }
}

export function getFiscalProvider(provider: NfeProvider): FiscalProvider {
  if (provider !== "brasilnfe") {
    throw new Error("Provedor fiscal inválido. Apenas brasilnfe é permitido.");
  }
  return new BrasilNfeFiscalProvider();
}

export async function getDefaultFiscalProvider(): Promise<NfeProvider> {
  return "brasilnfe";
}
