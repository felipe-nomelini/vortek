export const VORTEK_SKU_PATTERN = /^VTK\d{6}$/;

export function normalizeVortekSku(input: unknown): string {
  return String(input || '').trim().toUpperCase();
}

export function isVortekSku(input: unknown): boolean {
  return VORTEK_SKU_PATTERN.test(normalizeVortekSku(input));
}

export function assertVortekSku(input: unknown): string {
  const sku = normalizeVortekSku(input);
  if (!isVortekSku(sku)) {
    throw new Error('SKU mestre deve seguir o padrão VTK000001.');
  }
  return sku;
}
