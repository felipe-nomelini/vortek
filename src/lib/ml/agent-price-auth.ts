import { createHmac, timingSafeEqual } from 'node:crypto';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function signAgentPriceRequest(secretHex: string, method: string, url: string, timestamp: string, body = ''): string {
  const secret = /^[a-f0-9]{64}$/i.test(secretHex) ? Buffer.from(secretHex, 'hex') : null;
  if (!secret) throw new Error('agent_price_secret_invalid');
  const target = new URL(url);
  return createHmac('sha256', secret)
    .update(`${method.toUpperCase()}\n${target.pathname}${target.search}\n${timestamp}\n${body}`)
    .digest('hex');
}

export function verifyAgentPriceRequest(request: Request, secretHex: string | undefined, body = '', now = Date.now()): boolean {
  const timestamp = request.headers.get('x-bentevi-agent-timestamp') || '';
  const signature = request.headers.get('x-bentevi-agent-signature') || '';
  if (!secretHex || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)
    || Math.abs(now - Number(timestamp)) > FIVE_MINUTES_MS) return false;
  let expected: string;
  try { expected = signAgentPriceRequest(secretHex, request.method, request.url, timestamp, body); }
  catch { return false; }
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
