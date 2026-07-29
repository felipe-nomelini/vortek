import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_PURPOSE = "evolusom-missing-gtin";

function getSigningSecret() {
  const secret =
    process.env.PUBLIC_EVOLUSOM_GTIN_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    "";
  if (!secret) {
    throw new Error("PUBLIC_EVOLUSOM_GTIN_LINK_SECRET não configurado");
  }
  return secret;
}

export function createPublicEvolusomGtinToken(expiresAt: string) {
  return createHmac("sha256", getSigningSecret())
    .update(`${TOKEN_PURPOSE}:${expiresAt}`)
    .digest("base64url");
}

export function verifyPublicEvolusomGtinToken(
  token: string | null | undefined,
  expiresAt: string | null | undefined,
) {
  if (
    !token ||
    !expiresAt ||
    Number.isNaN(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) < Date.now()
  ) {
    return false;
  }

  const expected = createPublicEvolusomGtinToken(expiresAt);
  const receivedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function buildPublicEvolusomGtinUrl(
  baseUrl: string,
  expiresAt: string,
) {
  const token = createPublicEvolusomGtinToken(expiresAt);
  return `${String(baseUrl).replace(/\/+$/, "")}/fornecedor/evolusom/produtos-sem-gtin?expires=${encodeURIComponent(expiresAt)}&token=${encodeURIComponent(token)}`;
}
