import { createHmac, timingSafeEqual } from "crypto";

function getSigningSecret() {
  const secret =
    process.env.PUBLIC_BKR1_KIT_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    "";
  if (!secret) throw new Error("PUBLIC_BKR1_KIT_LINK_SECRET não configurado");
  return secret;
}

export function createPublicBkr1KitToken(expiresAt: string) {
  return createHmac("sha256", getSigningSecret())
    .update(`bkr1-kit-gtin:${expiresAt}`)
    .digest("base64url");
}

export function verifyPublicBkr1KitToken(token: string | null | undefined, expiresAt: string | null | undefined) {
  if (!token || !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) < Date.now()) return false;
  const expected = createPublicBkr1KitToken(expiresAt);
  const receivedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function buildPublicBkr1KitUrl(baseUrl: string, expiresAt: string) {
  const token = createPublicBkr1KitToken(expiresAt);
  return `${String(baseUrl).replace(/\/+$/, "")}/fornecedor/bkr1/kits-sem-anuncio?expires=${encodeURIComponent(expiresAt)}&token=${encodeURIComponent(token)}`;
}
