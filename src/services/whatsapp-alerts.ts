import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import {
  consultarDisponibilidadeEtiquetaML,
  getMLAuthDiagnostics,
} from "@/services/integration";
import {
  getWahaDiagnostics,
  normalizeWhatsappChatId,
  sendWahaText,
} from "@/services/waha";
import { formatCurrency } from "@/lib/format";
import { formatSaoPauloDateTime } from "@/lib/timezone";
import {
  formatMlReleaseWindow,
  getMlReleaseComparableDate,
} from "@/lib/ml/release-window-display";
import { acquireDomainLock, releaseDomainLock } from "@/lib/sync/domain-lock";
import {
  createOrUpdateOpsIssue,
  resolveOpenIntegrationOpsIssues,
  resolveRecoveredScheduledTaskOpsIssues,
} from "@/services/github-ops";
import { isMlOrderPaid } from "@/lib/ml/order-sale-alert";
import { decideCriticalJobAlert } from "@/lib/sync/critical-job-alert";
import {
  notificationAppLink,
  selectWhatsappRecipientsForEnvironment,
} from "@/lib/configuracoes/notifications";
import {
  buildInternalWhatsappMessage,
  type MessageField,
  type MessageLink,
  type NotificationSeverity,
} from "@/lib/notifications/templates";
import {
  SYNC_TASKS,
  evaluateScheduledTaskHealth,
  getIntervalMinutesForTask,
  getSaoPauloHour,
} from "@/lib/sync/registry";

type AlertType =
  | "new_sale"
  | "new_question"
  | "critical_error"
  | "integration_status"
  | "weekly_sales_report"
  | "monthly_sales_report"
  | "claim_opened"
  | "ml_label_released";

type AlertInput = {
  type: AlertType;
  severity?: NotificationSeverity;
  title: string;
  summary: string;
  fields?: MessageField[];
  action?: string | null;
  link?: MessageLink | null;
  reference?: string | null;
  issueMessage?: string;
  dedupeKey: string;
  payload?: Record<string, any>;
  dedupeTtlHours?: number;
};

const LABEL_RELEASE_SCAN_LOOKBACK_DAYS = 10;
const NON_ACTIONABLE_LABEL_STATUSES = new Set([
  "cancelado",
  "cancelled",
  "entregue",
  "devolvido",
  "recusado",
]);

async function getAlertPhones(type: AlertType): Promise<string[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("whatsapp_alert_settings")
    .select("phone,event_types")
    .eq("enabled", true);
  if (error) throw new Error(`Falha ao consultar destinatários WhatsApp: ${error.message}`);
  const configured = (data || [])
    .filter((recipient) => recipient.event_types.includes(type))
    .map((recipient) => recipient.phone);
  return selectWhatsappRecipientsForEnvironment(
    configured,
    process.env.WAHA_TEST_RECIPIENT_PHONE,
  );
}

function nowIso() {
  return new Date().toISOString();
}

function appLink(label: string, path: string): MessageLink | null {
  const url = notificationAppLink(path);
  return url ? { label, url } : null;
}

function alertLockDomain(input: AlertInput) {
  const hash = createHash("sha256")
    .update(`${input.type}:${input.dedupeKey}`)
    .digest("hex")
    .slice(0, 32);
  return `whatsapp_alert:${hash}`;
}

function saoPauloDateLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isActionableLabelRelease(order: {
  ml_shipment_id?: string | null;
  situacao?: string | null;
  status?: string | null;
  ml_fiscal_release_at?: string | null;
}): boolean {
  if (!order.ml_shipment_id) return false;
  const status = normalizeStatus(order.situacao || order.status);
  if (status && NON_ACTIONABLE_LABEL_STATUSES.has(status)) return false;
  return true;
}

function jobLogIncludes(job: { log?: unknown }, pattern: string): boolean {
  try {
    return JSON.stringify(job.log || "").includes(pattern);
  } catch {
    return false;
  }
}

function parseJobLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log === "string") {
    try {
      const parsed = JSON.parse(log || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}

function firstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function summarizeJobLog(log: unknown, maxEntries = 8) {
  return parseJobLog(log)
    .slice(-maxEntries)
    .map((entry) => {
      const erroredStep = Array.isArray(entry?.steps)
        ? entry.steps.find(
            (step: any) => String(step?.status || "").toLowerCase() === "error",
          )
        : null;
      const result = entry?.result || null;
      const providerError = firstNonEmptyString(
        result?.provider_error_details?.rawResponse?.Error,
        result?.provider_error_details?.ReturnNF?.DsStatusRespostaSefaz,
        result?.provider_error_details?.ReturnNF?.Mensagem,
        result?.provider_error_details?.Mensagem,
        result?.provider_error_details?.Message,
      );
      const message = firstNonEmptyString(
        providerError,
        result?.sync_error,
        result?.message,
        entry?.message,
        erroredStep?.error,
        erroredStep?.detail,
      );

      return {
        event_type: entry?.event_type || entry?.event || null,
        type: entry?.type || null,
        stage: entry?.stage || result?.stage || erroredStep?.key || null,
        message,
        timestamp:
          entry?.timestamp || entry?.at || erroredStep?.updatedAt || null,
        http_status: firstDefined(
          entry?.http_status,
          result?.sync_http_status,
          result?.provider_status,
        ),
        error_code: firstNonEmptyString(entry?.error_code, entry?.code),
        error_category: firstNonEmptyString(
          entry?.error_category,
          entry?.category,
        ),
        request_timeout_ms: firstDefined(entry?.request_timeout_ms),
        duration_ms: firstDefined(entry?.duration_ms, result?.duration_ms),
        age_minutes: firstDefined(entry?.age_minutes),
        stale_threshold_minutes: firstDefined(entry?.stale_threshold_minutes),
        path: entry?.path || null,
        provider: firstNonEmptyString(result?.provider),
        provider_temporary: result?.provider_temporary ?? null,
        provider_error: providerError,
      };
    });
}

function compactSignaturePart(value: unknown, fallback: string) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    (raw || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9._:-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || fallback
  );
}

function findRootErrorLog(logSummary: ReturnType<typeof summarizeJobLog>) {
  for (let i = logSummary.length - 1; i >= 0; i -= 1) {
    const entry = logSummary[i];
    if (
      entry?.error_code ||
      entry?.error_category ||
      entry?.type === "error" ||
      entry?.http_status !== null ||
      entry?.provider_error ||
      entry?.message
    )
      return entry;
  }
  return logSummary[logSummary.length - 1] || null;
}

function buildJobErrorSignature(
  job: { tipo?: string | null; status?: string | null },
  logSummary: ReturnType<typeof summarizeJobLog>,
) {
  const root = findRootErrorLog(logSummary);
  const code =
    root?.error_code ||
    root?.error_category ||
    root?.provider_error ||
    root?.event_type ||
    root?.message ||
    "unknown_error";
  const httpStatus =
    root?.http_status ?? root?.provider_temporary ?? "no_http_status";
  return [
    compactSignaturePart(job.tipo, "unknown_job"),
    compactSignaturePart(job.status, "unknown_status"),
    compactSignaturePart(root?.stage, "unknown_stage"),
    compactSignaturePart(code, "unknown_error"),
    compactSignaturePart(httpStatus, "no_http_status"),
  ].join(":");
}

async function wasAlertSent(
  type: AlertType,
  dedupeKey: string,
  sinceIso: string,
): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("nf_auditoria_eventos")
    .select("id")
    .eq("evento", "whatsapp_alert_sent")
    .contains("resposta_ml", { alert_type: type, dedupe_key: dedupeKey })
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

async function auditAlert(
  input: AlertInput,
  phone: string,
  status: "sent" | "failed" | "skipped",
  extra?: Record<string, any>,
) {
  const client = createServiceClient();
  await client.from("nf_auditoria_eventos").insert({
    evento:
      status === "sent"
        ? "whatsapp_alert_sent"
        : status === "failed"
          ? "whatsapp_alert_failed"
          : "whatsapp_alert_skipped",
    status_resultante: status,
    resposta_ml: {
      alert_type: input.type,
      dedupe_key: input.dedupeKey,
      phone_suffix: phone.slice(-4),
      severity: input.severity || "info",
      payload: input.payload || null,
      ...extra,
    },
  } as any);
}

export async function sendWhatsappAlert(
  input: AlertInput,
): Promise<{ sent: number; skipped: boolean; errors: number }> {
  const ttlHours = input.dedupeTtlHours ?? 24 * 30;
  const sinceIso = new Date(Date.now() - ttlHours * 3600000).toISOString();
  const domain = alertLockDomain(input);
  const lock = await acquireDomainLock({
    domain,
    ownerTask: "whatsapp_alert",
    ttlSeconds: 180,
    metadata: { alert_type: input.type, dedupe_key: input.dedupeKey },
  }).catch(() => null);

  if (lock && !lock.acquired) {
    await auditAlert(input, "all", "skipped", { reason: "dedupe_lock" }).catch(
      () => null,
    );
    return { sent: 0, skipped: true, errors: 0 };
  }

  try {
    if (await wasAlertSent(input.type, input.dedupeKey, sinceIso)) {
      await auditAlert(input, "all", "skipped", { reason: "dedupe" }).catch(
        () => null,
      );
      return { sent: 0, skipped: true, errors: 0 };
    }

    let issueResult: Awaited<ReturnType<typeof createOrUpdateOpsIssue>> | null =
      null;
    const shouldCreateIssue =
      (input.severity || "info") === "critical" &&
      ["critical_error", "integration_status"].includes(input.type) &&
      Boolean(
        String(
          process.env.GITHUB_OPS_TOKEN || process.env.GITHUB_TOKEN || "",
        ).trim(),
      );

    const alertInput = { ...input };
    if (shouldCreateIssue) {
      try {
        issueResult = await createOrUpdateOpsIssue({
          type: input.type,
          severity: input.severity || "critical",
          title: input.title,
          message: input.issueMessage || [
            input.summary,
            ...(input.fields || []).map((field) => `${field.label}: ${String(field.value ?? "")}`),
            input.action || "",
          ].filter(Boolean).join("\n"),
          dedupeKey: input.dedupeKey,
          payload: input.payload,
        });
        alertInput.reference = `Issue #${issueResult.number} · ${issueResult.url}`;
      } catch (err: any) {
        await auditAlert(input, "all", "failed", {
          source: "github_issue_create",
          error: err?.message || "Falha ao criar issue GitHub",
        }).catch(() => null);
      }
    }

    const phones = await getAlertPhones(input.type);
    if (!phones.length) {
      await auditAlert(alertInput, "none", "skipped", {
        reason: "no_enabled_recipient_for_environment",
      }).catch(() => null);
      return { sent: 0, skipped: true, errors: 0 };
    }

    const text = buildInternalWhatsappMessage({
      title: alertInput.title,
      summary: alertInput.summary,
      severity: alertInput.severity,
      fields: alertInput.fields,
      action: alertInput.action,
      link: alertInput.link,
      reference: alertInput.reference,
    });
    let sent = 0;
    let errors = 0;
    for (const phone of phones) {
      try {
        await sendWahaText({ chatId: normalizeWhatsappChatId(phone), text });
        sent += 1;
        await auditAlert(
          alertInput,
          phone,
          "sent",
          issueResult ? { github_issue: issueResult } : undefined,
        );
      } catch (err: any) {
        errors += 1;
        await auditAlert(alertInput, phone, "failed", {
          error: err?.message || "Erro ao enviar alerta",
          github_issue: issueResult,
        }).catch(() => null);
      }
    }
    return { sent, skipped: false, errors };
  } finally {
    if (lock?.acquired) {
      await releaseDomainLock({ domain, ownerToken: lock.ownerToken }).catch(
        () => null,
      );
    }
  }
}

export async function alertNewSale(order: {
  id?: string | null;
  numero?: string | number | null;
  ml_order_id?: string | null;
  ml_pack_id?: string | null;
  contato_nome?: string | null;
  total?: number | null;
  status?: string | null;
}) {
  if (!isMlOrderPaid(order)) {
    return { sent: 0, skipped: true, errors: 0 };
  }
  const number = order.ml_order_id || order.numero || order.id || "sem_numero";
  return sendWhatsappAlert({
    type: "new_sale",
    severity: "info",
    title: "Nova venda",
    dedupeKey: `new_sale:${number}`,
    dedupeTtlHours: 24 * 30,
    summary: "Uma nova venda paga entrou na operação.",
    fields: [
      { label: "Venda", value: `#${number}` },
      { label: "Pack", value: order.ml_pack_id ? `#${order.ml_pack_id}` : null },
      { label: "Cliente", value: order.contato_nome || "Não informado" },
      { label: "Valor", value: formatCurrency(Number(order.total || 0)) },
    ],
    action: "Abra a venda e confira a próxima etapa.",
    link: appLink("Ver venda", `/pedidos?search=${encodeURIComponent(String(number))}`),
    payload: order as any,
  });
}

export async function alertNewQuestion(question: {
  id: string | number;
  item_id?: string | null;
  item_title?: string | null;
  item_permalink?: string | null;
  text?: string | null;
  buyer_id?: string | number | null;
  date_created?: string | null;
  status?: string | null;
}) {
  const questionId = String(question.id || "").trim();
  if (!questionId) return { sent: 0, skipped: true, errors: 0 };

  return sendWhatsappAlert({
    type: "new_question",
    severity: "warning",
    title: "Nova pergunta",
    dedupeKey: `new_question:${questionId}`,
    dedupeTtlHours: 24 * 30,
    summary: question.text
      ? `Um cliente perguntou: ${question.text}`
      : "Uma pergunta está aguardando resposta.",
    fields: [
      { label: "Pergunta", value: `#${questionId}` },
      { label: "Anúncio", value: question.item_title || question.item_id || "Não informado" },
      {
        label: "Recebida em",
        value: question.date_created
          ? new Date(question.date_created).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : null,
      },
    ],
    action: "Responda a pergunta no Bentevi.",
    link: appLink("Responder pergunta", "/perguntas"),
    payload: question as any,
  });
}

export async function alertClaimOpened(order: {
  id?: string | null;
  numero?: string | number | null;
  ml_order_id?: string | null;
  ml_claim_id?: string | null;
  ml_claim_status?: string | null;
  contato_nome?: string | null;
}) {
  if (!order.ml_claim_id) return { sent: 0, skipped: true, errors: 0 };
  const orderNumber =
    order.ml_order_id || order.numero || order.id || "sem_numero";
  return sendWhatsappAlert({
    type: "claim_opened",
    severity: "critical",
    title: "Reclamação aberta",
    dedupeKey: `claim_opened:${order.ml_claim_id}`,
    dedupeTtlHours: 24 * 90,
    summary: "Uma venda precisa de atenção.",
    fields: [
      { label: "Venda", value: `#${orderNumber}` },
      { label: "Reclamação", value: `#${order.ml_claim_id}` },
      { label: "Situação", value: order.ml_claim_status || "Não informada" },
      { label: "Cliente", value: order.contato_nome || "Não informado" },
    ],
    action: "Abra o caso e confira o prazo de resposta.",
    link: appLink("Ver reclamação", "/reclamacoes"),
    payload: order as any,
  });
}

export async function alertMlLabelReleased(order: {
  id?: string | null;
  numero?: string | number | null;
  ml_order_id?: string | null;
  ml_shipment_id?: string | null;
  ml_fiscal_release_at?: string | null;
  contato_nome?: string | null;
  total?: number | null;
  dslite_id?: string | null;
  situacao?: string | null;
}) {
  if (!isActionableLabelRelease(order)) {
    const skippedInput: AlertInput = {
      type: "ml_label_released",
      severity: "warning",
      title: "Etiqueta Mercado Livre liberada",
      dedupeKey: `ml_label_released_skipped:${order.ml_order_id || order.numero || order.id || "sem_numero"}`,
      dedupeTtlHours: 24,
      summary: "O pedido não possui um envio ativo que permita usar a etiqueta.",
      payload: {
        id: order.id || null,
        numero: order.numero || null,
        ml_order_id: order.ml_order_id || null,
        ml_shipment_id: order.ml_shipment_id || null,
        situacao: order.situacao || null,
      },
    };
    await auditAlert(skippedInput, "all", "skipped", {
      reason: "not_actionable_label_release",
    }).catch(() => null);
    return { sent: 0, skipped: true, errors: 0 };
  }

  const orderNumber =
    order.ml_order_id || order.numero || order.id || "sem_numero";
  return sendWhatsappAlert({
    type: "ml_label_released",
    severity: "warning",
    title: "Etiqueta liberada",
    dedupeKey: `ml_label_released:${orderNumber}`,
    dedupeTtlHours: 24 * 30,
    summary: "A etiqueta da venda já pode ser enviada ao fornecedor.",
    fields: [
      { label: "Venda", value: `#${orderNumber}` },
      { label: "Pedido DSLite", value: order.dslite_id ? `#${order.dslite_id}` : null },
      { label: "Envio Mercado Livre", value: order.ml_shipment_id },
      { label: "Cliente", value: order.contato_nome || "Não informado" },
      { label: "Valor", value: formatCurrency(Number(order.total || 0)) },
      {
        label: "Previsão",
        value: order.ml_fiscal_release_at
          ? formatMlReleaseWindow(order.ml_fiscal_release_at).when
          : null,
      },
    ],
    action: "Envie a etiqueta correta ao fornecedor.",
    link: appLink("Abrir venda", `/pedidos?search=${encodeURIComponent(String(orderNumber))}`),
    payload: {
      id: order.id || null,
      numero: order.numero || null,
      ml_order_id: order.ml_order_id || null,
      ml_shipment_id: order.ml_shipment_id || null,
      ml_fiscal_release_at: order.ml_fiscal_release_at || null,
      dslite_id: order.dslite_id || null,
      situacao: order.situacao || null,
    },
  });
}

export async function scanAndAlertReleasedLabels(limit = 20) {
  const client = createServiceClient();
  const minReleaseAt = new Date(
    Date.now() - LABEL_RELEASE_SCAN_LOOKBACK_DAYS * 24 * 3600000,
  ).toISOString();
  const { data } = await client
    .from("pedidos")
    .select(
      "id,numero,ml_order_id,ml_shipment_id,ml_fiscal_release_at,contato_nome,total,dslite_id,ml_label_downloaded_at,situacao",
    )
    .not("ml_fiscal_release_at", "is", null)
    .not("ml_shipment_id", "is", null)
    .is("ml_label_downloaded_at", null)
    .gte("ml_fiscal_release_at", minReleaseAt)
    .order("ml_fiscal_release_at", { ascending: true })
    .limit(limit);
  let alerted = 0;
  let releasedEarly = 0;
  for (const row of data || []) {
    if (!isActionableLabelRelease(row as any)) continue;
    const availability = await consultarDisponibilidadeEtiquetaML(
      String(row.ml_shipment_id),
    );
    if (!availability.printable) continue;
    const comparable = row.ml_fiscal_release_at
      ? getMlReleaseComparableDate(row.ml_fiscal_release_at)
      : null;
    if (comparable && comparable.getTime() > Date.now()) releasedEarly += 1;
    await client
      .from("pedidos")
      .update({
        ml_fiscal_release_at: null,
        ml_fiscal_release_reason: null,
        ml_fiscal_release_source: "shipment.status/substatus",
        ml_fiscal_release_checked_at: new Date().toISOString(),
      } as any)
      .eq("id", row.id);
    const result = await alertMlLabelReleased(row as any);
    alerted += result.sent > 0 ? 1 : 0;
  }
  return { checked: data?.length || 0, releasedEarly, alerted };
}

export async function alertIntegrationStatus() {
  const ml = await getMLAuthDiagnostics();
  let wahaStatus = "unknown";
  let waha: Record<string, unknown> | null = null;
  try {
    waha = await getWahaDiagnostics();
    wahaStatus = String(waha.status || "unknown");
  } catch (err: any) {
    wahaStatus = `error:${err?.message || "unknown"}`;
  }

  const problems: string[] = [];
  if (ml.state !== "ok")
    problems.push(
      `Mercado Livre: ${ml.state}${ml.last_refresh_error ? ` (${ml.last_refresh_error})` : ""}`,
    );
  if (wahaStatus !== "WORKING") problems.push(`WAHA: ${wahaStatus}`);

  let githubIssuesResolved = 0;
  if (
    problems.length === 0 &&
    String(process.env.GITHUB_OPS_TOKEN || process.env.GITHUB_TOKEN || "").trim()
  ) {
    const recovery = await resolveOpenIntegrationOpsIssues(
      [
        "Recuperação confirmada automaticamente.",
        "",
        `- Mercado Livre: ${ml.state}`,
        `- WAHA: ${wahaStatus}`,
        `- Verificado em: ${new Date().toISOString()}`,
      ].join("\n"),
    ).catch(() => ({ resolved: 0 }));
    githubIssuesResolved = recovery.resolved;
  }

  const stateKey = problems.length ? problems.join("|") : "ok";
  const alertResult = await sendWhatsappAlert({
    type: "integration_status",
    severity: problems.length ? "critical" : "info",
    title: problems.length
      ? "Integração com problema"
      : "Integrações normalizadas",
    dedupeKey: `integration_status:${stateKey}`,
    dedupeTtlHours: problems.length ? 6 : 24,
    summary: problems.length
      ? "Uma integração essencial precisa de atenção."
      : "Mercado Livre e WhatsApp estão funcionando normalmente.",
    fields: [
      { label: "Mercado Livre", value: ml.state === "ok" ? "Conectado" : "Precisa de atenção" },
      { label: "WhatsApp", value: wahaStatus === "WORKING" ? "Conectado" : "Precisa de atenção" },
    ],
    action: problems.length ? "Abra o painel e verifique as conexões." : null,
    link: problems.length ? appLink("Abrir integrações", "/configuracoes?tab=integracoes") : null,
    issueMessage: problems.length ? problems.join("\n") : undefined,
    payload: { ml, wahaStatus, waha },
  });
  return { ...alertResult, githubIssuesResolved };
}

export async function alertCriticalJobs() {
  const client = createServiceClient();
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await client
    .from("jobs")
    .select("id,tipo,status,created_at,finished_at,log")
    .in("status", ["erro", "failed_auth"])
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(20);

  const failedTypes = Array.from(
    new Set(
      (data || [])
        .map((job) => String(job.tipo || "").trim())
        .filter(Boolean),
    ),
  );
  const latestRecoveryByType = new Map<string, string>();
  if (failedTypes.length) {
    const { data: recoveredJobs } = await client
      .from("jobs")
      .select("tipo,finished_at")
      .eq("status", "completo")
      .in("tipo", failedTypes)
      .gte("finished_at", since)
      .order("finished_at", { ascending: false })
      .limit(200);

    for (const recoveredJob of recoveredJobs || []) {
      const type = String(recoveredJob.tipo || "").trim();
      if (type && recoveredJob.finished_at && !latestRecoveryByType.has(type)) {
        latestRecoveryByType.set(type, recoveredJob.finished_at);
      }
    }
  }

  const grouped = new Map<
    string,
    Array<{
      job: any;
      logSummary: ReturnType<typeof summarizeJobLog>;
      lastLog: any;
    }>
  >();
  for (const job of data || []) {
    if (jobLogIncludes(job, "domain_lock_conflict")) continue;

    const logSummary = summarizeJobLog(job.log);
    const lastLog = logSummary[logSummary.length - 1] || null;
    const signature = buildJobErrorSignature(job, logSummary);
    const current = grouped.get(signature) || [];
    current.push({ job, logSummary, lastLog });
    grouped.set(signature, current);
  }

  let alerted = 0;
  let skippedTransient = 0;
  let skippedRecovered = 0;
  let deferredTimeout = 0;
  for (const [signature, occurrences] of grouped) {
    const latest = occurrences[0];
    const rootLog = findRootErrorLog(latest.logSummary);
    const decision = decideCriticalJobAlert({
      status: latest.job.status,
      occurrences: occurrences.length,
      finishedAt: latest.job.finished_at,
      recoveredAt: latestRecoveryByType.get(String(latest.job.tipo || "")) || null,
      rootLog,
    });
    if (decision === "skip_transient") {
      skippedTransient += 1;
      continue;
    }
    if (decision === "skip_recovered") {
      skippedRecovered += 1;
      continue;
    }
    if (decision === "defer_timeout") {
      deferredTimeout += 1;
      continue;
    }

    const result = await sendWhatsappAlert({
      type: "critical_error",
      severity: "critical",
      title: "Rotina automática com falha",
      dedupeKey: `job_error:${signature}`,
      dedupeTtlHours: 24 * 7,
      summary: "Uma rotina importante não foi concluída.",
      fields: [
        { label: "Rotina", value: latest.job.tipo },
        { label: "Ocorrências", value: `${occurrences.length} tentativa(s)` },
        {
          label: "Última falha",
          value: latest.job.finished_at
            ? formatSaoPauloDateTime(latest.job.finished_at) || "Não informada"
            : "Não informada",
        },
      ],
      action: "Abra o painel e verifique a rotina.",
      link: appLink("Abrir painel", "/dashboard"),
      reference: rootLog?.error_code || rootLog?.error_category || null,
      issueMessage: [
        `Job: ${latest.job.tipo}`,
        `Status: ${latest.job.status}`,
        `Ocorrências: ${occurrences.length}`,
        rootLog?.event_type ? `Evento: ${rootLog.event_type}` : null,
        rootLog?.error_code ? `Código: ${rootLog.error_code}` : null,
        rootLog?.http_status !== null ? `HTTP/Status: ${rootLog.http_status}` : null,
        rootLog?.provider ? `Provider: ${rootLog.provider}` : null,
        rootLog?.message || latest.lastLog?.message || null,
      ].filter(Boolean).join("\n"),
      payload: {
        id: latest.job.id,
        tipo: latest.job.tipo,
        status: latest.job.status,
        created_at: latest.job.created_at,
        finished_at: latest.job.finished_at,
        occurrences: occurrences.length,
        signature,
        root_log: rootLog,
        last_log: latest.lastLog,
        log_summary: latest.logSummary,
        recent_job_ids: occurrences.map((entry) => entry.job.id).slice(0, 10),
      },
    });
    alerted += result.sent > 0 ? 1 : 0;
  }
  return {
    checked: data?.length || 0,
    grouped: grouped.size,
    skipped_transient: skippedTransient,
    skipped_recovered: skippedRecovered,
    deferred_timeout: deferredTimeout,
    alerted,
  };
}

/**
 * `alertCriticalJobs` só enxerga jobs que RODARAM e falharam. Uma task com
 * `dispatchMode: 'scheduled'` que perde seu `schedule` (ou cujo cron-dispatch
 * para de chamá-la por qualquer outro motivo) nunca cria um job de erro —
 * ela simplesmente para de criar jobs, silenciosamente. Foi exatamente o que
 * aconteceu com `sync_dslite_preco_estoque` entre 22/07 e 10/08 (19 dias sem
 * rodar, sem nenhum alerta disparado). Esta checagem cobre esse buraco.
 */
export async function alertStaleScheduledTasks() {
  const client = createServiceClient();
  const hour = getSaoPauloHour();
  const scheduledTasks = SYNC_TASKS.filter((task) => task.dispatchMode === "scheduled");

  let checked = 0;
  let alerted = 0;
  let deferred = 0;
  const healthyTaskKeys: string[] = [];

  for (const task of scheduledTasks) {
    checked += 1;

    if (!task.schedule) {
      const result = await sendWhatsappAlert({
        type: "critical_error",
        severity: "critical",
        title: "Rotina sem agendamento",
        dedupeKey: `sync_schedule_missing:${task.key}`,
        dedupeTtlHours: 24,
        summary: "Uma rotina automática não possui horário para executar.",
        fields: [{ label: "Rotina", value: task.label }],
        action: "Revise o agendamento da rotina.",
        reference: task.key,
        issueMessage: `A task ${task.key} está sem schedule no registry.`,
        payload: { task: task.key, dispatch_mode: task.dispatchMode },
      });
      alerted += result.sent > 0 ? 1 : 0;
      continue;
    }

    const intervalMinutes = getIntervalMinutesForTask(task, hour);
    if (!intervalMinutes || intervalMinutes <= 0) continue;

    const { data: last, error: lookupError } = await client
      .from("jobs")
      .select("created_at")
      .eq("tipo", task.jobTipo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const health = evaluateScheduledTaskHealth({
      intervalMinutes,
      lastRunAt: last?.created_at || null,
      lookupFailed: Boolean(lookupError),
    });
    if (health.state === "deferred") {
      deferred += 1;
      console.error("[stale-scheduled-task] consulta adiada", {
        task: task.key,
        code: lookupError?.code || null,
        message: lookupError?.message || "created_at inválido",
      });
      continue;
    }
    if (health.state === "healthy") {
      healthyTaskKeys.push(task.key);
      continue;
    }

    if (health.state === "stale") {
      const result = await sendWhatsappAlert({
        type: "critical_error",
        severity: "critical",
        title: "Rotina sem execução",
        dedupeKey: `sync_schedule_stale:${task.key}`,
        dedupeTtlHours: 6,
        summary: "Uma rotina não executa há mais tempo que o esperado.",
        fields: [
          { label: "Rotina", value: task.label },
          { label: "Frequência", value: `A cada ${intervalMinutes} minutos` },
          {
            label: "Última execução",
            value: health.minutesSinceLastRun !== null
              ? `Há ${Math.round(health.minutesSinceLastRun)} minutos`
              : "Nenhuma execução encontrada",
          },
        ],
        action: "Abra o painel e confira o agendamento.",
        link: appLink("Abrir painel", "/dashboard"),
        reference: task.key,
        payload: {
          task: task.key,
          interval_minutes: intervalMinutes,
          stale_threshold_minutes: health.staleThresholdMinutes,
          minutes_since_last_run: health.minutesSinceLastRun,
        },
      });
      alerted += result.sent > 0 ? 1 : 0;
    }
  }

  let githubIssuesResolved = 0;
  if (
    healthyTaskKeys.length > 0 &&
    String(process.env.GITHUB_OPS_TOKEN || process.env.GITHUB_TOKEN || "").trim()
  ) {
    const recovery = await resolveRecoveredScheduledTaskOpsIssues(
      healthyTaskKeys,
      [
        "Recuperação da task confirmada automaticamente.",
        `- Verificado em: ${new Date().toISOString()}`,
      ].join("\n"),
    ).catch((error: any) => {
      console.error("[stale-scheduled-task] falha ao resolver issues", error?.message || error);
      return { resolved: 0 };
    });
    githubIssuesResolved = recovery.resolved;
  }

  return { checked, alerted, deferred, githubIssuesResolved };
}

export async function sendSalesReport(
  kind: "weekly" | "monthly",
  reference = new Date(),
) {
  const client = createServiceClient();
  const end = new Date(reference);
  const start = new Date(reference);
  if (kind === "weekly") start.setDate(start.getDate() - 7);
  else start.setMonth(start.getMonth() - 1);

  const { data } = await client
    .from("pedidos")
    .select("id,total,lucro,situacao,data_venda,data,ml_claim_id")
    .gte("data_venda", start.toISOString())
    .lte("data_venda", end.toISOString());

  const rows = data || [];
  const count = rows.length;
  const total = rows.reduce(
    (sum: number, row: any) => sum + Number(row.total || 0),
    0,
  );
  const lucro = rows.reduce(
    (sum: number, row: any) => sum + Number(row.lucro || 0),
    0,
  );
  const claims = rows.filter((row: any) => row.ml_claim_id).length;
  const statusCounts = rows.reduce((acc: Record<string, number>, row: any) => {
    const key = String(row.situacao || "sem_status");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const periodLabel = `${saoPauloDateLabel(start)} a ${saoPauloDateLabel(end)}`;
  return sendWhatsappAlert({
    type: kind === "weekly" ? "weekly_sales_report" : "monthly_sales_report",
    severity: "info",
    title:
      kind === "weekly"
        ? "Resumo semanal"
        : "Resumo mensal",
    dedupeKey: `${kind}_sales_report:${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`,
    dedupeTtlHours: 24 * 45,
    summary: kind === "weekly"
      ? "Confira o resultado dos últimos sete dias."
      : "Confira o resultado consolidado dos últimos 30 dias.",
    fields: [
      { label: "Período", value: periodLabel },
      { label: "Vendas", value: count },
      { label: "Faturamento", value: formatCurrency(total) },
      { label: "Lucro", value: formatCurrency(lucro) },
      { label: "Ticket médio", value: formatCurrency(count ? total / count : 0) },
      { label: "Reclamações", value: claims },
    ],
    link: appLink("Ver dashboard", "/dashboard"),
    payload: {
      kind,
      start: start.toISOString(),
      end: end.toISOString(),
      count,
      total,
      lucro,
      claims,
      statusCounts,
    },
  });
}
