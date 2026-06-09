import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  buildUtcRange,
  createAccountMoneyReport,
  downloadAccountMoneyReport,
  getAccountMoneyReportTask,
  parseMercadoPagoAccountMoneyCsv,
  searchAccountMoneyReports,
  type MercadoPagoMovementRow,
} from '@/services/mercadopago';
import { HAYAMAX_FORNECEDOR_ID, normalizeMoneyAmount } from '@/lib/supplier-balance';

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

function hayamaxMatchers() {
  return (process.env.MERCADOPAGO_HAYAMAX_MATCHERS || 'hayamax')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isHayamaxTopupCandidate(row: MercadoPagoMovementRow) {
  const text = [
    row.description,
    row.reference,
    row.movementType,
    ...Object.values(row.raw),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matchedByText = hayamaxMatchers().some((token) => text.includes(token));
  const enoughValue = Math.abs(row.amount) >= 1000;
  return matchedByText && enoughValue;
}

async function importCsv(fileName: string) {
  const service = createServiceClient();
  const csv = await downloadAccountMoneyReport(fileName);
  const rows = parseMercadoPagoAccountMoneyCsv(csv);

  let imported = 0;
  let topups = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const matchedSupplier = isHayamaxTopupCandidate(row) ? 'HAYAMAX' : null;
    const amount = normalizeMoneyAmount(row.amount);

    const { data: rawMovement, error: rawError } = await service
      .from('mercadopago_account_movements')
      .upsert({
        external_id: row.externalId,
        movement_date: row.movementDate,
        description: row.description,
        reference: row.reference,
        amount,
        movement_type: row.movementType,
        currency: row.currency,
        raw_payload: { fileName, ...row.raw },
        matched_supplier: matchedSupplier,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id' })
      .select('id, supplier_balance_movement_id')
      .maybeSingle();

    if (rawError) {
      errors.push(`raw:${row.externalId}:${rawError.message}`);
      continue;
    }

    imported += 1;
    if (!matchedSupplier || rawMovement?.supplier_balance_movement_id) continue;

    const topupAmount = Math.abs(amount);
    const movementKey = `mercadopago:${row.externalId}`;
    const { data: existing, error: existingError } = await service
      .from('supplier_balance_movements')
      .select('id')
      .eq('movement_key', movementKey)
      .maybeSingle();

    if (existingError) {
      errors.push(`balance_lookup:${row.externalId}:${existingError.message}`);
      continue;
    }

    let movementId = existing?.id || null;
    if (!movementId) {
      const { data: inserted, error: insertError } = await service
        .from('supplier_balance_movements')
        .insert({
          fornecedor_id: HAYAMAX_FORNECEDOR_ID,
          fornecedor_nome: 'HAYAMAX',
          movement_type: 'topup',
          amount: topupAmount,
          reference: row.reference || row.description || `Mercado Pago ${row.externalId}`,
          notes: `Baixa automática Mercado Pago. Arquivo: ${fileName}`,
          created_by: 'mercadopago:account_money',
          movement_key: movementKey,
        })
        .select('id')
        .maybeSingle();

      if (insertError) {
        errors.push(`balance_insert:${row.externalId}:${insertError.message}`);
        continue;
      }
      movementId = inserted?.id || null;
      topups += 1;
    }

    if (movementId && rawMovement?.id) {
      await service
        .from('mercadopago_account_movements')
        .update({ supplier_balance_movement_id: movementId, updated_at: new Date().toISOString() })
        .eq('id', rawMovement.id);
    }
  }

  return {
    success: errors.length === 0,
    mode: 'imported_file',
    fileName,
    imported,
    topups,
    errors,
  };
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
    const { beginDate, endDate } = buildUtcRange(
      windowDays,
      typeof body.beginDate === 'string' ? body.beginDate : null,
      typeof body.endDate === 'string' ? body.endDate : null,
    );

    const directFileName = String(body.fileName || '').trim();
    if (directFileName) {
      return NextResponse.json(await importCsv(directFileName));
    }

    const taskId = String(body.taskId || '').trim();
    if (taskId) {
      const task = await getAccountMoneyReportTask(taskId);
      if (task.status === 'processed' && task.file_name) {
        return NextResponse.json({ ...(await importCsv(task.file_name)), task });
      }
      return NextResponse.json({
        success: true,
        mode: 'task_pending',
        message: 'Relatório Mercado Pago ainda não processado.',
        task,
      });
    }

    const search = await searchAccountMoneyReports({ beginDate, endDate });
    const sameRange = (report: any) => {
      const reportBegin = report?.begin_date ? new Date(report.begin_date).toISOString() : '';
      const reportEnd = report?.end_date ? new Date(report.end_date).toISOString() : '';
      return reportBegin === beginDate && reportEnd === endDate;
    };
    const matchingReports = (search.results || []).filter(sameRange);
    const ready = matchingReports.find((report) => report.status === 'processed' && report.file_name);
    if (ready?.file_name) {
      return NextResponse.json({ ...(await importCsv(ready.file_name)), report: ready });
    }

    const pending = matchingReports.find((report) => report.status && report.status !== 'processed');
    if (pending) {
      return NextResponse.json({
        success: true,
        mode: 'report_pending',
        message: 'Relatório Mercado Pago ainda não processado.',
        beginDate,
        endDate,
        report: pending,
      }, { status: 202 });
    }

    const task = await createAccountMoneyReport(beginDate, endDate);
    return NextResponse.json({
      success: true,
      mode: 'report_requested',
      message: 'Relatório Mercado Pago solicitado. Rode novamente após processamento.',
      beginDate,
      endDate,
      task,
    }, { status: 202 });
  } catch (err: any) {
    const message = err?.message || 'Falha ao sincronizar Mercado Pago';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
