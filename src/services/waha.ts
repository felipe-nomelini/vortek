type WahaSessionStatus = 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string;

export interface WahaSession {
  name: string;
  status: WahaSessionStatus;
  me?: unknown;
  engine?: {
    engine?: string;
    WWebVersion?: string;
    state?: string;
  };
}

export interface WahaVersion {
  version?: string;
  engine?: string;
  tier?: string;
  browser?: string;
  platform?: string;
}

export interface WahaSendFileInput {
  chatId: string;
  caption: string;
  filename: string;
  mimetype: string;
  data: Buffer;
  session?: string;
}

export interface WahaSendTextInput {
  chatId: string;
  text: string;
  session?: string;
}

function getWahaConfig() {
  const baseUrl = String(process.env.WAHA_BASE_URL || process.env.WAHA_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.WAHA_API_KEY || '').trim();
  const session = String(process.env.WAHA_SESSION || 'default').trim() || 'default';

  if (!baseUrl) throw new Error('WAHA_BASE_URL não configurado');
  if (!apiKey) throw new Error('WAHA_API_KEY não configurado');

  return { baseUrl, apiKey, session };
}

async function wahaRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = getWahaConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = parsed?.message || parsed?.error || text || `WAHA HTTP ${res.status}`;
    throw new Error(`WAHA: ${message}`);
  }
  return parsed as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function normalizeWhatsappChatId(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Número de WhatsApp obrigatório');

  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  if (withCountry.length < 12 || withCountry.length > 13) {
    throw new Error('Número de WhatsApp inválido. Use DDD + número ou 55 + DDD + número.');
  }
  return `${withCountry}@c.us`;
}

export async function getWahaSessionStatus(sessionName?: string): Promise<WahaSession> {
  const { session } = getWahaConfig();
  const name = encodeURIComponent(sessionName || session);
  return wahaRequest<WahaSession>(`/api/sessions/${name}`);
}

export async function getWahaVersion(): Promise<WahaVersion> {
  return wahaRequest<WahaVersion>('/api/version');
}

export async function getWahaDiagnostics(sessionName?: string) {
  const [session, version] = await Promise.all([
    getWahaSessionStatus(sessionName),
    getWahaVersion().catch(() => null),
  ]);

  return {
    session: session.name,
    status: session.status,
    engine: session.engine?.engine || version?.engine || null,
    engineState: session.engine?.state || null,
    version: version?.version || null,
    tier: version?.tier || null,
    browser: version?.browser || null,
    platform: version?.platform || null,
  };
}

export async function getWahaQrPng(sessionName?: string): Promise<Buffer> {
  const { baseUrl, apiKey, session } = getWahaConfig();
  const name = encodeURIComponent(sessionName || session);
  const res = await fetch(`${baseUrl}/api/${name}/auth/qr?format=image`, {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = parsed?.message || parsed?.error || text || `WAHA HTTP ${res.status}`;
    throw new Error(`WAHA: ${message}`);
  }

  const rawData = String(parsed?.data || '');
  if (!rawData) throw new Error('WAHA não retornou QR Code');
  const prefix = 'data:image/png;base64,';
  const base64 = rawData.startsWith(prefix) ? rawData.slice(prefix.length) : rawData;
  return Buffer.from(base64, 'base64');
}

export async function ensureWahaSessionWorking(sessionName?: string) {
  const session = await getWahaSessionStatus(sessionName);
  if (session.status !== 'WORKING') {
    throw new Error(`Sessão WAHA "${session.name}" não está conectada. Status atual: ${session.status}`);
  }
  return session;
}

export async function sendWahaFile(input: WahaSendFileInput) {
  const { session } = getWahaConfig();
  const sessionName = input.session || session;
  await ensureWahaSessionWorking(sessionName);

  return wahaRequest('/api/sendFile', {
    method: 'POST',
    body: JSON.stringify({
      session: sessionName,
      chatId: input.chatId,
      caption: input.caption,
      file: {
        mimetype: input.mimetype,
        filename: input.filename,
        data: input.data.toString('base64'),
      },
    }),
  });
}

export async function sendWahaText(input: WahaSendTextInput) {
  const { session } = getWahaConfig();
  const sessionName = input.session || session;
  await ensureWahaSessionWorking(sessionName);

  return wahaRequest('/api/sendText', {
    method: 'POST',
    body: JSON.stringify({
      session: sessionName,
      chatId: input.chatId,
      text: input.text,
    }),
  });
}
