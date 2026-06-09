const SKU_PREFIXOS: Record<string, string> = {
  '2': 'HYX',
  '27': 'FJ',
  '39': 'NMC',
  '81': 'VO',
};

export function normalizeSku(input: unknown): string {
  return String(input ?? '').trim().toUpperCase();
}

export function getFornecedorSkuPrefix(fornecedorId: number | string): string {
  return SKU_PREFIXOS[String(fornecedorId)] || '';
}

export function buildCanonicalDsliteSku(
  fornecedorId: number | string,
  produtoIdEmpresa: unknown,
  produtoId?: unknown,
): string {
  const rawBase = produtoIdEmpresa || produtoId || `PROD-${String(produtoId ?? '')}`;
  const normalizedBase = stripKnownSkuPrefix(normalizeSku(rawBase));
  return normalizeSku(normalizedBase);
}

export function stripKnownSkuPrefix(sku: string): string {
  const normalized = normalizeSku(sku);
  const prefixes = Object.values(SKU_PREFIXOS).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

export function getSkuLookupVariants(input: unknown): string[] {
  const normalized = normalizeSku(input);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const withoutPrefix = stripKnownSkuPrefix(normalized);
  if (withoutPrefix) variants.add(withoutPrefix);

  return Array.from(variants);
}
