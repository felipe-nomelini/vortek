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
  // A entrada de rede pertence ao produto; a descrição pode também informar a tensão DC do fan.
  const inputRange = text.match(/\b(?:tensao|voltagem)\s+(?:de\s+)?entrada\s*[:\-]?\s*(100|110|120|127)\s*(?:vac|v)?\s*[-/~a]\s*(220|240)\s*v(?:ac)?\b/);
  if (inputRange) return "127/220V";
  const adapterRange = text.match(/\b(?:adaptador|fonte)\s+(?:extern[ao]\s+)?bivolt\s*(?:automatic[oa]\s*)?[:\-]?\s*(?:ac\s*)?(100|110|120|127)\s*(?:vac|v)?\s*[-/~a]\s*(220|240)\s*v(?:ac)?\b/);
  if (adapterRange) return "127/220V";
  if (/\bbivolt\s+seletiv[oa]\b[^.]{0,100}\b(?:110|127)\s*v\s+ou\s+220\s*v\b/.test(text)) return "127/220V";
  if (/\b(?:alimentacao|tensao|voltagem)\s*[:\-]?\s*(110|120|127)\s*v?\s*\/\s*220\s*v\b/.test(text)) return "127/220V";
  const directDc = text.match(/\b(\d+(?:[.,]\d+)?)\s*vdc\b/);
  if (directDc?.[1]) {
    return `${directDc[1].replace(",", ".")} Vdc`;
  }
  const prefixedDc = text.match(/\bdc\s*(\d+(?:[.,]\d+)?)\s*v\b/);
  if (prefixedDc?.[1]) {
    return `${prefixedDc[1].replace(",", ".")} Vdc`;
  }
  const direct = text.match(/\b(110|120|127|220)\s*v\b/);
  if (direct?.[1]) return `${direct[1] === "120" ? "127" : direct[1]}V`;
  const labeled = text.match(
    /voltag(?:em)?[^\d]{0,20}(110|120|127|220)\s*v?/,
  );
  if (labeled?.[1]) return `${labeled[1] === "120" ? "127" : labeled[1]}V`;
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
    /(110|120|127|220)(?:\s*V)?(?:\/(110|120|127|220)(?:\s*V)?)?/i,
  );
  if (!match?.[1]) return raw;
  const first = match[1] === "120" ? "127" : match[1];
  const second = match[2] === "120" ? "127" : match[2];
  if (second) return `${first}/${second}V`;
  return `${first}V`;
}
