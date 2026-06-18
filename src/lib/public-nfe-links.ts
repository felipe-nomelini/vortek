import { createHmac, timingSafeEqual } from 'crypto';

type PublicNfePurpose = 'danfe' | 'xml';

function getSigningSecret(): string {
  const secret =
    process.env.PUBLIC_NFE_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    '';
  if (!secret) {
    throw new Error('PUBLIC_NFE_LINK_SECRET não configurado');
  }
  return secret;
}

export function createPublicNfeToken(pedidoId: string, purpose: PublicNfePurpose): string {
  return createHmac('sha256', getSigningSecret())
    .update(`${purpose}:${pedidoId}`)
    .digest('base64url');
}

export function verifyPublicNfeToken(
  pedidoId: string,
  purpose: PublicNfePurpose,
  token: string | null | undefined,
): boolean {
  if (!token) return false;

  const expected = createPublicNfeToken(pedidoId, purpose);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function buildPublicNfeUrl(baseUrl: string, pedidoId: string, purpose: PublicNfePurpose): string {
  const token = createPublicNfeToken(pedidoId, purpose);
  return `${baseUrl}/api/public/notas-fiscais/${pedidoId}/${purpose}?token=${encodeURIComponent(token)}`;
}
