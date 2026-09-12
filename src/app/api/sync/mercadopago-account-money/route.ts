import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  buildUtcRange,
  createAccountMoneyReport,
  downloadAccountMoneyReport,
  getAccountMoneyReportTask,
  MercadoPagoRequestError,
  searchAccountMoneyReportsPage,
  type MercadoPagoReportTask,
} from '@/services/mercadopago';
import {
  getMercadoPagoCompletedWindowEnd,
  getNextMercadoPagoWindow,
  getMercadoPagoReportFileName,
  getMercadoPagoReportResumeState,
  isMercadoPagoReportPending,
  isMercadoPagoReportReady,
  parseMercadoPagoAccountMoneyCsv,
  resolveMercadoPagoReportTaskId,
} from '@/lib/mercadopago-account-money';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;
const REPORT_PAGE_SIZE = 30;
const REPORT_SEARCH_MAX_PAGES = 40;
const IMPORT_BATCH_SIZE = 500;
const REPORT_OVERLAP_DAYS = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePositiveInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

async function getPersistedResumeState(syncJobId: string) {
  if (!syncJobId) return null;
  const service = createServiceClient();
  const { data, error } = await service
    .from('jobs')
    .select('log')
    .eq('id', syncJobId)
    .eq('tipo', 'sync_mercadopago_account_money')
    .maybeSingle();

  if (error) throw new Error(`Falha ao recuperar lifecycle Mercado Pago: ${error.message}`);
  return getMercadoPagoReportResumeState(data?.log);
}

async function getInitialScheduledRange(
  service: ReturnType<typeof createServiceClient>,
  windowDays: number,
  targetEndDate: string,
) {
  const [movement, jobs] = await Promise.all([
    service.from('mercadopago_account_movements').select('movement_date')
      .not('movement_date', 'is', null).order('movement_date', { ascending: false }).limit(1).maybeSingle(),
    service.from('jobs').select('log,finished_at').eq('tipo', 'sync_mercadopago_account_money')
      .eq('status', 'completo').order('finished_at', { ascending: false }).limit(50),
  ]);
  if (movement.error || jobs.error) throw new Error('Não foi possível localizar a última importação financeira.');
  const completedEnds = (jobs.data || [])
    .map((job) => getMercadoPagoCompletedWindowEnd(job.log))
    .filter((value): value is string => Boolean(value));
  const candidates = [movement.data?.movement_date, ...completedEnds]
    .map((value) => Date.parse(String(value || '')))
    .filter(Number.isFinite);
  const targetMs = Date.parse(targetEndDate);
  const latestMs = candidates.length ? Math.max(...candidates) : targetMs - windowDays * 24 * 60 * 60 * 1000;
  const beginMs = Math.min(latestMs, targetMs) - REPORT_OVERLAP_DAYS * 24 * 60 * 60 * 1000;
  const endMs = Math.min(targetMs, beginMs + windowDays * 24 * 60 * 60 * 1000);
  return { beginDate: new Date(beginMs).toISOString(), endDate: new Date(endMs).toISOString() };
}

async function searchAllAccountMoneyReports(beginDate: string, endDate: string) {
  const reports: MercadoPagoReportTask[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < REPORT_SEARCH_MAX_PAGES; pageNumber += 1) {
    const page = await searchAccountMoneyReportsPage({
      beginDate,
      endDate,
      limit: REPORT_PAGE_SIZE,
      offset,
    });
    const current = Array.isArray(page.results) ? page.results : [];
    reports.push(...current);
    const total = Number(page.paging?.total);
    if (!current.length || (Number.isFinite(total) && reports.length >= total)) return reports;
    offset += current.length;
  }
  throw new MercadoPagoRequestError(502, 'invalid_response', 'O Mercado Pago retornou páginas demais para esta consulta.');
}

async function importCsv(fileName: string) {
  const service = createServiceClient();
  const csv = await downloadAccountMoneyReport(fileName);
  const rows = parseMercadoPagoAccountMoneyCsv(csv);

  let imported = 0;
  let rejected = 0;
  const errors: string[] = [];
  const validRows = rows.filter((row) => {
    if (!row.validationErrors.length) return true;
    rejected += 1;
    return false;
  });
  for (let offset = 0; offset < validRows.length; offset += IMPORT_BATCH_SIZE) {
    const batch = validRows.slice(offset, offset + IMPORT_BATCH_SIZE).map((row) => ({
        external_id: row.externalId,
        movement_date: row.movementDate,
        description: row.description,
        reference: row.reference,
        amount: row.amount,
        movement_type: row.movementType,
        currency: row.currency,
        raw_payload: { fileName, ...row.raw },
        updated_at: new Date().toISOString(),
      }));
    const { error: rawError } = await service.from('mercadopago_account_movements')
      .upsert(batch, { onConflict: 'external_id', defaultToNull: false });
    if (rawError) {
      errors.push(`Lote ${Math.floor(offset / IMPORT_BATCH_SIZE) + 1}: ${rawError.message}`);
      continue;
    }
    imported += batch.length;
  }

  return {
    success: errors.length === 0,
    mode: 'imported_file',
    fileName,
    imported,
    rejected,
    errors,
  };
}

async function responseForTask(
  task: MercadoPagoReportTask,
  beginDate: string | null,
  endDate: string | null,
  targetEndDate: string | null,
  windowDays: number,
  requestedTaskId?: string,
) {
  const taskId = resolveMercadoPagoReportTaskId(requestedTaskId, task.id);
  if (!taskId) throw new Error('Identificador inteiro da tarefa Mercado Pago ausente');
  const status = String(task.status || '').trim().toLowerCase();

  if (isMercadoPagoReportReady(status)) {
    const fileName = getMercadoPagoReportFileName(task);
    if (!fileName) throw new Error(`Tarefa Mercado Pago ${taskId} processada sem arquivo`);
    const imported = await importCsv(fileName);
    const nextWindow = imported.success && endDate && targetEndDate
      ? getNextMercadoPagoWindow({
          currentEndDate: endDate,
          targetEndDate,
          windowDays,
          overlapDays: REPORT_OVERLAP_DAYS,
        })
      : null;
    if (nextWindow) {
      return NextResponse.json({
        ...imported,
        success: true,
        deferred: true,
        mode: 'window_imported',
        message: 'Período importado. A atualização continuará pela próxima janela.',
        lifecycle: {
          state: 'next_window',
          beginDate: nextWindow.beginDate,
          endDate: nextWindow.endDate,
          targetEndDate,
          completedWindow: { beginDate, endDate },
          stages: ['download', 'import', 'window_complete'],
        },
      }, { status: 202 });
    }
    return NextResponse.json({
      ...imported,
      task,
      lifecycle: {
        state: imported.success ? 'complete' : 'import_failed',
        taskId,
        beginDate,
        endDate,
        targetEndDate,
        stages: imported.success
          ? ['processed', 'download', 'import', 'complete']
          : ['processed', 'download', 'import'],
      },
    });
  }

  if (!isMercadoPagoReportPending(status)) {
    throw new Error(`Status inesperado da tarefa Mercado Pago ${taskId}: ${status || 'ausente'}`);
  }

  return NextResponse.json({
    success: true,
    deferred: true,
    mode: 'report_processing',
    message: 'Relatório Mercado Pago ainda está em processamento.',
    task,
    lifecycle: {
      state: 'processing',
      taskId,
      beginDate,
      endDate,
      targetEndDate,
      stages: ['requested', 'processing'],
    },
  }, { status: 202 });
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  try {
    const bodyRaw = await request.json().catch(() => ({}));
    const body = isRecord(bodyRaw) ? bodyRaw : {};
    const windowDays = parsePositiveInt(body.windowDays, 7);
    const hasExplicitRange = typeof body.beginDate === 'string' || typeof body.endDate === 'string';
    const requestedRange = buildUtcRange(
      windowDays,
      typeof body.beginDate === 'string' ? body.beginDate : null,
      typeof body.endDate === 'string' ? body.endDate : null,
    );

    const directFileName = String(body.fileName || '').trim();
    if (directFileName) {
      return NextResponse.json(await importCsv(directFileName));
    }

    const syncJobId = String(body.syncJobId || '').trim();
    const resumeState = await getPersistedResumeState(syncJobId);
    const taskId = String(body.taskId || resumeState?.taskId || '').trim();
    const service = createServiceClient();
    const initialRange = resumeState
      ? { beginDate: resumeState.beginDate || requestedRange.beginDate, endDate: resumeState.endDate || requestedRange.endDate }
      : hasExplicitRange
        ? requestedRange
        : await getInitialScheduledRange(service, windowDays, requestedRange.endDate);
    const beginDate = initialRange.beginDate;
    const endDate = initialRange.endDate;
    const targetEndDate = resumeState?.targetEndDate || (resumeState ? endDate : requestedRange.endDate);
    if (taskId) {
      const task = await getAccountMoneyReportTask(taskId);
      return responseForTask(task, beginDate, endDate, targetEndDate, windowDays, taskId);
    }

    const reports = await searchAllAccountMoneyReports(beginDate, endDate);
    const sameRange = (report: any) => {
      const reportBegin = report?.begin_date ? new Date(report.begin_date).toISOString() : '';
      const reportEnd = report?.end_date ? new Date(report.end_date).toISOString() : '';
      return reportBegin === beginDate && reportEnd === endDate;
    };
    const matchingReports = reports.filter(sameRange);
    const ready = matchingReports.find((report) => (
      isMercadoPagoReportReady(report.status) && getMercadoPagoReportFileName(report)
    ));
    if (ready) {
      return responseForTask(ready, beginDate, endDate, targetEndDate, windowDays);
    }

    const pending = matchingReports.find((report) => isMercadoPagoReportPending(report.status));
    if (pending) {
      return responseForTask(pending, beginDate, endDate, targetEndDate, windowDays);
    }

    const task = await createAccountMoneyReport(beginDate, endDate);
    return NextResponse.json({
      success: true,
      deferred: true,
      mode: 'report_requested',
      message: 'Relatório Mercado Pago solicitado e mantido no mesmo job para processamento.',
      beginDate,
      endDate,
      task,
      lifecycle: {
        state: 'requested',
        taskId: String(task.id),
        beginDate,
        endDate,
        targetEndDate,
        stages: ['requested'],
      },
    }, { status: 202 });
  } catch (err: any) {
    const message = err?.message || 'Falha ao sincronizar Mercado Pago';
    if (err instanceof MercadoPagoRequestError && err.code === 'authentication') {
      return NextResponse.json({
        success: false,
        error: message,
        code: 'mercadopago_auth_failed',
        failure_reason: 'auth_fatal',
        auth_state: 'reauth_required',
        upstream_status: err.status,
      }, { status: 401 });
    }
    const status = err instanceof MercadoPagoRequestError && err.code === 'rate_limit' ? 429 : 500;
    return NextResponse.json({
      success: false,
      error: message,
      code: err instanceof MercadoPagoRequestError ? `mercadopago_${err.code}` : 'mercadopago_sync_failed',
      upstream_status: err instanceof MercadoPagoRequestError ? err.status : null,
    }, { status });
  }
}
