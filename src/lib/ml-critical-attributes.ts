import { resolvePreferredOfferForProduct } from "@/lib/preferred-offer";
import {
  extractStrictVoltage,
  normalizeVoltageValue,
} from "@/lib/ml-voltage";
import {
  assessMlListingIdentity,
  extractStrictProductDiameter,
  normalizeMlDiameter,
} from "@/lib/ml-listing-identity";

export {
  extractStrictVoltage,
  normalizeVoltageValue,
} from "@/lib/ml-voltage";

const CRITICAL_ML_ATTRIBUTE_IDS = new Set([
  "VOLTAGE",
  "NOMINAL_VOLTAGE",
  "PACKAGES_NUMBER",
  "PACKAGING_BOXES_NUMBER",
  "DIAMETER",
  "BLADES_DIAMETER",
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
  if (id === "DIAMETER" || id === "BLADES_DIAMETER") {
    return normalizeMlDiameter(value);
  }
  return String(value).trim() || null;
}

export function resolveMlCriticalFacts(produto: any, offers: any[] = []) {
  const safeOffers = Array.isArray(offers) ? offers : [];
  const preferredOffer = resolvePreferredOfferForProduct(
    safeOffers,
    produto?.oferta_preferencial_id || null,
    produto?.fornecedor_preferencial_manual === true,
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
    diameter: extractStrictProductDiameter(offer?.nome),
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
    diameter:
      extractStrictProductDiameter(preferredOffer?.nome) ||
      extractStrictProductDiameter(produto?.nome),
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
  if (id === "DIAMETER" || id === "BLADES_DIAMETER") {
    return normalizeCriticalAttributeValue(id, facts.diameter);
  }
  return null;
}

export function assessMlProductIdentity(
  item: any,
  produto: any,
  offers: any[] = [],
) {
  const facts = resolveMlCriticalFacts(produto, offers);
  return assessMlListingIdentity(item, {
    sellerSku: produto?.sku,
    gtin: produto?.gtin,
    brand: produto?.marca,
    brandEvidence: [facts.preferredOffer?.nome, facts.preferredOffer?.descricao].filter(Boolean).join(" "),
    diameter: facts.diameter,
    voltage: facts.voltage,
    packagesNumber: facts.packagesNumber,
  });
}
