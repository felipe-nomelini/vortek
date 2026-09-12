import { getValidMLToken } from '@/services/integration';
import type { IntegrationTestResult } from '@/lib/integration-configuration';

export {
  parseMercadoPagoAccountMoneyCsv,
  type MercadoPagoMovementRow,
} from '@/lib/mercadopago-account-money';

const MP_BASE_URL = 'https://api.mercadopago.com';

export interface MercadoPagoReportTask {
  id: number | string;
  status?: string;
  begin_date?: string | null;
  end_date?: string | null;
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

export interface MercadoPagoReportSearchResult {
  results?: MercadoPagoReportTask[];
  paging?: { total?: number; offset?: number; limit?: number };
}

export class MercadoPagoRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: 'authentication' | 'rate_limit' | 'provider_error' | 'invalid_response',
    message: string,
  ) {
    super(message);
    this.name = 'MercadoPagoRequestError';
  }
}

export async function getMercadoPagoAccessToken() {
  return (await getValidMLToken()) || '';
}

async function mercadoPagoRequestWithToken<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  if (!token) {
    throw new MercadoPagoRequestError(401, 'authentication', 'Reconecte a conta Mercado Livre.');
  }

  const res = await fetcher(`${MP_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    if ([401, 403].includes(res.status)) {
      throw new MercadoPagoRequestError(res.status, 'authentication', 'A conta conectada não autorizou a consulta financeira.');
    }
    if (res.status === 429) {
      throw new MercadoPagoRequestError(res.status, 'rate_limit', 'O Mercado Pago pediu para aguardar antes de uma nova consulta.');
    }
    throw new MercadoPagoRequestError(res.status, 'provider_error', 'O Mercado Pago não concluiu a consulta financeira.');
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
  return mercadoPagoRequest<MercadoPagoReportSearchResult>(`/v1/account/settlement_report/search?${query.toString()}`, {
    method: 'GET',
  });
}

export async function searchAccountMoneyReportsPage(params: {
  beginDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params.beginDate) query.set('begin_date', params.beginDate);
  if (params.endDate) query.set('end_date', params.endDate);
  query.set('limit', String(Math.max(1, Math.min(100, Math.trunc(params.limit || 30)))));
  query.set('offset', String(Math.max(0, Math.trunc(params.offset || 0))));
  return mercadoPagoRequest<MercadoPagoReportSearchResult>(
    `/v1/account/settlement_report/search?${query.toString()}`,
    { method: 'GET' },
  );
}

export async function probeMercadoPagoReportAccess(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<IntegrationTestResult> {
  const result = (ok: boolean, code: string, message: string): IntegrationTestResult => ({
    ok,
    code,
    message,
    checkedAt: now.toISOString(),
    environment: 'production',
  });
  try {
    const token = await getMercadoPagoAccessToken();
    const data = await mercadoPagoRequestWithToken<MercadoPagoReportSearchResult>(
      token,
      '/v1/account/settlement_report/search?limit=1&offset=0',
      { method: 'GET' },
      fetcher,
    );
    if (!data || !Array.isArray(data.results)) {
      return result(false, 'invalid_response', 'O Mercado Pago não confirmou a lista de relatórios.');
    }
    return result(true, 'ok', 'Conexão financeira confirmada pela conta Mercado Livre.');
  } catch (error) {
    if (error instanceof MercadoPagoRequestError) return result(false, error.code, error.message);
    return result(false, 'network_error', 'Não foi possível consultar o Mercado Pago.');
  }
}

export async function downloadAccountMoneyReport(fileName: string) {
  return mercadoPagoRequest<string>(`/v1/account/settlement_report/${encodeURIComponent(fileName)}`, {
    method: 'GET',
    headers: { Accept: 'text/csv,application/csv,text/plain,*/*' },
  });
}
