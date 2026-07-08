const CRITICAL_ML_ATTRIBUTE_IDS = new Set([
  "VOLTAGE",
  "NOMINAL_VOLTAGE",
  "PACKAGES_NUMBER",
  "PACKAGING_BOXES_NUMBER",
]);

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isMlCriticalAttributeId(input: unknown): boolean {
  return CRITICAL_ML_ATTRIBUTE_IDS.has(String(input || "").trim().toUpperCase());
}

export function extractStrictVoltage(input: unknown): string | null {
  const text = normalizeText(input);
  const direct = text.match(/\b(110|127|220)\s*v\b/);
  if (direct?.[1]) return `${direct[1]}V`;
  const labeled = text.match(/voltag(?:em)?[^\d]{0,20}(110|127|220)\s*v?/);
  if (labeled?.[1]) return `${labeled[1]}V`;
  return null;
}

export function normalizeVoltageValue(input: unknown): string | null {
  const raw = String(input ?? "").trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/(110|127|220)(?:\s*V)?(?:\/(110|127|220)(?:\s*V)?)?/i);
  if (!match?.[1]) return raw;
  if (match[2]) return `${match[1]}/${match[2]}V`;
  return `${match[1]}V`;
}

export function extractPackagesNumber(input: unknown): number | null {
  const text = normalizeText(input);
  const explicit = text.match(/\b(?:contendo|conteudo da embalagem|conteudo embalagem|embalagem|caixas?)\s*[:\-]?\s*(\d{1,2})\s*caix/);
  if (explicit?.[1]) return Number(explicit[1]);
  if ((text.includes("ar condicionado") || text.includes("ar-condicionado")) && text.includes("split")) {
    return 2;
  }
  return null;
}

export function normalizeCriticalAttributeValue(
  attrId: unknown,
  value: unknown,
): string | null {
  const id = String(attrId || "").trim().toUpperCase();
  if (!value && value !== 0) return null;
  if (id === "VOLTAGE" || id === "NOMINAL_VOLTAGE") {
    return normalizeVoltageValue(value);
  }
  if (id === "PACKAGES_NUMBER" || id === "PACKAGING_BOXES_NUMBER") {
    const numeric = Number(String(value).match(/\d+/)?.[0]);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : null;
  }
  return String(value).trim() || null;
}

function choosePreferredOffer(offers: any[], preferredOfferId: unknown) {
  const explicitId = String(preferredOfferId || "").trim();
  if (explicitId) {
    const explicit = offers.find((offer) => String(offer?.id || "").trim() === explicitId);
    const hasAlt = offers.some(
      (offer) =>
        String(offer?.id || "").trim() !== explicitId &&
        offer?.ativo !== false &&
        Number(offer?.estoque || 0) > 0,
    );
    if (
      explicit &&
      explicit.ativo !== false &&
      (Number(explicit.estoque || 0) > 0 || !hasAlt)
    ) {
      return explicit;
    }
  }
  const active = offers.filter((offer) => offer?.ativo !== false);
  const source = active.length > 0 ? active : offers;
  const withStock = source.filter((offer) => Number(offer?.estoque || 0) > 0);
  const eligible = withStock.length > 0 ? withStock : source;
  return (
    [...eligible].sort((a, b) => {
      const costDiff = Number(a?.custo || 0) - Number(b?.custo || 0);
      if (costDiff !== 0) return costDiff;
      const priorityDiff =
        Math.trunc(Number(a?.prioridade || 100)) -
        Math.trunc(Number(b?.prioridade || 100));
      if (priorityDiff !== 0) return priorityDiff;
      return Number(b?.estoque || 0) - Number(a?.estoque || 0);
    })[0] || null
  );
}

export function resolveMlCriticalFacts(produto: any, offers: any[] = []) {
  const safeOffers = Array.isArray(offers) ? offers : [];
  const preferredOffer = choosePreferredOffer(
    safeOffers,
    produto?.oferta_preferencial_id || null,
  );
  const preferredText = [preferredOffer?.nome, preferredOffer?.descricao]
    .filter(Boolean)
    .join(" ");
  const productText = [produto?.nome, produto?.descricao, produto?.categoria]
    .filter(Boolean)
    .join(" ");
  const allOfferFacts = safeOffers.map((offer) => ({
    id: String(offer?.id || ""),
    voltage: extractStrictVoltage([offer?.nome, offer?.descricao].filter(Boolean).join(" ")),
    packagesNumber: extractPackagesNumber([offer?.nome, offer?.descricao].filter(Boolean).join(" ")),
  }));
  const distinctVoltages = Array.from(
    new Set(allOfferFacts.map((row) => row.voltage).filter(Boolean)),
  ) as string[];
  const distinctPackages = Array.from(
    new Set(
      allOfferFacts
        .map((row) => row.packagesNumber)
        .filter((value) => Number.isFinite(value)),
    ),
  ) as number[];

  return {
    preferredOffer,
    voltage: extractStrictVoltage(preferredText) || extractStrictVoltage(productText),
    packagesNumber:
      extractPackagesNumber(preferredText) ?? extractPackagesNumber(productText),
    distinctVoltages,
    distinctPackages,
  };
}

export function resolveTrustedMlCriticalValue(
  attrId: unknown,
  produto: any,
  offers: any[] = [],
): string | null {
  const id = String(attrId || "").trim().toUpperCase();
  const facts = resolveMlCriticalFacts(produto, offers);
  if (id === "VOLTAGE" || id === "NOMINAL_VOLTAGE") {
    return normalizeCriticalAttributeValue(id, facts.voltage);
  }
  if (id === "PACKAGES_NUMBER" || id === "PACKAGING_BOXES_NUMBER") {
    return normalizeCriticalAttributeValue(id, facts.packagesNumber);
  }
  return null;
}
