// Pure configuration resolution: callers must keep the returned credentials server-side.
export type IntegrationEnvironment = Record<string, string | undefined>;
export type IntegrationRecord = Record<string, unknown>;
export type CredentialOrigin = "erp" | "runtime" | "default" | "missing";
export type EditableIntegration = "dslite" | "brasilnfe" | "mercadopago";
export const FATAL_REFRESH_ERROR_CODES = ["invalid_grant", "invalid_client", "unauthorized_client", "unauthorized_application"];

export function configured(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveIntegrationConfiguration(tipo: string, row: IntegrationRecord, env: IntegrationEnvironment) {
  const choose = (database: unknown, runtime: string | undefined, fallback = "", runtimeFirst = false) => {
    const candidates: Array<[unknown, CredentialOrigin]> = runtimeFirst
      ? [[runtime, "runtime"], [database, "erp"]]
      : [[database, "erp"], [runtime, "runtime"]];
    const selected = candidates.find(([value]) => configured(value));
    return { value: selected ? String(selected[0]).trim() : fallback, origin: selected?.[1] || (fallback ? "default" : "missing") as CredentialOrigin };
  };
  return {
    token: choose(row.access_token, tipo === "brasilnfe" ? env.BRASILNFE_TOKEN : tipo === "mercadopago" ? env.MERCADOPAGO_ACCESS_TOKEN : undefined, "", tipo === "mercadopago"),
    userToken: choose(row.refresh_token, tipo === "brasilnfe" ? env.BRASILNFE_USER_TOKEN : undefined),
    url: choose(row.url, tipo === "brasilnfe" ? env.BRASILNFE_BASE_URL : undefined, tipo === "brasilnfe" ? "https://api.brasilnfe.com.br/services/" : ""),
  };
}

export function integrationUrlAllowed(tipo: string, value: string, homologationOnly = false): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    if (tipo === "dslite") return ["", "/"].includes(url.pathname)
      && (url.hostname === "api.master.dev.dslite.com.br" || (!homologationOnly && url.hostname === "api.dslite.com.br"));
    return tipo === "brasilnfe" && url.hostname === "api.brasilnfe.com.br" && ["/services", "/services/"].includes(url.pathname);
  } catch { return false; }
}

export type IntegrationState = "missing" | "incomplete" | "configured" | "validated" | "reconnect" | "error";
export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  missing: "Não configurado", incomplete: "Configuração incompleta", configured: "Configurado — não verificado",
  validated: "Conexão validada", reconnect: "Requer reconexão", error: "Falha na consulta",
};

export function integrationState(tipo: string, row: IntegrationRecord, env: IntegrationEnvironment, now = Date.now()): IntegrationState {
  if (tipo === "mercadolivre") {
    if (![row.client_id, row.client_secret, row.access_token, row.refresh_token].some(configured)) return "missing";
    if (!configured(row.access_token) || !configured(row.refresh_token) || !row.conectado) return "reconnect";
    if (row.last_refresh_error_code) return FATAL_REFRESH_ERROR_CODES.includes(String(row.last_refresh_error_code)) ? "reconnect" : "error";
    if (!row.token_expires_at || Date.parse(String(row.token_expires_at)) <= now || !Number.isFinite(Date.parse(String(row.token_expires_at)))) return "configured";
    return "validated";
  }
  const config = resolveIntegrationConfiguration(tipo, row, env);
  if (!config.token.value) return configured(row.url) || config.userToken.value ? "incomplete" : "missing";
  if (tipo !== "mercadopago" && !integrationUrlAllowed(tipo, config.url.value)) return "incomplete";
  // Legacy connected flags and configuration timestamps are not evidence of a connection test.
  return "configured";
}

export type IntegrationSummary = {
  tipo: string; name: string; group: string; purpose: string; state: IntegrationState;
  action: string; href?: string; editable: boolean; testable: boolean; restriction: string | null;
};

export function integrationSummaries(rows: IntegrationRecord[], env: IntegrationEnvironment): IntegrationSummary[] {
  const definitions = [
    ["mercadolivre", "Mercado Livre", "Operação", "Conta, anúncios e vendas", "Abrir Mercado Livre", "mercado-livre"],
    ["dslite", "DSLite", "Operação", "Catálogo, fornecedores e pedidos de compra", "Configurar", ""],
    ["brasilnfe", "Brasil NFe", "Fiscal", "Emissão e documentos fiscais", "Configurar", ""],
    ["mercadopago", "Mercado Pago", "Financeiro", "Relatórios financeiros; sem conta-saldo Hayamax", "Configurar", ""],
  ];
  const result: IntegrationSummary[] = definitions.map(([tipo, name, group, purpose, action, tab]) => {
    const row = rows.find((item) => item.tipo === tipo) || {};
    const config = resolveIntegrationConfiguration(tipo, row, env);
    const state = integrationState(tipo, row, env);
    const restriction = tipo === "dslite" && config.url.value && !integrationUrlAllowed(tipo, config.url.value, true)
      ? "Teste bloqueado: configure a URL oficial de homologação da DSLite (sem /v1). Nenhuma URL foi alterada automaticamente."
      : tipo === "brasilnfe" && !integrationUrlAllowed(tipo, config.url.value)
        ? "URL fora dos destinos oficiais permitidos."
        : tipo === "mercadopago" && config.token.origin === "runtime"
          ? "A credencial do servidor prevalece. Sua alteração é feita no runtime; a edição pelo ERP está bloqueada."
          : null;
    return { tipo, name, group, purpose, state, action, href: tab ? `/configuracoes?tab=${tab}` : undefined,
      editable: !tab && !(tipo === "mercadopago" && config.token.origin === "runtime"),
      testable: ["dslite", "brasilnfe"].includes(tipo) && state === "configured" && !restriction, restriction };
  });
  const runtime: Array<[string, string, string, string, boolean[], string | undefined]> = [
    ["waha", "WhatsApp / WAHA", "Comunicação", "Entrega de mensagens e sessão WhatsApp", [configured(env.WAHA_BASE_URL || env.WAHA_URL), configured(env.WAHA_API_KEY)], "notificacoes"],
    ["smtp", "E-mail / SMTP", "Comunicação", "Envio de mensagens e documentos", [configured(env.SMTP_HOST), configured(env.SMTP_USER), configured(env.SMTP_PASS)], "notificacoes"],
    ["push", "Push", "Comunicação", "Notificações em navegadores e dispositivos", [configured(env.VAPID_PUBLIC_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY), configured(env.VAPID_PRIVATE_KEY), configured(env.VAPID_SUBJECT)], "notificacoes"],
    ["github", "GitHub operacional", "Serviços técnicos", "Acompanhamento de ocorrências operacionais", [configured(env.GITHUB_OPS_TOKEN || env.GITHUB_TOKEN), configured(env.GITHUB_OWNER || env.GITHUB_REPOSITORY?.split("/")[0]), configured(env.GITHUB_REPO || env.GITHUB_REPOSITORY?.split("/")[1])], undefined],
    ["openrouter", "OpenRouter", "Serviços técnicos", "Assistência ao preenchimento de anúncios", [configured(env.OPENROUTER_API_KEY)], undefined],
    ["firecrawl", "Firecrawl", "Serviços técnicos", "Pesquisa de informações de produtos", [configured(env.FIRECRAWL_API_KEY)], undefined],
  ];
  for (const [tipo, name, group, purpose, fields, tab] of runtime) result.push({
    tipo, name, group, purpose, state: fields.every(Boolean) ? "configured" : fields.some(Boolean) ? "incomplete" : "missing",
    action: tab ? "Abrir Notificações" : "Ver estado", href: tab ? `/configuracoes?tab=${tab}` : undefined,
    editable: false, testable: false, restriction: "Administrada pelo servidor. Presença de configuração não comprova disponibilidade. Nenhuma chamada externa foi executada nesta leitura.",
  });
  return result;
}

export type IntegrationTestResult = { ok: boolean; message: string; checkedAt: string; code: string };

export async function probeIntegration(
  tipo: "dslite" | "brasilnfe", row: IntegrationRecord, env: IntegrationEnvironment,
  fetcher: typeof fetch = fetch, now = new Date(),
): Promise<IntegrationTestResult> {
  const result = (ok: boolean, code: string, message: string) => ({ ok, code, message, checkedAt: now.toISOString() });
  const config = resolveIntegrationConfiguration(tipo, row, env);
  if (!config.token.value) return result(false, "missing", "Configure a credencial antes de testar.");
  if (!integrationUrlAllowed(tipo, config.url.value, true)) return result(false, "blocked", "Destino não permitido para teste de homologação.");
  const base = config.url.value.replace(/\/+$/, "");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try {
    const response = await fetcher(tipo === "dslite" ? `${base}/v1/CrossDocking/Categoria?limit=1&only_root=true` : `${base}/fiscal/ObterNotasFiscais`, {
      method: tipo === "dslite" ? "GET" : "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Accept: "application/json", Token: config.token.value },
      ...(tipo === "brasilnfe" ? { body: JSON.stringify({ TipoDocumentoFiscal: 1, TipoAmbiente: 2, DtInicio: `${day}T00:00:00`, DtFim: `${day}T23:59:59`, IdentificadorInterno: "BENTEVI_DEV_CONNECTION_CHECK" }) } : {}),
    });
    if (!response.ok) return result(false, "http_error", `Consulta recusada pelo provedor (HTTP ${response.status}).`);
    const data = await response.json().catch(() => null);
    if (tipo === "dslite") {
      if (!data || !Array.isArray(data.categorias) || data.error) return result(false, "invalid_payload", "O provedor não retornou uma lista de categorias válida.");
    } else if (!data || !Array.isArray(data.Notas) || data.Error || data.error || (Array.isArray(data.erros) && data.erros.length) || (data.status !== undefined && data.status !== 0)) {
      return result(false, "invalid_payload", "O provedor não confirmou a consulta fiscal de homologação.");
    }
    return result(true, "ok", "Conexão validada por consulta somente de leitura em homologação.");
  } catch (error) {
    const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return result(false, timeout ? "timeout" : "network_error", timeout ? "Tempo limite de consulta atingido." : "Não foi possível consultar o provedor.");
  }
}
