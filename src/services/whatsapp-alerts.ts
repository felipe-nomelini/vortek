import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';
import { getWahaDiagnostics, normalizeWhatsappChatId, sendWahaText } from '@/services/waha';
import { formatCurrency } from '@/lib/format';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import {
  createOrUpdateOpsIssue,
} from '@/services/github-ops';

type AlertType =
  | 'new_sale'
  | 'new_question'
  | 'critical_error'
  | 'integration_status'
  | 'weekly_sales_report'
  | 'monthly_sales_report'
  | 'claim_opened'
  | 'ml_label_released';

type Severity = 'info' | 'warning' | 'critical';

type AlertInput = {
  type: AlertType;
  severity?: Severity;
  title: string;
  message: string;
  dedupeKey: string;
  payload?: Record<string, any>;
  dedupeTtlHours?: number;
};

const DEFAULT_ALERT_PHONES = ['21981172939', '21970066090'];
const LABEL_RELEASE_SCAN_LOOKBACK_DAYS = 10;
const NON_ACTIONABLE_LABEL_STATUSES = new Set(['cancelado', 'cancelled', 'entregue', 'devolvido', 'recusado']);

function getAlertPhones(): string[] {
  const raw = String(process.env.WHATSAPP_ALERT_PHONES || '').trim();
  const phones = raw
    ? raw.split(',').map((phone) => phone.trim()).filter(Boolean)
    : DEFAULT_ALERT_PHONES;
  return Array.from(new Set(phones.map((phone) => phone.replace(/\D/g, '')).filter(Boolean)));
}

function nowIso() {
  return new Date().toISOString();
}

function alertLockDomain(input: AlertInput) {
  const hash = createHash('sha256')
    .update(`${input.type}:${input.dedupeKey}`)
    .digest('hex')
    .slice(0, 32);
  return `whatsapp_alert:${hash}`;
}

function saoPauloDateLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function severityLabel(severity: Severity) {
  if (severity === 'critical') return 'CRÍTICO';
  if (severity === 'warning') return 'ATENÇÃO';
  return 'INFO';
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
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
    return JSON.stringify(job.log || '').includes(pattern);
  } catch {
    return false;
  }
}

function parseJobLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log === 'string') {
    try {
      const parsed = JSON.parse(log || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function summarizeJobLog(log: unknown, maxEntries = 8) {
  return parseJobLog(log)
    .slice(-maxEntries)
    .map((entry) => ({
      event_type: entry?.event_type || null,
      type: entry?.type || null,
      stage: entry?.stage || null,
      message: entry?.message || null,
      timestamp: entry?.timestamp || null,
      http_status: entry?.http_status ?? null,
      error_code: entry?.error_code || entry?.code || null,
      error_category: entry?.error_category || entry?.category || null,
      request_timeout_ms: entry?.request_timeout_ms ?? null,
      duration_ms: entry?.duration_ms ?? null,
      age_minutes: entry?.age_minutes ?? null,
      stale_threshold_minutes: entry?.stale_threshold_minutes ?? null,
      path: entry?.path || null,
    }));
}

function buildText(input: AlertInput) {
  return [
    `*Vortek - ${severityLabel(input.severity || 'info')}*`,
    '',
    `*${input.title}*`,
    '',
    input.message,
    '',
    `Data: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  ].join('\n');
}

async function wasAlertSent(type: AlertType, dedupeKey: string, sinceIso: string): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('nf_auditoria_eventos')
    .select('id')
    .eq('evento', 'whatsapp_alert_sent')
    .contains('resposta_ml', { alert_type: type, dedupe_key: dedupeKey })
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

async function auditAlert(input: AlertInput, phone: string, status: 'sent' | 'failed' | 'skipped', extra?: Record<string, any>) {
  const client = createServiceClient();
  await client.from('nf_auditoria_eventos').insert({
    evento: status === 'sent' ? 'whatsapp_alert_sent' : status === 'failed' ? 'whatsapp_alert_failed' : 'whatsapp_alert_skipped',
    status_resultante: status,
    resposta_ml: {
      alert_type: input.type,
      dedupe_key: input.dedupeKey,
      phone_suffix: phone.slice(-4),
      severity: input.severity || 'info',
      payload: input.payload || null,
      ...extra,
    },
  } as any);
}

export async function sendWhatsappAlert(input: AlertInput): Promise<{ sent: number; skipped: boolean; errors: number }> {
  const ttlHours = input.dedupeTtlHours ?? 24 * 30;
  const sinceIso = new Date(Date.now() - ttlHours * 3600000).toISOString();
  const domain = alertLockDomain(input);
  const lock = await acquireDomainLock({
    domain,
    ownerTask: 'whatsapp_alert',
    ttlSeconds: 180,
    metadata: { alert_type: input.type, dedupe_key: input.dedupeKey },
  }).catch(() => null);

  if (lock && !lock.acquired) {
    await auditAlert(input, 'all', 'skipped', { reason: 'dedupe_lock' }).catch(() => null);
    return { sent: 0, skipped: true, errors: 0 };
  }

  try {
    if (await wasAlertSent(input.type, input.dedupeKey, sinceIso)) {
      await auditAlert(input, 'all', 'skipped', { reason: 'dedupe' }).catch(() => null);
      return { sent: 0, skipped: true, errors: 0 };
    }

    let issueResult: Awaited<ReturnType<typeof createOrUpdateOpsIssue>> | null = null;
    const shouldCreateIssue = (input.severity || 'info') === 'critical'
      && ['critical_error', 'integration_status'].includes(input.type)
      && Boolean(String(process.env.GITHUB_OPS_TOKEN || process.env.GITHUB_TOKEN || '').trim());

    const alertInput = { ...input };
    if (shouldCreateIssue) {
      try {
        issueResult = await createOrUpdateOpsIssue({
          type: input.type,
          severity: input.severity || 'critical',
          title: input.title,
          message: input.message,
          dedupeKey: input.dedupeKey,
          payload: input.payload,
        });
        alertInput.message = [
          input.message,
          '',
          `GitHub Issue: #${issueResult.number}`,
          issueResult.url,
          '',
          'A issue foi criada para resolução manual posterior.',
        ].join('\n');
      } catch (err: any) {
        await auditAlert(input, 'all', 'failed', {
          source: 'github_issue_create',
          error: err?.message || 'Falha ao criar issue GitHub',
        }).catch(() => null);
      }
    }

    const text = buildText(alertInput);
    let sent = 0;
    let errors = 0;
    for (const phone of getAlertPhones()) {
      try {
        await sendWahaText({ chatId: normalizeWhatsappChatId(phone), text });
        sent += 1;
        await auditAlert(alertInput, phone, 'sent', issueResult ? { github_issue: issueResult } : undefined);
      } catch (err: any) {
        errors += 1;
        await auditAlert(alertInput, phone, 'failed', { error: err?.message || 'Erro ao enviar alerta', github_issue: issueResult }).catch(() => null);
      }
    }
    return { sent, skipped: false, errors };
  } finally {
    if (lock?.acquired) {
      await releaseDomainLock({ domain, ownerToken: lock.ownerToken }).catch(() => null);
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
}) {
  const number = order.ml_order_id || order.numero || order.id || 'sem_numero';
  return sendWhatsappAlert({
    type: 'new_sale',
    severity: 'info',
    title: 'Novo pedido de venda',
    dedupeKey: `new_sale:${number}`,
    dedupeTtlHours: 24 * 30,
    message: [
      `Pedido ML: #${number}`,
      order.ml_pack_id ? `Pack ID: ${order.ml_pack_id}` : null,
      `Cliente: ${order.contato_nome || 'Desconhecido'}`,
      `Valor: ${formatCurrency(Number(order.total || 0))}`,
      `Link: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop'}/pedidos?search=${encodeURIComponent(String(number))}`,
    ].filter(Boolean).join('\n'),
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
  const questionId = String(question.id || '').trim();
  if (!questionId) return { sent: 0, skipped: true, errors: 0 };

  return sendWhatsappAlert({
    type: 'new_question',
    severity: 'warning',
    title: 'Nova pergunta no Mercado Livre',
    dedupeKey: `new_question:${questionId}`,
    dedupeTtlHours: 24 * 30,
    message: [
      `Pergunta ML: #${questionId}`,
      question.item_title ? `Anúncio: ${question.item_title}` : question.item_id ? `Anúncio: ${question.item_id}` : null,
      question.buyer_id ? `Cliente ML: ${question.buyer_id}` : null,
      question.date_created ? `Recebida em: ${new Date(question.date_created).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : null,
      '',
      question.text ? `Pergunta: ${question.text}` : 'Pergunta sem texto retornado pelo ML.',
      '',
      question.item_permalink ? `Link do anúncio: ${question.item_permalink}` : null,
      `Responder no sistema: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop'}/perguntas`,
    ].filter((line) => line !== null).join('\n'),
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
  const orderNumber = order.ml_order_id || order.numero || order.id || 'sem_numero';
  return sendWhatsappAlert({
    type: 'claim_opened',
    severity: 'critical',
    title: 'Reclamação aberta no Mercado Livre',
    dedupeKey: `claim_opened:${order.ml_claim_id}`,
    dedupeTtlHours: 24 * 90,
    message: [
      `Pedido ML: #${orderNumber}`,
      `Claim: ${order.ml_claim_id}`,
      `Status: ${order.ml_claim_status || 'não informado'}`,
      `Cliente: ${order.contato_nome || 'Desconhecido'}`,
      `Link: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop'}/pedidos?search=${encodeURIComponent(String(orderNumber))}`,
    ].join('\n'),
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
      type: 'ml_label_released',
      severity: 'warning',
      title: 'Etiqueta Mercado Livre liberada',
      dedupeKey: `ml_label_released_skipped:${order.ml_order_id || order.numero || order.id || 'sem_numero'}`,
      dedupeTtlHours: 24,
      message: 'Pedido sem envio ML ativo ou com status não acionável para etiqueta.',
      payload: {
        id: order.id || null,
        numero: order.numero || null,
        ml_order_id: order.ml_order_id || null,
        ml_shipment_id: order.ml_shipment_id || null,
        situacao: order.situacao || null,
      },
    };
    await auditAlert(skippedInput, 'all', 'skipped', { reason: 'not_actionable_label_release' }).catch(() => null);
    return { sent: 0, skipped: true, errors: 0 };
  }

  const orderNumber = order.ml_order_id || order.numero || order.id || 'sem_numero';
  return sendWhatsappAlert({
    type: 'ml_label_released',
    severity: 'warning',
    title: 'Etiqueta Mercado Livre liberada',
    dedupeKey: `ml_label_released:${orderNumber}`,
    dedupeTtlHours: 24 * 30,
    message: [
      `Pedido ML: #${orderNumber}`,
      order.dslite_id ? `Pedido DSLite: #${order.dslite_id}` : null,
      order.ml_shipment_id ? `Envio ML: ${order.ml_shipment_id}` : null,
      `Cliente: ${order.contato_nome || 'Desconhecido'}`,
      `Valor: ${formatCurrency(Number(order.total || 0))}`,
      order.ml_fiscal_release_at ? `Janela prevista: ${formatMlReleaseWindow(order.ml_fiscal_release_at).when}` : null,
      `Ação: subir XML, baixar etiqueta real e enviar ao fornecedor.`,
      `Link: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop'}/pedidos?search=${encodeURIComponent(String(orderNumber))}`,
    ].filter(Boolean).join('\n'),
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
  const minReleaseAt = new Date(Date.now() - LABEL_RELEASE_SCAN_LOOKBACK_DAYS * 24 * 3600000).toISOString();
  const { data } = await client
    .from('pedidos')
    .select('id,numero,ml_order_id,ml_shipment_id,ml_fiscal_release_at,contato_nome,total,dslite_id,ml_label_downloaded_at,situacao')
    .not('ml_fiscal_release_at', 'is', null)
    .not('ml_shipment_id', 'is', null)
    .is('ml_label_downloaded_at', null)
    .gte('ml_fiscal_release_at', minReleaseAt)
    .order('ml_fiscal_release_at', { ascending: true })
    .limit(limit);
  let alerted = 0;
  for (const row of data || []) {
    if (!isActionableLabelRelease(row as any)) continue;
    const comparable = row.ml_fiscal_release_at ? getMlReleaseComparableDate(row.ml_fiscal_release_at) : null;
    if (!comparable || comparable.getTime() > Date.now()) continue;
    const result = await alertMlLabelReleased(row as any);
    alerted += result.sent > 0 ? 1 : 0;
  }
  return { checked: data?.length || 0, alerted };
}

export async function alertIntegrationStatus() {
  const ml = await getMLAuthDiagnostics();
  let wahaStatus = 'unknown';
  let waha: Record<string, unknown> | null = null;
  try {
    waha = await getWahaDiagnostics();
    wahaStatus = String(waha.status || 'unknown');
  } catch (err: any) {
    wahaStatus = `error:${err?.message || 'unknown'}`;
  }

  const problems: string[] = [];
  if (ml.state !== 'ok') problems.push(`Mercado Livre: ${ml.state}${ml.last_refresh_error ? ` (${ml.last_refresh_error})` : ''}`);
  if (wahaStatus !== 'WORKING') problems.push(`WAHA: ${wahaStatus}`);

  const stateKey = problems.length ? problems.join('|') : 'ok';
  return sendWhatsappAlert({
    type: 'integration_status',
    severity: problems.length ? 'critical' : 'info',
    title: problems.length ? 'Integração com problema' : 'Integrações operando normalmente',
    dedupeKey: `integration_status:${stateKey}`,
    dedupeTtlHours: problems.length ? 6 : 24,
    message: problems.length ? problems.join('\n') : 'Mercado Livre e WAHA estão conectados.',
    payload: { ml, wahaStatus, waha },
  });
}

export async function alertCriticalJobs() {
  const client = createServiceClient();
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await client
    .from('jobs')
    .select('id,tipo,status,created_at,finished_at,log')
    .in('status', ['erro', 'failed_auth'])
    .gte('finished_at', since)
    .order('finished_at', { ascending: false })
    .limit(10);
  let alerted = 0;
  for (const job of data || []) {
    if (jobLogIncludes(job, 'domain_lock_conflict')) continue;

    const logSummary = summarizeJobLog(job.log);
    const lastLog = logSummary[logSummary.length - 1] || null;

    const result = await sendWhatsappAlert({
      type: 'critical_error',
      severity: 'critical',
      title: 'Job crítico falhou',
      dedupeKey: `job_error:${job.id}:${job.status}`,
      dedupeTtlHours: 24 * 7,
      message: [
        `Job: ${job.tipo}`,
        `Status: ${job.status}`,
        `Finalizado: ${job.finished_at || 'não informado'}`,
        lastLog?.event_type ? `Evento: ${lastLog.event_type}` : null,
        lastLog?.message ? `Erro/log: ${lastLog.message}` : null,
        `Link: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop'}/dashboard`,
      ].filter(Boolean).join('\n'),
      payload: {
        id: job.id,
        tipo: job.tipo,
        status: job.status,
        created_at: job.created_at,
        finished_at: job.finished_at,
        last_log: lastLog,
        log_summary: logSummary,
      },
    });
    alerted += result.sent > 0 ? 1 : 0;
  }
  return { checked: data?.length || 0, alerted };
}

export async function sendSalesReport(kind: 'weekly' | 'monthly', reference = new Date()) {
  const client = createServiceClient();
  const end = new Date(reference);
  const start = new Date(reference);
  if (kind === 'weekly') start.setDate(start.getDate() - 7);
  else start.setMonth(start.getMonth() - 1);

  const { data } = await client
    .from('pedidos')
    .select('id,total,lucro,situacao,data_venda,data,ml_claim_id')
    .gte('data_venda', start.toISOString())
    .lte('data_venda', end.toISOString());

  const rows = data || [];
  const count = rows.length;
  const total = rows.reduce((sum: number, row: any) => sum + Number(row.total || 0), 0);
  const lucro = rows.reduce((sum: number, row: any) => sum + Number(row.lucro || 0), 0);
  const claims = rows.filter((row: any) => row.ml_claim_id).length;
  const statusCounts = rows.reduce((acc: Record<string, number>, row: any) => {
    const key = String(row.situacao || 'sem_status');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const periodLabel = `${saoPauloDateLabel(start)} a ${saoPauloDateLabel(end)}`;
  return sendWhatsappAlert({
    type: kind === 'weekly' ? 'weekly_sales_report' : 'monthly_sales_report',
    severity: 'info',
    title: kind === 'weekly' ? 'Relatório semanal de vendas' : 'Relatório mensal de vendas',
    dedupeKey: `${kind}_sales_report:${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`,
    dedupeTtlHours: 24 * 45,
    message: [
      `Período: ${periodLabel}`,
      `Pedidos: ${count}`,
      `Faturamento: ${formatCurrency(total)}`,
      `Lucro: ${formatCurrency(lucro)}`,
      `Ticket médio: ${formatCurrency(count ? total / count : 0)}`,
      `Reclamações no período: ${claims}`,
      `Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'sem pedidos'}`,
    ].join('\n'),
    payload: { kind, start: start.toISOString(), end: end.toISOString(), count, total, lucro, claims, statusCounts },
  });
}
