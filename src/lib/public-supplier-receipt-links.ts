import { createHmac, timingSafeEqual } from 'crypto';

function getSigningSecret(): string {
  const secret =
    process.env.PUBLIC_SUPPLIER_RECEIPT_LINK_SECRET ||
    process.env.PUBLIC_LABEL_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    '';
  if (!secret) {
    throw new Error('PUBLIC_SUPPLIER_RECEIPT_LINK_SECRET não configurado');
  }
  return secret;
}

export function createPublicSupplierReceiptToken(compraId: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(`supplier_receipt:${compraId}`)
    .digest('base64url');
}

export function verifyPublicSupplierReceiptToken(
  compraId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;

  const expected = createPublicSupplierReceiptToken(compraId);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function buildPublicSupplierReceiptUrl(baseUrl: string, compraId: string): string {
  const token = createPublicSupplierReceiptToken(compraId);
  return `${String(baseUrl || '').replace(/\/+$/, '')}/api/public/comprovantes-fornecedor/${compraId}?token=${encodeURIComponent(token)}`;
}
