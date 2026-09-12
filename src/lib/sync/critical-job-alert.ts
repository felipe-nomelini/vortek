export const CRITICAL_JOB_TIMEOUT_GRACE_MS = 15 * 60 * 1000;

type CriticalJobRootLog = {
  event_type?: string | null;
  message?: string | null;
  error_code?: string | null;
  error_category?: string | null;
  http_status?: string | number | null;
  provider_error?: string | null;
};

type CriticalJobLike = {
  tipo?: string | null;
  status?: string | null;
  dedupe_key?: string | null;
  log?: unknown;
};

export type CriticalJobIncident = {
  actionable: boolean;
  scope: string;
  errorClass: string;
  key: string;
  title: string;
  summary: string;
  action: string;
};

const NON_ACTIONABLE_PRICING_CODES = new Set([
  "listing_identity_pending",
  "contexto_alterado",
  "produto_local_alterado",
  "anuncio_remoto_alterado",
  "grupo_alterado",
  "concorrencia_alterada",
]);

function parseLog(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeIncidentPart(value: unknown, fallback: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || fallback;
}

function findScopeValue(value: unknown, depth = 0): { kind: string; value: string } | null {
  if (!value || typeof value !== "object" || depth > 5) return null;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findScopeValue(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys: Array<[string, string]> = [
    ["pedidoId", "pedido"], ["pedido_id", "pedido"],
    ["mlOrderId", "venda"], ["ml_order_id", "venda"], ["orderId", "venda"],
    ["productId", "produto"], ["produto_id", "produto"],
    ["ml_item_id", "anuncio"], ["itemId", "anuncio"],
  ];
  for (const [key, kind] of keys) {
    const candidate = String(record[key] ?? "").trim();
    if (candidate) return { kind, value: candidate };
  }
  for (const nested of Object.values(record)) {
    const found = findScopeValue(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

export function getCriticalJobScope(job: CriticalJobLike) {
  const dedupeKey = String(job.dedupe_key || "").trim();
  if (dedupeKey) return normalizeIncidentPart(dedupeKey, "global");
  const found = findScopeValue(parseLog(job.log));
  return found
    ? `${found.kind}:${normalizeIncidentPart(found.value, "desconhecido")}`
    : "global";
}

function classifyError(rootLog?: CriticalJobRootLog | null, status?: string | null) {
  const code = String(rootLog?.error_code || rootLog?.error_category || "").trim();
  const haystack = [
    code,
    rootLog?.provider_error,
    rootLog?.message,
    rootLog?.http_status,
    status,
  ].join(" ").toLowerCase();
  if (String(status || "") === "failed_auth" || /\b(?:401|403)\b|unauthor|auth_fatal|invalid token/.test(haystack)) return "authentication";
  if (/rejei[cç][aã]o\s*778|\bncm\b.*(?:inv[aá]lid|vig[eê]ncia)/.test(haystack)) return "invalid_ncm_778";
  if (/timeout|tempo limite|operation was aborted|aborterror/.test(haystack)) return "timeout";
  if (/\b429\b|rate.?limit|muitas solicita/.test(haystack)) return "rate_limit";
  if (/\b5\d\d\b|indispon[ií]vel|network|fetch failed|dns/.test(haystack)) return "provider_unavailable";
  return normalizeIncidentPart(code, "operation_failed");
}

export function classifyCriticalJobIncident(
  job: CriticalJobLike,
  rootLog?: CriticalJobRootLog | null,
): CriticalJobIncident {
  const type = normalizeIncidentPart(job.tipo, "unknown_job");
  const scope = getCriticalJobScope(job);
  const rawCode = String(rootLog?.error_code || rootLog?.error_category || "").trim().toLowerCase();
  const rawMarker = [rawCode, rootLog?.message]
    .join(" ")
    .trim()
    .toLowerCase();
  const actionable = !(
    type === "pricing_product_reanalysis" &&
    Array.from(NON_ACTIONABLE_PRICING_CODES).some((code) => rawMarker.includes(code))
  );
  const errorClass = classifyError(rootLog, job.status);
  const key = `${type}:${scope}:${errorClass}`;

  if (errorClass === "invalid_ncm_778") return {
    actionable,
    scope,
    errorClass,
    key,
    title: "Pedido de compra bloqueado pelo cadastro fiscal",
    summary: "A nota fiscal foi recusada porque o NCM do produto precisa ser corrigido.",
    action: "Revise o NCM do produto e retome o mesmo pedido.",
  };
  if (type === "sync_mercadopago_account_money" && errorClass === "authentication") return {
    actionable,
    scope,
    errorClass,
    key,
    title: "Consulta financeira do Mercado Pago recusada",
    summary: "A conta conectada não autorizou a leitura dos relatórios financeiros.",
    action: "Confira a conexão do Mercado Livre e teste novamente.",
  };
  if (type === "pricing_product_reanalysis") return {
    actionable,
    scope,
    errorClass,
    key,
    title: "Análise de preço indisponível",
    summary: "Não foi possível atualizar a análise deste produto.",
    action: "Atualize a análise do produto depois que a integração estiver disponível.",
  };
  return {
    actionable,
    scope,
    errorClass,
    key,
    title: "Rotina precisa de atenção",
    summary: "Uma rotina importante não foi concluída.",
    action: "Abra o painel e verifique o registro afetado.",
  };
}

type CriticalJobAlertDecisionInput = {
  status?: string | null;
  occurrences: number;
  finishedAt?: string | null;
  recoveredAt?: string | null;
  rootLog?: CriticalJobRootLog | null;
  nowMs?: number;
  timeoutGraceMs?: number;
};

export type CriticalJobAlertDecision =
  | "alert"
  | "skip_transient"
  | "skip_recovered"
  | "defer_timeout";

function timestampMs(value?: string | null): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isJobTimeoutAbort(rootLog?: CriticalJobRootLog | null): boolean {
  const eventType = String(rootLog?.event_type || "").toLowerCase();
  const message = String(rootLog?.message || "").toLowerCase();
  return (
    eventType === "job_start_failed" &&
    (message.includes("operation was aborted") ||
      message.includes("aborterror") ||
      message.includes("tempo limite"))
  );
}

/**
 * Evita alertar falhas já recuperadas e dá tempo para jobs abortados pelo
 * controlador HTTP terminarem ou serem retomados antes de classificá-los
 * como críticos.
 */
export function decideCriticalJobAlert(
  input: CriticalJobAlertDecisionInput,
): CriticalJobAlertDecision {
  const finishedAtMs = timestampMs(input.finishedAt);
  const recoveredAtMs = timestampMs(input.recoveredAt);

  if (
    finishedAtMs !== null &&
    recoveredAtMs !== null &&
    recoveredAtMs > finishedAtMs
  ) {
    return "skip_recovered";
  }

  const authFailure = String(input.status || "") === "failed_auth";
  if (authFailure) return "alert";
  if (input.occurrences < 2) return "skip_transient";

  if (isJobTimeoutAbort(input.rootLog) && finishedAtMs !== null) {
    const nowMs = input.nowMs ?? Date.now();
    const graceMs = input.timeoutGraceMs ?? CRITICAL_JOB_TIMEOUT_GRACE_MS;
    if (nowMs - finishedAtMs < graceMs) return "defer_timeout";
  }

  return "alert";
}
