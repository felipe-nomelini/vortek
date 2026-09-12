import crypto from 'node:crypto';

export interface MercadoPagoMovementRow {
  externalId: string;
  movementDate: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  transactionAmount: number | null;
  movementType: string | null;
  currency: string | null;
  transactionCurrency: string | null;
  validationErrors: string[];
  raw: Record<string, string>;
}

export interface MercadoPagoReportResumeState {
  taskId: string | null;
  beginDate: string | null;
  endDate: string | null;
  targetEndDate?: string | null;
}

export interface MercadoPagoAccountMoneyParseOptions {
  defaultCurrency?: string | null;
}

export interface MercadoPagoMovementDeduplication {
  rows: MercadoPagoMovementRow[];
  ignoredExactDuplicates: number;
  conflictingDuplicates: number;
}

export function resolveMercadoPagoReportTaskId(preferred: unknown, fallback?: unknown) {
  for (const value of [preferred, fallback]) {
    const taskId = String(value || '').trim();
    if (/^[1-9]\d*$/.test(taskId)) return taskId;
  }
  return null;
}

export function isMercadoPagoReportReady(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'processed' || normalized === 'available';
}

export function getMercadoPagoReportFileName(task: unknown) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
  const record = task as Record<string, unknown>;
  const officialFileName = String(record.file_name || '').trim();
  if (officialFileName) return officialFileName;
  if (!Array.isArray(record.files)) return null;

  for (const file of record.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) continue;
    const candidate = file as Record<string, unknown>;
    const type = String(candidate.type || '').trim().toLowerCase();
    const name = String(candidate.name || '').trim();
    if (type === 'csv' && name) return name;
  }
  return null;
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function parseMoney(value: string | null) {
  if (!value) return null;
  let clean = value.replace(/[^\d,.-]/g, '');
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    clean = lastComma > lastDot
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  } else if (lastComma >= 0) {
    clean = clean.replace(',', '.');
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`).toISOString();
}

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseMercadoPagoAccountMoneyCsv(
  csv: string,
  options: MercadoPagoAccountMoneyParseOptions = {},
): MercadoPagoMovementRow[] {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0) ? ';' : ',';
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      raw[header || `column_${index}`] = cells[index] || '';
    });

    const sourceId = firstValue(raw, ['source_id']);
    const date = parseDate(firstValue(raw, ['settlement_date', 'transaction_date']));
    const description = firstValue(raw, ['description']);
    const reference = firstValue(raw, ['external_reference', 'source_id']);
    const settlementNetAmount = parseMoney(firstValue(raw, ['settlement_net_amount', 'real_amount']));
    const transactionAmount = parseMoney(firstValue(raw, ['transaction_amount']));
    const currency = firstValue(raw, ['settlement_currency'])?.toUpperCase()
      || String(options.defaultCurrency || '').trim().toUpperCase()
      || null;
    const transactionCurrency = firstValue(raw, ['transaction_currency'])?.toUpperCase() || null;
    const movementType = firstValue(raw, ['transaction_type'])?.toUpperCase() || null;
    const validationErrors: string[] = [];

    if (!sourceId) validationErrors.push('missing_source_id');
    if (settlementNetAmount === null) validationErrors.push('invalid_settlement_net_amount');
    if (!currency) validationErrors.push('missing_settlement_currency');
    if (transactionCurrency && currency && transactionCurrency !== currency) {
      validationErrors.push('currency_mismatch');
    }

    const movementIdentity = sourceId
      ? {
          sourceId,
          movementType,
          settlementDate: date,
          settlementNetAmount,
          settlementCurrency: currency,
        }
      : { date, description, reference, settlementNetAmount, raw };
    const externalId = crypto
      .createHash('sha256')
      .update(JSON.stringify(movementIdentity))
      .digest('hex');

    return {
      externalId,
      movementDate: date,
      description,
      reference,
      amount: settlementNetAmount ?? 0,
      transactionAmount,
      movementType,
      currency,
      transactionCurrency,
      validationErrors,
      raw,
    };
  });
}

export function deduplicateMercadoPagoMovementRows(
  rows: MercadoPagoMovementRow[],
): MercadoPagoMovementDeduplication {
  const unique = new Map<string, MercadoPagoMovementRow>();
  let ignoredExactDuplicates = 0;
  let conflictingDuplicates = 0;

  for (const row of rows) {
    const existing = unique.get(row.externalId);
    if (!existing) {
      unique.set(row.externalId, row);
      continue;
    }
    if (JSON.stringify(existing.raw) === JSON.stringify(row.raw)) {
      ignoredExactDuplicates += 1;
    } else {
      conflictingDuplicates += 1;
    }
  }

  return {
    rows: [...unique.values()],
    ignoredExactDuplicates,
    conflictingDuplicates,
  };
}

function parseJobLog(log: unknown): unknown[] {
  if (Array.isArray(log)) return log;
  if (typeof log !== 'string') return [];
  try {
    const parsed = JSON.parse(log || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getMercadoPagoReportResumeState(log: unknown): MercadoPagoReportResumeState | null {
  const entries = parseJobLog(log);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const task = record.task && typeof record.task === 'object' && !Array.isArray(record.task)
      ? record.task as Record<string, unknown>
      : record.report && typeof record.report === 'object' && !Array.isArray(record.report)
        ? record.report as Record<string, unknown>
        : null;
    const lifecycle = record.lifecycle && typeof record.lifecycle === 'object' && !Array.isArray(record.lifecycle)
      ? record.lifecycle as Record<string, unknown>
      : null;
    const lifecycleState = String(lifecycle?.state || '').trim();
    if (lifecycleState === 'next_window') {
      const beginDate = String(lifecycle?.beginDate || '').trim() || null;
      const endDate = String(lifecycle?.endDate || '').trim() || null;
      if (beginDate && endDate) return {
        taskId: null,
        beginDate,
        endDate,
        targetEndDate: String(lifecycle?.targetEndDate || '').trim() || null,
      };
    }
    const taskId = resolveMercadoPagoReportTaskId(lifecycle?.taskId, task?.id);
    if (!taskId) continue;
    const targetEndDate = String(lifecycle?.targetEndDate || '').trim() || null;
    return {
      taskId,
      beginDate: String(lifecycle?.beginDate || record.beginDate || '').trim() || null,
      endDate: String(lifecycle?.endDate || record.endDate || '').trim() || null,
      ...(targetEndDate ? { targetEndDate } : {}),
    };
  }
  return null;
}

export function getMercadoPagoCompletedWindowEnd(log: unknown): string | null {
  const entries = parseJobLog(log);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const lifecycle = (entry as Record<string, unknown>).lifecycle;
    if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) continue;
    const record = lifecycle as Record<string, unknown>;
    if (!['complete', 'window_complete'].includes(String(record.state || ''))) continue;
    const endDate = String(record.endDate || '').trim();
    if (Number.isFinite(Date.parse(endDate))) return new Date(endDate).toISOString();
  }
  return null;
}

export function getNextMercadoPagoWindow(input: {
  currentEndDate: string;
  targetEndDate: string;
  windowDays?: number;
  overlapDays?: number;
}) {
  const currentEnd = Date.parse(input.currentEndDate);
  const targetEnd = Date.parse(input.targetEndDate);
  if (!Number.isFinite(currentEnd) || !Number.isFinite(targetEnd) || currentEnd >= targetEnd) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const begin = currentEnd - Math.max(0, input.overlapDays ?? 1) * dayMs;
  const end = Math.min(targetEnd, begin + Math.max(1, input.windowDays || 7) * dayMs);
  if (end <= currentEnd) return null;
  return { beginDate: new Date(begin).toISOString(), endDate: new Date(end).toISOString() };
}

export function isMercadoPagoReportForRange(
  report: { begin_date?: unknown; end_date?: unknown } | null | undefined,
  beginDate: string,
  endDate: string,
  boundaryToleranceMs = 36 * 60 * 60 * 1000,
) {
  const requestedBegin = Date.parse(beginDate);
  const requestedEnd = Date.parse(endDate);
  const reportBegin = Date.parse(String(report?.begin_date || ''));
  const reportEnd = Date.parse(String(report?.end_date || ''));
  if (![requestedBegin, requestedEnd, reportBegin, reportEnd].every(Number.isFinite)) return false;
  return reportBegin <= requestedBegin
    && reportEnd >= requestedEnd
    && requestedBegin - reportBegin <= boundaryToleranceMs
    && reportEnd - requestedEnd <= boundaryToleranceMs;
}

export function isMercadoPagoReportPending(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing';
}
