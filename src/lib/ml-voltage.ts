function normalizeText(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractStrictVoltage(input: unknown): string | null {
  const text = normalizeText(input);
  const directDc = text.match(/\b(\d+(?:[.,]\d+)?)\s*vdc\b/);
  if (directDc?.[1]) {
    return `${directDc[1].replace(",", ".")} Vdc`;
  }
  const prefixedDc = text.match(/\bdc\s*(\d+(?:[.,]\d+)?)\s*v\b/);
  if (prefixedDc?.[1]) {
    return `${prefixedDc[1].replace(",", ".")} Vdc`;
  }
  const direct = text.match(/\b(110|127|220)\s*v\b/);
  if (direct?.[1]) return `${direct[1]}V`;
  const labeled = text.match(/voltag(?:em)?[^\d]{0,20}(110|127|220)\s*v?/);
  if (labeled?.[1]) return `${labeled[1]}V`;
  return null;
}

export function normalizeVoltageValue(input: unknown): string | null {
  const raw = String(input ?? "").trim().toUpperCase();
  if (!raw) return null;
  const directDc = raw.match(/\b(\d+(?:[.,]\d+)?)\s*VDC\b/);
  if (directDc?.[1]) {
    return `${directDc[1].replace(",", ".")} Vdc`;
  }
  const prefixedDc = raw.match(/\bDC\s*(\d+(?:[.,]\d+)?)\s*V\b/);
  if (prefixedDc?.[1]) {
    return `${prefixedDc[1].replace(",", ".")} Vdc`;
  }
  const match = raw.match(
    /(110|127|220)(?:\s*V)?(?:\/(110|127|220)(?:\s*V)?)?/i,
  );
  if (!match?.[1]) return raw;
  if (match[2]) return `${match[1]}/${match[2]}V`;
  return `${match[1]}V`;
}
