import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  buildUtcRange,
  createAccountMoneyReport,
  downloadAccountMoneyReport,
  getAccountMoneyReportTask,
  searchAccountMoneyReports,
  type MercadoPagoReportTask,
} from '@/services/mercadopago';
import {
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

async function importCsv(fileName: string) {
  const service = createServiceClient();
  const csv = await downloadAccountMoneyReport(fileName);
  const rows = parseMercadoPagoAccountMoneyCsv(csv);

  let imported = 0;
  let rejected = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (row.validationErrors.length > 0) {
      rejected += 1;
      continue;
    }

    const { error: rawError } = await service
      .from('mercadopago_account_movements')
      .upsert({
        external_id: row.externalId,
        movement_date: row.movementDate,
        description: row.description,
        reference: row.reference,
        amount: row.amount,
        movement_type: row.movementType,
        currency: row.currency,
        raw_payload: { fileName, ...row.raw },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id', defaultToNull: false });

    if (rawError) {
      errors.push(`raw:${row.externalId}:${rawError.message}`);
      continue;
    }

    imported += 1;
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
  requestedTaskId?: string,
) {
  const taskId = resolveMercadoPagoReportTaskId(requestedTaskId, task.id);
  if (!taskId) throw new Error('Identificador inteiro da tarefa Mercado Pago ausente');
  const status = String(task.status || '').trim().toLowerCase();

  if (isMercadoPagoReportReady(status)) {
    const fileName = getMercadoPagoReportFileName(task);
    if (!fileName) throw new Error(`Tarefa Mercado Pago ${taskId} processada sem arquivo`);
    const imported = await importCsv(fileName);
    return NextResponse.json({
      ...imported,
      task,
      lifecycle: {
        state: imported.success ? 'complete' : 'import_failed',
        taskId,
        beginDate,
        endDate,
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
    const beginDate = resumeState?.beginDate || requestedRange.beginDate;
    const endDate = resumeState?.endDate || requestedRange.endDate;
    if (taskId) {
      const task = await getAccountMoneyReportTask(taskId);
      return responseForTask(task, beginDate, endDate, taskId);
    }

    const search = await searchAccountMoneyReports({ beginDate, endDate });
    const sameRange = (report: any) => {
      const reportBegin = report?.begin_date ? new Date(report.begin_date).toISOString() : '';
      const reportEnd = report?.end_date ? new Date(report.end_date).toISOString() : '';
      return reportBegin === beginDate && reportEnd === endDate;
    };
    const matchingReports = (search.results || []).filter(sameRange);
    const ready = matchingReports.find((report) => (
      isMercadoPagoReportReady(report.status) && getMercadoPagoReportFileName(report)
    ));
    if (ready) {
      return responseForTask(ready, beginDate, endDate);
    }

    const pending = matchingReports.find((report) => isMercadoPagoReportPending(report.status));
    if (pending) {
      return responseForTask(pending, beginDate, endDate);
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
        stages: ['requested'],
      },
    }, { status: 202 });
  } catch (err: any) {
    const message = err?.message || 'Falha ao sincronizar Mercado Pago';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
