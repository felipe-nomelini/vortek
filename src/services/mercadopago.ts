import crypto from 'node:crypto';
import { MercadoPagoConfig } from 'mercadopago';
import { createServiceClient } from '@/lib/supabase';

const MP_BASE_URL = 'https://api.mercadopago.com';

export interface MercadoPagoReportTask {
  id: number;
  status?: string;
  report_id?: number | null;
  file_name?: string | null;
  [key: string]: unknown;
}

export interface MercadoPagoMovementRow {
  externalId: string;
  movementDate: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  movementType: string | null;
  currency: string | null;
  raw: Record<string, string>;
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
  if (!value) return 0;
  const clean = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
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

    const date = parseDate(firstValue(raw, [
      'date', 'data', 'movement_date', 'transaction_date', 'settlement_date', 'creation_date',
    ]));
    const description = firstValue(raw, [
      'description', 'descricao', 'detail', 'detalhe', 'transaction_detail', 'operation_detail', 'tipo_de_operacao',
    ]);
    const reference = firstValue(raw, [
      'reference', 'referencia', 'external_reference', 'source_id', 'transaction_id', 'payment_id', 'id',
    ]);
    const amount = parseMoney(firstValue(raw, [
      'net_amount', 'gross_amount', 'amount', 'valor', 'transaction_amount', 'money_amount',
    ]));
    const currency = firstValue(raw, ['currency', 'currency_id', 'moeda']);
    const movementType = firstValue(raw, ['type', 'tipo', 'operation_type', 'movement_type']);
    const hashSource = JSON.stringify({ date, description, reference, amount, raw });
    const externalId = reference || crypto.createHash('sha256').update(hashSource).digest('hex');

    return {
      externalId,
      movementDate: date,
      description,
      reference,
      amount,
      movementType,
      currency,
      raw,
    };
  });
}

export async function getMercadoPagoAccessToken() {
  const envToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;

  const service = createServiceClient();
  const { data, error } = await service
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadopago')
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler integração Mercado Pago: ${error.message}`);
  return String(data?.access_token || '').trim();
}

export async function getMercadoPagoClient() {
  const accessToken = await getMercadoPagoAccessToken();
  if (!accessToken) {
    throw new Error('Mercado Pago não configurado. Informe access_token em integracoes ou MERCADOPAGO_ACCESS_TOKEN.');
  }

  return new MercadoPagoConfig({ accessToken });
}

export async function mercadoPagoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getMercadoPagoAccessToken();
  if (!token) {
    throw new Error('Mercado Pago não configurado. Informe access_token em integracoes ou MERCADOPAGO_ACCESS_TOKEN.');
  }

  const res = await fetch(`${MP_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mercado Pago HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json() as T;
  }
  return await res.text() as T;
}

export async function getMercadoPagoPayment(paymentId: string | number) {
  const cleanId = String(paymentId || '').trim();
  if (!cleanId) throw new Error('paymentId Mercado Pago ausente');
  return mercadoPagoRequest<Record<string, unknown>>(`/v1/payments/${encodeURIComponent(cleanId)}`, {
    method: 'GET',
  });
}

export function buildUtcRange(windowDays = 7, beginDate?: string | null, endDate?: string | null) {
  const end = endDate ? new Date(endDate) : new Date();
  const begin = beginDate ? new Date(beginDate) : new Date(end.getTime() - Math.max(1, windowDays) * 24 * 60 * 60 * 1000);
  return {
    beginDate: begin.toISOString(),
    endDate: end.toISOString(),
  };
}

export async function createAccountMoneyReport(beginDate: string, endDate: string) {
  return mercadoPagoRequest<MercadoPagoReportTask>('/v1/account/settlement_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: beginDate, end_date: endDate }),
  });
}

export async function getAccountMoneyReportTask(taskId: string | number) {
  return mercadoPagoRequest<MercadoPagoReportTask>(`/v1/account/settlement_report/task/${taskId}`);
}

export async function searchAccountMoneyReports(params: { beginDate?: string; endDate?: string; fileName?: string; id?: string | number }) {
  const query = new URLSearchParams();
  if (params.beginDate) query.set('begin_date', params.beginDate);
  if (params.endDate) query.set('end_date', params.endDate);
  if (params.fileName) query.set('file_name', params.fileName);
  if (params.id) query.set('id', String(params.id));
  return mercadoPagoRequest<{ results?: MercadoPagoReportTask[] }>(`/v1/account/settlement_report/search?${query.toString()}`, {
    method: 'GET',
  });
}

export async function downloadAccountMoneyReport(fileName: string) {
  return mercadoPagoRequest<string>(`/v1/account/settlement_report/${encodeURIComponent(fileName)}`, {
    method: 'GET',
    headers: { Accept: 'text/csv,application/csv,text/plain,*/*' },
  });
}
