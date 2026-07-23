import { createHmac, timingSafeEqual } from 'crypto';

function getSigningSecret(): string {
  const secret =
    process.env.PUBLIC_LABEL_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    '';
  if (!secret) {
    throw new Error('PUBLIC_LABEL_LINK_SECRET não configurado');
  }
  return secret;
}

export function createPublicShippingLabelToken(pedidoId: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(`label:${pedidoId}`)
    .digest('base64url');
}

export function verifyPublicShippingLabelToken(
  pedidoId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;

  const expected = createPublicShippingLabelToken(pedidoId);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function buildPublicShippingLabelUrl(
  baseUrl: string,
  pedidoId: string,
  format: 'pdf' | 'zpl2' = 'pdf',
): string {
  const token = createPublicShippingLabelToken(pedidoId);
  const formatParam = format === 'zpl2' ? '&format=zpl2' : '';
  return `${baseUrl}/api/public/etiquetas/${pedidoId}?token=${encodeURIComponent(token)}${formatParam}`;
}
