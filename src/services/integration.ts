/**
 * Gerenciamento de tokens OAuth para integrações com APIs externas.
 * Atualmente suporta Mercado Livre (OAuth2 com refresh automático).
 * Os tokens são armazenados na tabela `integracoes` do Supabase.
 */
import { randomUUID } from "crypto";
import { inflateRawSync } from "zlib";
import { createServiceClient } from "@/lib/supabase";
import { validateMercadoLivreTokenOwner } from "@/lib/ml-account-guard";
import { isMlShipmentLabelPrintable } from "@/lib/ml/fiscal-release";
import { classifyMlLabelHttpFailure } from "@/lib/ml/label-http-failure";
import { registrarEventoNfAuditoria } from "@/services/nf-auditoria";
import type { Database } from "@/types/database";

type IntegracaoRow = Database["public"]["Tables"]["integracoes"]["Row"];
type IntegracaoTipo = IntegracaoRow["tipo"];

export type MLFailureCategory =
  "expected_operational" | "retryable" | "auth_fatal" | "error";
export type MLAuthState = "ok" | "degraded" | "reauth_required";

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
  headers?: Record<string, string>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const REFRESH_WAIT_MS = 700;
const REFRESH_WAIT_ATTEMPTS = 8;
const AUTH_FATAL_COOLDOWN_MS = 10 * 60 * 1000;
const FATAL_REFRESH_ERROR_CODES = [
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
  "unauthorized_application",
];
let inflightForcedRefresh: Promise<string | null> | null = null;
let authBlockedUntilMs = 0;
let verifiedAccessToken: string | null = null;

function isNextProductionBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function getStackOrigin() {
  return (
    new Error().stack
      ?.split("\n")
      .slice(2, 8)
      .map((line) => line.trim())
      .join(" | ") || null
  );
}

class IntegracaoReadError extends Error {
  code: string;
  details: string | null;

  constructor(message: string, code: string, details?: string | null) {
    super(message);
    this.name = "IntegracaoReadError";
    this.code = code;
    this.details = details || null;
  }
}

function isIntegracaoReadError(error: unknown): error is IntegracaoReadError {
  return (
    error instanceof IntegracaoReadError ||
    (error as any)?.name === "IntegracaoReadError"
  );
}

function logMlAuthEvent(payload: Record<string, any>) {
  console.log(
    JSON.stringify({
      event: "ml_oauth_refresh",
      timestamp_utc: new Date().toISOString(),
      ...payload,
    }),
  );
}

function setAuthFatalCooldown(reason: string) {
  authBlockedUntilMs = Math.max(
    authBlockedUntilMs,
    Date.now() + AUTH_FATAL_COOLDOWN_MS,
  );
  console.error(
    JSON.stringify({
      event: "ml_auth_fatal_block",
      timestamp_utc: new Date().toISOString(),
      reason,
      blocked_until: new Date(authBlockedUntilMs).toISOString(),
      cooldown_ms: AUTH_FATAL_COOLDOWN_MS,
    }),
  );
}

function clearAuthFatalCooldown() {
  authBlockedUntilMs = 0;
}

function getAuthFatalBlockedUntil(): string | null {
  if (authBlockedUntilMs <= Date.now()) return null;
  return new Date(authBlockedUntilMs).toISOString();
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - Date.now() < 300000;
}

function isBlockedMlFiscalInvoicePath(path: string): boolean {
  return (
    /\/users\/[^/]+\/invoices(?:\/|$)/i.test(path) ||
    /\/invoices\/documents\//i.test(path)
  );
}

function logMlFiscalEndpointBlocked(path: string, method: string) {
  const stackOrigin =
    new Error().stack
      ?.split("\n")
      .slice(2, 7)
      .map((line) => line.trim())
      .join(" | ") || null;
  const payload = {
    event: "ml_fiscal_endpoint_blocked",
    timestamp_utc: new Date().toISOString(),
    path,
    method,
    blocked_reason: "fiscal_ml_desativado_por_politica",
    stack_origin: stackOrigin,
  };
  console.error(JSON.stringify(payload));
  void (async () => {
    try {
      await createServiceClient().from("nf_auditoria_eventos").insert({
        evento: "ml_fiscal_endpoint_blocked",
        status_resultante: "blocked",
        resposta_ml: payload,
      });
    } catch {}
  })();
}

function classifyMLFailure(
  path: string,
  status: number,
  body: string,
): MLFailureCategory {
  const lowerBody = body.toLowerCase();
  if (status === 401) return "auth_fatal";
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(status))
    return "retryable";

  const expectedShipment404 =
    /\/orders\/.+\/shipments/.test(path) && status === 404;
  const expectedCarrier404 =
    /\/shipments\/.+\/carrier/.test(path) &&
    status === 404 &&
    lowerBody.includes("tracking url");
  const expectedShipping404 =
    path.includes("/shipping_options") &&
    status === 404 &&
    (lowerBody.includes("stock out") || lowerBody.includes("no coverage"));
  const expectedShipmentInvoiceData404 =
    /\/shipments\/[^/]+\/invoice_data/i.test(path) &&
    status === 404 &&
    (lowerBody.includes("not_found_shipment_invoice") ||
      lowerBody.includes("not found shipment invoice"));
  const expectedShipmentInvoiceData415JsonUnsupported =
    /\/shipments\/[^/]+\/invoice_data/i.test(path) &&
    status === 415 &&
    (lowerBody.includes("unsupported type json") ||
      lowerBody.includes("unsupported content-type json"));

  if (
    expectedShipment404 ||
    expectedCarrier404 ||
    expectedShipping404 ||
    expectedShipmentInvoiceData404 ||
    expectedShipmentInvoiceData415JsonUnsupported
  ) {
    return "expected_operational";
  }

  return "error";
}

function tryParseJson(body: string): any | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function extractErrorCode(parsed: any): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  return parsed.code || parsed.error || parsed.error_code || null;
}

function extractTraceId(parsed: any): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const cause = parsed.cause;
  if (Array.isArray(cause)) {
    for (const c of cause) {
      if (!c || typeof c !== "object") continue;
      if (typeof c["trace-id"] === "string") return c["trace-id"];
      if (typeof c.trace_id === "string") return c.trace_id;
    }
  }
  return null;
}

function logMLFailure(
  method: string,
  path: string,
  status: number,
  body: string,
  error: MLRequestError,
) {
  const base = `[ML API] ${method} ${path} → ${status}`;
  const snippet = body.substring(0, 500);
  const trace = error.traceId ? ` trace-id=${error.traceId}` : "";

  if (
    error.category === "expected_operational" ||
    error.category === "retryable"
  ) {
    console.warn(`${base} (${error.category})${trace}: ${snippet}`);
    return;
  }

  console.error(`${base} (${error.category})${trace}: ${snippet}`);
}

async function getIntegracao(
  tipo: IntegracaoTipo,
): Promise<IntegracaoRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("integracoes")
    .select("*")
    .eq("tipo", tipo)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const payload = {
      event: "integracao_read_failed",
      timestamp_utc: new Date().toISOString(),
      tipo,
      code: error.code || "supabase_read_failed",
      message: error.message,
      details: error.details || null,
    };
    console.error(JSON.stringify(payload));
    throw new IntegracaoReadError(
      `Falha ao ler integração ${tipo}`,
      error.code || "supabase_read_failed",
      error.message,
    );
  }
  return data || null;
}

async function updateIntegracao(
  tipo: IntegracaoTipo,
  values: Database["public"]["Tables"]["integracoes"]["Update"],
) {
  const client = createServiceClient();
  await client.from("integracoes").update(values).eq("tipo", tipo);
}

async function updateTokens(
  tipo: IntegracaoTipo,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  if (tipo === "mercadolivre" && isNextProductionBuildPhase()) {
    const payload = {
      source: "refresh_update_tokens",
      reason: "next_build_phase",
      stack_origin: getStackOrigin(),
      timestamp_utc: new Date().toISOString(),
    };
    console.error(
      JSON.stringify({ event: "ml_token_mutation_blocked_build", ...payload }),
    );
    return;
  }
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

async function acquireRefreshLock(
  tipo: IntegracaoTipo,
  owner: string,
): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await (client as any).rpc(
    "acquire_integracao_refresh_lock",
    {
      p_tipo: tipo,
      p_owner: owner,
      p_ttl_seconds: 25,
    },
  );
  if (error) {
    // Backward compatibility while migration is not applied yet.
    console.warn(
      "[ML OAuth] Lock de refresh indisponível, seguindo sem lock distribuído:",
      error.message,
    );
    return true;
  }
  return Boolean(data);
}

async function releaseRefreshLock(tipo: IntegracaoTipo, owner: string) {
  const client = createServiceClient();
  const { error } = await (client as any).rpc(
    "release_integracao_refresh_lock",
    {
      p_tipo: tipo,
      p_owner: owner,
    },
  );
  if (error) {
    console.warn("[ML OAuth] Falha ao liberar lock de refresh:", error.message);
  }
}

async function markRefreshFailure(
  fatalAuth: boolean,
  errorCode: string | null,
  errorMessage: string | null,
  source = "refresh_failure",
) {
  if (isNextProductionBuildPhase()) {
    const payload = {
      source,
      reason: "next_build_phase",
      error_code: errorCode,
      error_message: errorMessage,
      fatal_auth: fatalAuth,
      stack_origin: getStackOrigin(),
      timestamp_utc: new Date().toISOString(),
    };
    console.error(
      JSON.stringify({ event: "ml_token_mutation_blocked_build", ...payload }),
    );
    return;
  }
  await updateIntegracao("mercadolivre", {
    conectado: fatalAuth ? false : true,
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: errorMessage,
    last_refresh_error_code: errorCode,
  });
}

async function auditMlAccountNotAllowed(input: {
  source: string;
  reason: string;
  account: Awaited<ReturnType<typeof validateMercadoLivreTokenOwner>>;
  action: "cleared_tokens" | "blocked_build_mutation";
}) {
  const payload = {
    source: input.source,
    reason: input.reason,
    action: input.action,
    user_id: input.account.userId,
    nickname: input.account.nickname,
    error: input.account.error,
    stack_origin: getStackOrigin(),
    timestamp_utc: new Date().toISOString(),
  };
  console.error(
    JSON.stringify({ event: "ml_account_not_allowed", ...payload }),
  );
  if (isNextProductionBuildPhase()) return;
  await registrarEventoNfAuditoria({
    evento: "ml_account_not_allowed",
    respostaMl: payload,
    statusResultante: input.action,
  });
}

async function clearMercadoLivreTokens(
  reason: string,
  source: string,
  account: Awaited<ReturnType<typeof validateMercadoLivreTokenOwner>>,
) {
  verifiedAccessToken = null;
  if (isNextProductionBuildPhase()) {
    const payload = {
      source,
      reason,
      stack_origin: getStackOrigin(),
      timestamp_utc: new Date().toISOString(),
    };
    console.error(
      JSON.stringify({ event: "ml_token_mutation_blocked_build", ...payload }),
    );
    await auditMlAccountNotAllowed({
      source,
      reason,
      account,
      action: "blocked_build_mutation",
    });
    return;
  }
  await updateIntegracao("mercadolivre", {
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    conectado: false,
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: reason,
    last_refresh_error_code: "ml_account_not_allowed",
  });
  await auditMlAccountNotAllowed({
    source,
    reason,
    account,
    action: "cleared_tokens",
  });
}

async function ensureAllowedMercadoLivreToken(
  accessToken: string,
  source = "unknown",
): Promise<"allowed" | "account_not_allowed" | "refresh_required"> {
  if (verifiedAccessToken === accessToken) return "allowed";

  const account = await validateMercadoLivreTokenOwner(accessToken);
  if (account.ok) {
    verifiedAccessToken = accessToken;
    return "allowed";
  }

  if (account.reason !== "account_not_allowed") {
    return "refresh_required";
  }

  const identity =
    account.nickname || account.userId || account.error || "desconhecida";
  await clearMercadoLivreTokens(
    `Conta Mercado Livre não permitida: ${identity}`,
    source,
    account,
  );
  return "account_not_allowed";
}

function isFatalAuthRefreshError(errorCode: string | null): boolean {
  return FATAL_REFRESH_ERROR_CODES.includes(errorCode || "");
}

async function waitTokenFromOtherRefresher(): Promise<string | null> {
  for (let i = 0; i < REFRESH_WAIT_ATTEMPTS; i++) {
    await delay(REFRESH_WAIT_MS);
    const current = await getIntegracao("mercadolivre");
    if (current?.access_token && !isExpired(current.token_expires_at)) {
      const validation = await ensureAllowedMercadoLivreToken(
        current.access_token,
        "wait_token_from_other_refresher",
      );
      if (validation === "allowed") return current.access_token;
      if (validation === "account_not_allowed") return null;
    }
  }
  return null;
}

async function refreshMLTokenFromDB(force: boolean): Promise<string | null> {
  const refreshStartedAt = Date.now();
  const initial = await getIntegracao("mercadolivre");
  if (!initial?.refresh_token) return null;

  if (!force && initial.access_token && !isExpired(initial.token_expires_at)) {
    const validation = await ensureAllowedMercadoLivreToken(
      initial.access_token,
      "refresh_initial_cached_token",
    );
    if (validation === "allowed") return initial.access_token;
    if (validation === "account_not_allowed") return null;
  }

  const owner = randomUUID();
  const lockAcquired = await acquireRefreshLock("mercadolivre", owner);

  if (!lockAcquired) {
    return waitTokenFromOtherRefresher();
  }

  try {
    const latest = await getIntegracao("mercadolivre");
    if (!latest?.refresh_token) return null;

    if (!force && latest.access_token && !isExpired(latest.token_expires_at)) {
      const validation = await ensureAllowedMercadoLivreToken(
        latest.access_token,
        "refresh_latest_cached_token",
      );
      if (validation === "allowed") return latest.access_token;
      if (validation === "account_not_allowed") return null;
    }

    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: latest.client_id || "",
        client_secret: latest.client_secret || "",
        refresh_token: latest.refresh_token,
      }),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const code = payload?.error || payload?.code || null;
      const message =
        payload?.error_description ||
        payload?.message ||
        `OAuth refresh HTTP ${res.status}`;
      const fatalAuth = isFatalAuthRefreshError(code);
      await markRefreshFailure(
        fatalAuth,
        code,
        message,
        "refresh_http_failure",
      );
      logMlAuthEvent({
        result: "failure",
        error_code: code,
        fatal_auth: fatalAuth,
        duration_ms: Date.now() - refreshStartedAt,
      });
      if (fatalAuth) {
        setAuthFatalCooldown(`refresh_failed:${code || "unknown"}`);
      }
      console.error(
        `[ML OAuth] Falha no refresh (${code || "sem_codigo"}): ${message}`,
      );
      return null;
    }

    const accessToken = payload?.access_token;
    const refreshToken = payload?.refresh_token;
    if (!accessToken || !refreshToken) {
      await markRefreshFailure(
        false,
        "invalid_refresh_payload",
        "Resposta de refresh sem access_token/refresh_token",
        "refresh_invalid_payload",
      );
      logMlAuthEvent({
        result: "failure",
        error_code: "invalid_refresh_payload",
        fatal_auth: false,
        duration_ms: Date.now() - refreshStartedAt,
      });
      return null;
    }

    const validation = await ensureAllowedMercadoLivreToken(
      accessToken,
      "refresh_payload_token",
    );
    if (validation === "account_not_allowed") {
      setAuthFatalCooldown("ml_account_not_allowed");
      return null;
    }
    if (validation === "refresh_required") {
      await markRefreshFailure(
        false,
        "token_owner_validation_failed",
        "Não foi possível validar a conta do novo token do Mercado Livre",
        "refresh_owner_validation",
      );
      return null;
    }

    await updateTokens(
      "mercadolivre",
      accessToken,
      refreshToken,
      payload?.expires_in || 10800,
    );
    clearAuthFatalCooldown();
    logMlAuthEvent({
      result: "success",
      error_code: null,
      fatal_auth: false,
      duration_ms: Date.now() - refreshStartedAt,
    });
    return accessToken;
  } catch (err: any) {
    await markRefreshFailure(
      false,
      "refresh_exception",
      err?.message || "Erro de rede ao atualizar token",
      "refresh_exception",
    );
    logMlAuthEvent({
      result: "failure",
      error_code: "refresh_exception",
      fatal_auth: false,
      duration_ms: Date.now() - refreshStartedAt,
    });
    console.error("[ML OAuth] Exceção no refresh:", err?.message || err);
    return null;
  } finally {
    await releaseRefreshLock("mercadolivre", owner);
  }
}

export async function getValidMLToken(force = false): Promise<string | null> {
  const integracao = await getIntegracao("mercadolivre");
  if (!integracao?.refresh_token) return null;

  if (
    !force &&
    integracao.access_token &&
    !isExpired(integracao.token_expires_at)
  ) {
    const validation = await ensureAllowedMercadoLivreToken(
      integracao.access_token,
      "get_valid_cached_token",
    );
    if (validation === "allowed") return integracao.access_token;
    if (validation === "account_not_allowed") return null;
    return refreshMLTokenFromDB(true);
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

export async function fetchMLResult<T>(
  path: string,
  options?: RequestInit,
): Promise<MLRequestResult<T>> {
  const method = options?.method || "GET";
  if (isBlockedMlFiscalInvoicePath(path)) {
    logMlFiscalEndpointBlocked(path, method);
    return {
      ok: false,
      status: 403,
      data: null,
      error: {
        status: 403,
        code: "ml_fiscal_endpoint_blocked",
        message:
          "Endpoint fiscal de invoice do Mercado Livre bloqueado por política.",
        category: "error",
        traceId: null,
      },
    };
  }

  const blockedUntilIso = getAuthFatalBlockedUntil();
  if (blockedUntilIso) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: {
        status: 401,
        code: "auth_cooldown",
        message: `Integração ML em cooldown até ${blockedUntilIso}`,
        category: "auth_fatal",
        traceId: null,
      },
    };
  }

  let token: string | null = null;
  try {
    token = await getValidMLToken();
  } catch (err: any) {
    if (isIntegracaoReadError(err)) {
      return {
        ok: false,
        status: 503,
        data: null,
        error: {
          status: 503,
          code: "supabase_read_failed",
          message: "Falha ao ler integração Mercado Livre no Supabase",
          category: "retryable",
          traceId: null,
        },
      };
    }
    throw err;
  }
  if (!token) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: {
        status: 401,
        code: "missing_token",
        message: "Token do Mercado Livre indisponível",
        category: "auth_fatal",
        traceId: null,
      },
    };
  }

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

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      await delay(Math.min(Math.max(retryAfter, 1), 5) * 1000);
      res = await doFetch(token);
    }

    if (res.status === 401) {
      const freshToken = await getValidMLToken(true);
      if (!freshToken) {
        setAuthFatalCooldown("refresh_failed_after_401");
        return {
          ok: false,
          status: 401,
          data: null,
          error: {
            status: 401,
            code: "refresh_failed",
            message: "Falha ao renovar token do Mercado Livre",
            category: "auth_fatal",
            traceId: null,
          },
        };
      }
      token = freshToken;
      res = await doFetch(token);
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      return {
        ok: true,
        status: res.status,
        data,
        error: null,
        headers: Object.fromEntries(res.headers.entries()),
      };
    }

    const body = await res.text().catch(() => "");
    const parsed = tryParseJson(body);
    const code = extractErrorCode(parsed);
    const traceId = extractTraceId(parsed);
    const category = classifyMLFailure(path, res.status, body);
    const baseMessage =
      parsed?.message ||
      parsed?.error_description ||
      parsed?.detail ||
      `Mercado Livre retornou HTTP ${res.status}`;
    const causeSummary = Array.isArray(parsed?.cause)
      ? parsed.cause
          .map((cause: any) =>
            [cause?.code, cause?.message].filter(Boolean).join(": "),
          )
          .filter(Boolean)
          .slice(0, 5)
          .join(" | ")
      : "";
    const message = causeSummary
      ? `${baseMessage} | ${causeSummary}`
      : baseMessage;

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
    if (isIntegracaoReadError(err)) {
      const error: MLRequestError = {
        status: 503,
        code: "supabase_read_failed",
        message: "Falha ao ler integração Mercado Livre no Supabase",
        category: "retryable",
        traceId: null,
      };
      console.warn(
        `[ML API] ${method} ${path} → exception (${error.category}): ${error.message}`,
      );
      return { ok: false, status: 503, data: null, error };
    }
    const message =
      err?.name === "AbortError" ? "timeout" : err?.message || "network_error";
    const error: MLRequestError = {
      status: 0,
      code: "network_error",
      message,
      category: "retryable",
      traceId: null,
    };
    console.warn(
      `[ML API] ${method} ${path} → exception (${error.category}): ${message}`,
    );
    return { ok: false, status: null, data: null, error };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchML<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const result = await fetchMLResult<T>(path, options);
  return result.ok ? result.data : null;
}

export async function consultarDisponibilidadeEtiquetaML(
  shipmentId: string,
): Promise<{
  checked: boolean;
  printable: boolean;
  status: string | null;
  substatus: string | null;
  error: string | null;
}> {
  const result = await fetchMLResult<any>(
    `/shipments/${encodeURIComponent(shipmentId)}`,
  );
  const status = result.ok
    ? String(result.data?.status || "").trim().toLowerCase() || null
    : null;
  const substatus = result.ok
    ? String(result.data?.substatus || "").trim().toLowerCase() || null
    : null;
  return {
    checked: result.ok,
    printable: result.ok && isMlShipmentLabelPrintable(result.data),
    status,
    substatus,
    error: result.error?.message || null,
  };
}

export async function fetchMLRaw(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; body: string } | null> {
  const method = options?.method || "GET";
  if (isBlockedMlFiscalInvoicePath(path)) {
    logMlFiscalEndpointBlocked(path, method);
    return {
      status: 403,
      body: JSON.stringify({
        code: "ml_fiscal_endpoint_blocked",
        message:
          "Endpoint fiscal de invoice do Mercado Livre bloqueado por política.",
      }),
    };
  }

  const blockedUntilIso = getAuthFatalBlockedUntil();
  if (blockedUntilIso) {
    return {
      status: 401,
      body: JSON.stringify({
        code: "auth_cooldown",
        message: `Integração ML em cooldown até ${blockedUntilIso}`,
      }),
    };
  }

  let token: string | null = null;
  try {
    token = await getValidMLToken();
  } catch (err: any) {
    if (isIntegracaoReadError(err)) {
      return {
        status: 503,
        body: JSON.stringify({
          code: "supabase_read_failed",
          message: "Falha ao ler integração Mercado Livre no Supabase",
        }),
      };
    }
    throw err;
  }
  if (!token) {
    return {
      status: 401,
      body: JSON.stringify({
        code: "missing_token",
        message: "Token do Mercado Livre indisponível",
      }),
    };
  }

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
      if (!freshToken) {
        setAuthFatalCooldown("refresh_failed_raw_after_401");
        return {
          status: 401,
          body: JSON.stringify({
            code: "refresh_failed",
            message: "Falha ao renovar token do Mercado Livre",
          }),
        };
      }
      token = freshToken;
      res = await doFetch(token);
    }

    const body = await res.text();
    if (!res.ok) {
      const parsed = tryParseJson(body);
      const error: MLRequestError = {
        status: res.status,
        code: extractErrorCode(parsed),
        message:
          parsed?.message || parsed?.error_description || `HTTP ${res.status}`,
        category: classifyMLFailure(path, res.status, body),
        traceId: extractTraceId(parsed),
      };
      logMLFailure(method, path, res.status, body, error);
    }
    return { status: res.status, body };
  } catch (err: any) {
    if (isIntegracaoReadError(err)) {
      return {
        status: 503,
        body: JSON.stringify({
          code: "supabase_read_failed",
          message: "Falha ao ler integração Mercado Livre no Supabase",
        }),
      };
    }
    console.warn(
      `[ML API] ${method} ${path} → exception (retryable): ${err?.message || err}`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMLConnectionStatus(): Promise<{
  conectado: boolean;
  precisaReconectar: boolean;
  erro?: string;
  reason?: "not_connected" | "account_not_allowed" | "auth_fatal" | "transient";
}> {
  const integracao = await getIntegracao("mercadolivre");
  if (
    !integracao?.access_token ||
    !integracao?.refresh_token ||
    !integracao.conectado
  ) {
    const accountBlocked =
      integracao?.last_refresh_error_code === "ml_account_not_allowed";
    return {
      conectado: false,
      precisaReconectar: true,
      erro: integracao?.last_refresh_error || "Mercado Livre desconectado",
      reason: accountBlocked ? "account_not_allowed" : "not_connected",
    };
  }

  const me = await fetchMLResult<{ id?: number }>("/users/me");
  if (me.ok && me.data?.id) {
    return { conectado: true, precisaReconectar: false };
  }

  if (me.error?.category === "auth_fatal") {
    return {
      conectado: false,
      precisaReconectar: true,
      erro: me.error.message,
      reason: "auth_fatal",
    };
  }

  return {
    conectado: true,
    precisaReconectar: false,
    erro: me.error?.message || "Falha transitória ao validar conexão ML",
    reason: "transient",
  };
}

export async function getMLAuthDiagnostics(): Promise<{
  state: MLAuthState;
  blocked_until: string | null;
  last_refresh_at: string | null;
  last_refresh_error: string | null;
  last_refresh_error_code: string | null;
  conectado: boolean;
  read_ok: boolean;
  read_error: string | null;
  has_access_token: boolean;
  has_refresh_token: boolean;
  token_expires_at: string | null;
  token_expired: boolean | null;
  token_expires_in_minutes: number | null;
}> {
  let integracao: IntegracaoRow | null = null;
  let readError: string | null = null;
  try {
    integracao = await getIntegracao("mercadolivre");
  } catch (err: any) {
    readError = err?.message || "Falha ao ler integração Mercado Livre";
  }
  const blockedUntil = getAuthFatalBlockedUntil();
  const lastErrorCode = integracao?.last_refresh_error_code || null;
  const isFatalErrorCode = FATAL_REFRESH_ERROR_CODES.includes(
    lastErrorCode || "",
  );
  const reauthRequired = !integracao?.conectado || isFatalErrorCode;
  const expiresAtMs = integracao?.token_expires_at
    ? new Date(integracao.token_expires_at).getTime()
    : null;
  const tokenExpired = expiresAtMs ? expiresAtMs - Date.now() < 300000 : null;

  let state: MLAuthState = "ok";
  if (readError) {
    state = "degraded";
  } else if (reauthRequired) {
    state = "reauth_required";
  } else if (lastErrorCode) {
    state = "degraded";
  }

  return {
    state,
    blocked_until: blockedUntil,
    last_refresh_at: integracao?.last_refresh_at || null,
    last_refresh_error: integracao?.last_refresh_error || null,
    last_refresh_error_code: lastErrorCode,
    conectado: Boolean(integracao?.conectado),
    read_ok: !readError,
    read_error: readError,
    has_access_token: Boolean(integracao?.access_token),
    has_refresh_token: Boolean(integracao?.refresh_token),
    token_expires_at: integracao?.token_expires_at || null,
    token_expired: tokenExpired,
    token_expires_in_minutes: expiresAtMs
      ? Math.round((expiresAtMs - Date.now()) / 60000)
      : null,
  };
}

export async function emitirNotaFiscalML(orderId: string): Promise<{
  ok: boolean;
  status?: string;
  invoiceId?: string | number;
  error?: string;
  retryable?: boolean;
}> {
  void orderId;
  return {
    ok: false,
    error: "Emissão fiscal via ML desativada por política.",
    retryable: false,
  };
}

export async function anexarDocumentosFiscaisML(input: {
  mlPackId?: string | null;
  mlOrderId?: string | null;
  nfeXml?: string | null;
  danfePdf?: Buffer | null;
}): Promise<{
  ok: boolean;
  attachedXml: boolean;
  attachedDanfe: boolean;
  statusCode?: number | null;
  endpoint?: string | null;
  error?: string;
  errorCode?: string | null;
}> {
  void input;
  const blockedReason = "pack_fiscal_documents_disabled_policy";
  const payload = {
    event: "ml_fiscal_runtime_call_denied",
    timestamp_utc: new Date().toISOString(),
    endpoint: "/packs/{pack_id}/fiscal_documents",
    method: "POST",
    blocked_reason: blockedReason,
  };
  console.error(JSON.stringify(payload));
  void (async () => {
    try {
      await createServiceClient().from("nf_auditoria_eventos").insert({
        evento: "ml_fiscal_runtime_call_denied",
        status_resultante: "denied",
        resposta_ml: payload,
      });
    } catch {}
  })();
  return {
    ok: false,
    attachedXml: false,
    attachedDanfe: false,
    statusCode: 403,
    endpoint: "/packs/{pack_id}/fiscal_documents",
    error:
      "Upload fiscal via packs/fiscal_documents desativado por política. Use shipment invoice_data.",
    errorCode: "ml_fiscal_pack_upload_disabled",
  };
}

export async function consultarInvoiceDataPorShipmentML(
  shipmentId: string,
  siteId: string = "MLB",
): Promise<{
  ok: boolean;
  data?: any;
  statusCode?: number | null;
  error?: string;
  temporary?: boolean;
}> {
  const path = `/shipments/${encodeURIComponent(String(shipmentId))}/invoice_data?siteId=${encodeURIComponent(siteId)}`;
  const res = await fetchMLResult<any>(path);
  if (!res.ok || !res.data) {
    return {
      ok: false,
      statusCode: res.status,
      error: res.error?.message || "Falha ao consultar invoice_data no ML",
      temporary:
        res.status === 404 ||
        res.error?.category === "retryable" ||
        res.error?.category === "expected_operational",
    };
  }
  return { ok: true, data: res.data, statusCode: res.status };
}

export async function upsertInvoiceDataMLByShipment(input: {
  shipmentId: string;
  fiscalKey: string;
  nfeXml: string;
  siteId?: string;
}): Promise<{
  ok: boolean;
  statusCode?: number | null;
  method?: "PUT" | "POST";
  lastMethodTried?: "PUT" | "POST";
  endpoint?: string;
  data?: any;
  error?: string;
  reason?: string;
  errorCode?: string | null;
  contentMode?: "xml";
  attempts?: Array<{
    method: "PUT" | "POST";
    endpoint: string;
    contentType: string;
    statusCode: number | null;
    code?: string | null;
    message?: string | null;
  }>;
}> {
  const shipmentId = String(input.shipmentId || "").trim();
  const fiscalKey = String(input.fiscalKey || "").trim();
  const siteId = String(input.siteId || "MLB").trim() || "MLB";
  const nfeXml = String(input.nfeXml || "").trim();

  if (!shipmentId || !fiscalKey) {
    return {
      ok: false,
      statusCode: 400,
      error: "Dados insuficientes para subir invoice_data no ML",
      reason: "invalid_input",
    };
  }
  if (!nfeXml) {
    return {
      ok: false,
      statusCode: 400,
      error: "NF XML ausente para upload fiscal no ML",
      reason: "nf_xml_ausente_para_upload_ml",
    };
  }

  const invoiceDataEndpoint = `/shipments/${encodeURIComponent(shipmentId)}/invoice_data?siteId=${encodeURIComponent(siteId)}`;
  const createEndpoint = `/shipments/${encodeURIComponent(shipmentId)}/invoice_data/?siteId=${encodeURIComponent(siteId)}`;
  let lastError = "Falha ao subir invoice_data no ML";
  let lastStatus: number | null = null;
  let lastCode: string | null = null;
  const attempts: Array<{
    method: "PUT" | "POST";
    endpoint: string;
    contentType: string;
    statusCode: number | null;
    code?: string | null;
    message?: string | null;
  }> = [];

  const tryUpload = async (
    method: "PUT" | "POST",
    endpoint: string,
  ) => {
    const result = await fetchMLResult<any>(endpoint, {
      method,
      headers: { "Content-Type": "application/xml" },
      body: nfeXml,
    });
    if (result.ok) {
      return {
        ok: true as const,
        result,
        idempotencyConflict: false,
        authFatal: false,
      };
    }

    lastStatus = result.status;
    const message = result.error?.message || `HTTP ${result.status ?? "n/a"}`;
    lastError = message;
    lastCode = String(result.error?.code || "").trim() || null;
    attempts.push({
      method,
      endpoint,
      contentType: "application/xml",
      statusCode: result.status ?? null,
      code: lastCode,
      message,
    });

    const code = String(result.error?.code || "").toLowerCase();
    const lowerMessage = message.toLowerCase();
    return {
      ok: false as const,
      result,
      idempotencyConflict:
        code.includes("duplicated_fiscal_key") ||
        lowerMessage.includes("duplicated_fiscal_key") ||
        code.includes("shipment_invoice_already_saved") ||
        lowerMessage.includes("already saved"),
      authFatal:
        result.status === 401 || result.error?.category === "auth_fatal",
    };
  };

  const verifyFinalInvoice = async (params: {
    method: "PUT" | "POST";
    endpoint: string;
    successStatus: number | null;
    successReason: "created_xml" | "updated_xml" | "already_linked";
  }) => {
    const verified = await consultarInvoiceDataPorShipmentML(
      shipmentId,
      siteId,
    );
    const verifiedKey = verified.ok
      ? String(verified.data?.fiscal_key || "").trim()
      : "";

    if (verified.ok && verifiedKey === fiscalKey) {
      return {
        ok: true as const,
        statusCode: params.successStatus || verified.statusCode || 200,
        method: params.method,
        lastMethodTried: params.method,
        endpoint: params.endpoint,
        data: verified.data,
        reason: params.successReason,
        contentMode: "xml" as const,
        attempts,
      };
    }

    return {
      ok: false as const,
      statusCode: verified.statusCode ?? params.successStatus,
      method: params.method,
      lastMethodTried: params.method,
      endpoint: params.endpoint,
      data: verified.data,
      error:
        verified.error ||
        `Chave fiscal final no ML (${verifiedKey || "ausente"}) difere da chave enviada`,
      reason: "invoice_verification_failed",
      errorCode: null,
      contentMode: "xml" as const,
      attempts,
    };
  };

  const currentInvoiceData = await consultarInvoiceDataPorShipmentML(
    shipmentId,
    siteId,
  );

  if (currentInvoiceData.ok && currentInvoiceData.data) {
    const currentKey = String(currentInvoiceData.data.fiscal_key || "").trim();
    if (currentKey === fiscalKey) {
      return {
        ok: true,
        statusCode: currentInvoiceData.statusCode || 200,
        endpoint: invoiceDataEndpoint,
        data: currentInvoiceData.data,
        reason: "already_linked",
        contentMode: "xml",
        attempts,
      };
    }

    const invoiceId = String(currentInvoiceData.data.id || "").trim();
    if (!invoiceId) {
      return {
        ok: false,
        statusCode: currentInvoiceData.statusCode || 200,
        endpoint: invoiceDataEndpoint,
        data: currentInvoiceData.data,
        error: "Invoice existente no ML sem identificador para atualização",
        reason: "invoice_id_missing",
        contentMode: "xml",
        attempts,
      };
    }

    const updateEndpoint = `/shipment_invoice/${encodeURIComponent(invoiceId)}/?siteId=${encodeURIComponent(siteId)}`;
    const update = await tryUpload("PUT", updateEndpoint);
    if (!update.ok && !update.idempotencyConflict) {
      return {
        ok: false,
        statusCode: lastStatus,
        method: "PUT",
        lastMethodTried: "PUT",
        endpoint: updateEndpoint,
        error: lastError,
        reason: update.authFatal
          ? "auth_fatal"
          : "ml_invoice_data_upload_failed",
        errorCode: lastCode,
        contentMode: "xml",
        attempts,
      };
    }

    return verifyFinalInvoice({
      method: "PUT",
      endpoint: updateEndpoint,
      successStatus: update.ok ? update.result.status : lastStatus,
      successReason: "updated_xml",
    });
  }

  if (currentInvoiceData.statusCode !== 404) {
    return {
      ok: false,
      statusCode: currentInvoiceData.statusCode,
      endpoint: invoiceDataEndpoint,
      error:
        currentInvoiceData.error ||
        "Falha ao consultar invoice_data antes do upload",
      reason: "invoice_lookup_failed",
      contentMode: "xml",
      attempts,
    };
  }

  const created = await tryUpload("POST", createEndpoint);
  if (!created.ok && !created.idempotencyConflict) {
    return {
      ok: false,
      statusCode: lastStatus,
      method: "POST",
      lastMethodTried: "POST",
      endpoint: createEndpoint,
      error: lastError,
      reason: created.authFatal
        ? "auth_fatal"
        : "ml_invoice_data_upload_failed",
      errorCode: lastCode,
      contentMode: "xml",
      attempts,
    };
  }

  return verifyFinalInvoice({
    method: "POST",
    endpoint: createEndpoint,
    successStatus: created.ok ? created.result.status : lastStatus,
    successReason: created.ok ? "created_xml" : "already_linked",
  });
}

export type MlLabelResponseType = "pdf" | "zpl2";

function extractFirstTextFileFromZip(buffer: Buffer): Buffer | null {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (
    let i = buffer.length - 22;
    i >= 0 && i > buffer.length - 66000;
    i -= 1
  ) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const entries = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let entry = 0; entry < entries; entry += 1) {
    if (
      centralDirectoryOffset + 46 > buffer.length ||
      buffer.readUInt32LE(centralDirectoryOffset) !== 0x02014b50
    ) {
      return null;
    }

    const compressionMethod = buffer.readUInt16LE(centralDirectoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirectoryOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirectoryOffset + 42);
    const fileName = buffer.toString(
      "utf8",
      centralDirectoryOffset + 46,
      centralDirectoryOffset + 46 + fileNameLength,
    );

    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
    if (fileName.endsWith("/")) continue;
    if (!/\.(txt|zpl)$/i.test(fileName)) continue;
    if (
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    )
      return null;

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (compressionMethod === 0) return compressed;
    if (compressionMethod === 8) return inflateRawSync(compressed);
    return null;
  }

  return null;
}

export async function baixarEtiquetaML(
  shipmentId: string,
  options?: { responseType?: MlLabelResponseType },
): Promise<{
  pdf: Buffer | null;
  file: Buffer | null;
  contentType: string;
  extension: "pdf" | "zpl";
  responseType: MlLabelResponseType;
  error?: string;
  retryable?: boolean;
  reason?:
    | "buffered"
    | "not_ready"
    | "auth"
    | "http_error"
    | "invalid_pdf"
    | "invalid_zpl"
    | "unknown";
  statusCode?: number;
}> {
  const responseType: MlLabelResponseType =
    options?.responseType === "zpl2" ? "zpl2" : "pdf";
  const contentType =
    responseType === "zpl2" ? "text/plain" : "application/pdf";
  const extension: "pdf" | "zpl" = responseType === "zpl2" ? "zpl" : "pdf";
  const emptyResult = (extra: {
    error?: string;
    retryable?: boolean;
    reason?:
      | "buffered"
      | "not_ready"
      | "auth"
      | "http_error"
      | "invalid_pdf"
      | "invalid_zpl"
      | "unknown";
    statusCode?: number;
  }) => ({
    pdf: null,
    file: null,
    contentType,
    extension,
    responseType,
    ...extra,
  });

  try {
    let token = await getValidMLToken();
    if (!token) {
      return emptyResult({
        error: "Token do ML não disponível",
        reason: "auth",
        retryable: true,
      });
    }

    console.log(
      `[baixarEtiquetaML] Baixando etiqueta ${responseType} para shipment ${shipmentId}`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const doFetch = async (tok: string) => {
      const url = new URL("https://api.mercadolibre.com/shipment_labels");
      url.searchParams.set("shipment_ids", shipmentId);
      url.searchParams.set("response_type", responseType);
      return fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tok}` },
        signal: controller.signal,
      });
    };

    try {
      let res = await doFetch(token);

      if (res.status === 401) {
        console.warn(
          JSON.stringify({
            event: "ml_auth_retry",
            attempt: "retry_after_forced_refresh",
            path: "/shipment_labels",
            method: "GET",
            status: 401,
            shipment_id: shipmentId,
            response_type: responseType,
            timestamp_utc: new Date().toISOString(),
          }),
        );
        const freshToken = await getValidMLToken(true);
        if (!freshToken) {
          setAuthFatalCooldown("refresh_failed_label_after_401");
          return emptyResult({
            error:
              "Falha ao renovar token do Mercado Livre para baixar etiqueta",
            reason: "auth",
            retryable: true,
            statusCode: 401,
          });
        }
        token = freshToken;
        res = await doFetch(token);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          `[baixarEtiquetaML] ML retornou HTTP ${res.status}: ${text.substring(0, 300)}`,
        );
        const failure = classifyMlLabelHttpFailure(res.status, text);
        return emptyResult({
          error: failure.invalidCaller
            ? "Etiqueta ML não é imprimível por esta conta/token do Mercado Livre (INVALID_SHIPMENT_CALLER)."
            : text
              ? text.substring(0, 300)
              : `ML retornou HTTP ${res.status}`,
          reason: failure.reason,
          retryable: failure.retryable,
          statusCode: res.status,
        });
      }

      const arrayBuffer = await res.arrayBuffer();
      const responseBuffer = Buffer.from(arrayBuffer);
      const isZipResponse =
        responseBuffer.length >= 4 &&
        responseBuffer.readUInt32LE(0) === 0x04034b50;
      const buffer =
        responseType === "zpl2" && isZipResponse
          ? extractFirstTextFileFromZip(responseBuffer) || responseBuffer
          : responseBuffer;

      if (
        responseType === "pdf" &&
        (buffer.length < 4 || buffer.toString("ascii", 0, 4) !== "%PDF")
      ) {
        console.error(
          `[baixarEtiquetaML] Resposta não é um PDF válido (tamanho: ${buffer.length})`,
        );
        return emptyResult({
          error: "Resposta do ML não é um PDF válido",
          reason: "invalid_pdf",
          retryable: true,
          statusCode: res.status,
        });
      }

      if (
        responseType === "zpl2" &&
        (buffer.length < 4 ||
          !buffer
            .toString("utf8", 0, Math.min(buffer.length, 2048))
            .includes("^XA"))
      ) {
        console.error(
          `[baixarEtiquetaML] Resposta não é um ZPL válido (tamanho: ${buffer.length}; resposta original: ${responseBuffer.length})`,
        );
        return emptyResult({
          error: "Resposta do ML não é um ZPL válido",
          reason: "invalid_zpl",
          retryable: true,
          statusCode: res.status,
        });
      }

      console.log(
        `[baixarEtiquetaML] Etiqueta ${responseType} baixada com sucesso: ${buffer.length} bytes`,
      );
      return {
        pdf: responseType === "pdf" ? buffer : null,
        file: buffer,
        contentType,
        extension,
        responseType,
        statusCode: res.status,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    console.error("[baixarEtiquetaML] Erro:", err);
    const msg = String(err?.message || "Erro ao baixar etiqueta");
    const lowered = msg.toLowerCase();
    const buffered = lowered.includes("buffered");
    return emptyResult({
      error: msg,
      reason: buffered ? "buffered" : "unknown",
      retryable: true,
    });
  }
}
