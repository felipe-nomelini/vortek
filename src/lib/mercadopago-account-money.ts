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
  taskId: string;
  beginDate: string | null;
  endDate: string | null;
}

export function resolveMercadoPagoReportTaskId(preferred: unknown, fallback?: unknown) {
  for (const value of [preferred, fallback]) {
    const taskId = String(value || '').trim();
    if (/^[1-9]\d*$/.test(taskId)) return taskId;
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

export function parseMercadoPagoAccountMoneyCsv(csv: string): MercadoPagoMovementRow[] {
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
    const settlementNetAmount = parseMoney(firstValue(raw, ['settlement_net_amount']));
    const transactionAmount = parseMoney(firstValue(raw, ['transaction_amount']));
    const currency = firstValue(raw, ['settlement_currency'])?.toUpperCase() || null;
    const transactionCurrency = firstValue(raw, ['transaction_currency'])?.toUpperCase() || null;
    const movementType = firstValue(raw, ['transaction_type'])?.toUpperCase() || null;
    const validationErrors: string[] = [];

    if (!sourceId) validationErrors.push('missing_source_id');
    if (settlementNetAmount === null) validationErrors.push('invalid_settlement_net_amount');
    if (!movementType) validationErrors.push('missing_transaction_type');
    if (!currency) validationErrors.push('missing_settlement_currency');
    if (transactionCurrency && currency && transactionCurrency !== currency) {
      validationErrors.push('currency_mismatch');
    }

    const hashSource = JSON.stringify({ date, description, reference, settlementNetAmount, raw });
    const externalId = sourceId || crypto.createHash('sha256').update(hashSource).digest('hex');

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

function rowSearchText(row: MercadoPagoMovementRow) {
  return [row.description, row.reference, row.movementType, ...Object.values(row.raw)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesSupplier(row: MercadoPagoMovementRow, matchers: string[]) {
  const text = rowSearchText(row);
  const digits = text.replace(/\D+/g, '');
  return matchers.some((token) => {
    const clean = token.trim().toLowerCase();
    if (!clean) return false;
    const tokenDigits = clean.replace(/\D+/g, '');
    return text.includes(clean) || (tokenDigits.length >= 8 && digits.includes(tokenDigits));
  });
}

export function isHayamaxTopupCandidate(
  row: MercadoPagoMovementRow,
  matchers: string[],
  minimumAmount: number,
) {
  return row.validationErrors.length === 0
    && row.currency === 'BRL'
    && row.amount < 0
    && Math.abs(row.amount) >= minimumAmount
    && (row.movementType === 'PAYOUT' || row.movementType === 'WITHDRAWAL')
    && matchesSupplier(row, matchers);
}

export function isReviewRequiredCandidate(row: MercadoPagoMovementRow, minimumAmount: number) {
  if (row.validationErrors.length > 0) return false;
  const text = rowSearchText(row);
  const enoughValue = Math.abs(row.amount) >= minimumAmount;
  const looksLikeOutgoingBill = row.amount < 0 || /boleto|conta|pagamento|bill|invoice/.test(text);
  return enoughValue && looksLikeOutgoingBill;
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
    const taskId = resolveMercadoPagoReportTaskId(lifecycle?.taskId, task?.id);
    if (!taskId) continue;
    return {
      taskId,
      beginDate: String(lifecycle?.beginDate || record.beginDate || '').trim() || null,
      endDate: String(lifecycle?.endDate || record.endDate || '').trim() || null,
    };
  }
  return null;
}

export function isMercadoPagoReportPending(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing';
}
