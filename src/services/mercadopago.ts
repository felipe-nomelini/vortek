import { createServiceClient } from '@/lib/supabase';
import { getValidMLToken } from '@/services/integration';

export {
  parseMercadoPagoAccountMoneyCsv,
  type MercadoPagoMovementRow,
} from '@/lib/mercadopago-account-money';

const MP_BASE_URL = 'https://api.mercadopago.com';

export interface MercadoPagoReportTask {
  id: number | string;
  status?: string;
  report_id?: number | null;
  file_name?: string | null;
  files?: Array<{
    type?: string | null;
    name?: string | null;
    url?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
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

async function mercadoPagoRequestWithToken<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
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

export async function mercadoPagoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getMercadoPagoAccessToken();
  return mercadoPagoRequestWithToken<T>(token, path, init);
}

export async function getMercadoPagoPaymentForMlSale(paymentId: string | number) {
  const cleanId = String(paymentId || '').trim();
  if (!cleanId) throw new Error('paymentId da venda Mercado Livre ausente');

  const token = await getValidMLToken();
  if (!token) throw new Error('Token Mercado Livre indisponível para consultar liberação do pagamento');

  return mercadoPagoRequestWithToken<Record<string, unknown>>(
    token,
    `/v1/payments/${encodeURIComponent(cleanId)}`,
    { method: 'GET' },
  );
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
