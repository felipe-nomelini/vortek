export type MlListingIdentityExpectation = {
  sellerSku?: string | null;
  gtin?: string | null;
  brand?: string | null;
  diameter?: string | null;
  voltage?: string | null;
  packagesNumber?: string | number | null;
};

export type MlListingIdentityConflict = {
  field: "SELLER_SKU" | "GTIN" | "BRAND" | "DIAMETER" | "VOLTAGE" | "PACKAGES_NUMBER";
  expected: string;
  remote: string;
};

export type MlListingIdentityAssessment = {
  conflicts: MlListingIdentityConflict[];
  blockingConflicts: MlListingIdentityConflict[];
  canonicalBrand: string | null;
};

export function mergeMlAttributePrefill(params: {
  prediction?: Record<string, string | undefined>;
  initial?: Record<string, string | undefined>;
  ruleBased?: Record<string, string | undefined>;
  strictEvidence?: boolean;
  keepRuleBased?: boolean;
}): { value_id?: string; value_name?: string } {
  const { prediction, initial, ruleBased, strictEvidence, keepRuleBased } = params;
  return {
    ...(strictEvidence ? {} : (prediction || {})),
    ...(initial || {}),
    ...(ruleBased || {}),
    ...(keepRuleBased ? (ruleBased || {}) : {}),
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeGtin(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return digits;
  return digits.replace(/^0+(?=\d)/, "");
}

function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeMlDiameter(value: unknown): string | null {
  const match = String(value ?? "").match(/(\d{1,3}(?:[.,]\d+)?)\s*cm\b/i);
  if (!match?.[1]) return null;
  const numeric = Number(match[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)} cm`;
}

/**
 * Extrai diâmetro somente de um nome comercial. Se houver duas medidas
 * distintas, retorna null para não confundir diâmetro com dimensões físicas.
 */
export function extractStrictProductDiameter(value: unknown): string | null {
  const text = String(value ?? "");
  const matches = Array.from(text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*cm\b/gi))
    .map((match) => normalizeMlDiameter(match[0]))
    .filter((diameter): diameter is string => Boolean(diameter));
  const distinct = Array.from(new Set(matches));
  return distinct.length === 1 ? distinct[0] : null;
}

function attributeValue(item: any, ids: string[]): string | null {
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  const attr = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (candidate: any) => wanted.has(String(candidate?.id || "").toUpperCase()),
  );
  const value = attr?.value_name ?? attr?.value_id;
  return value === null || value === undefined || String(value).trim() === ""
    ? null
    : String(value).trim();
}

function normalizeVoltage(value: unknown): string {
  return normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/^120v$/, "127v");
}

function compare(
  conflicts: MlListingIdentityConflict[],
  field: MlListingIdentityConflict["field"],
  expected: unknown,
  remote: unknown,
  normalizer: (value: unknown) => string,
) {
  const expectedRaw = String(expected ?? "").trim();
  const remoteRaw = String(remote ?? "").trim();
  if (!expectedRaw || !remoteRaw) return;
  if (normalizer(expectedRaw) !== normalizer(remoteRaw)) {
    conflicts.push({ field, expected: expectedRaw, remote: remoteRaw });
  }
}

/** Bloqueia apenas divergência material confirmada; ausência remota é tratada no read-back. */
export function findMlListingIdentityConflicts(
  item: any,
  expected: MlListingIdentityExpectation,
): MlListingIdentityConflict[] {
  const conflicts: MlListingIdentityConflict[] = [];
  compare(
    conflicts,
    "SELLER_SKU",
    expected.sellerSku,
    item?.seller_custom_field || attributeValue(item, ["SELLER_SKU"]),
    (value) => String(value ?? "").trim().toUpperCase(),
  );
  compare(conflicts, "GTIN", expected.gtin, attributeValue(item, ["GTIN"]), normalizeGtin);
  compare(conflicts, "BRAND", expected.brand, attributeValue(item, ["BRAND"]), normalizeText);
  compare(
    conflicts,
    "DIAMETER",
    expected.diameter,
    attributeValue(item, ["DIAMETER", "BLADES_DIAMETER"]),
    (value) => normalizeMlDiameter(value) || normalizeText(value),
  );
  compare(
    conflicts,
    "VOLTAGE",
    expected.voltage,
    attributeValue(item, ["VOLTAGE", "NOMINAL_VOLTAGE"]),
    normalizeVoltage,
  );
  compare(
    conflicts,
    "PACKAGES_NUMBER",
    expected.packagesNumber,
    attributeValue(item, ["PACKAGES_NUMBER", "PACKAGING_BOXES_NUMBER"]),
    (value) => String(value ?? "").match(/\d+/)?.[0] || normalizeText(value),
  );
  return conflicts;
}

/**
 * A marca remota pode substituir a marca local somente quando SKU e GTIN
 * comprovam exatamente o mesmo produto e não há nenhuma outra divergência.
 */
export function assessMlListingIdentity(
  item: any,
  expected: MlListingIdentityExpectation,
): MlListingIdentityAssessment {
  const conflicts = findMlListingIdentityConflicts(item, expected);
  const remoteSku = item?.seller_custom_field || attributeValue(item, ["SELLER_SKU"]);
  const remoteGtin = attributeValue(item, ["GTIN"]);
  const remoteBrand = attributeValue(item, ["BRAND"]);
  const expectedSku = normalizeSku(expected.sellerSku);
  const expectedGtin = normalizeGtin(expected.gtin);
  const sameSku = Boolean(expectedSku) && normalizeSku(remoteSku) === expectedSku;
  const sameGtin = Boolean(expectedGtin) && normalizeGtin(remoteGtin) === expectedGtin;
  const onlyBrandConflict = conflicts.length === 1 && conflicts[0]?.field === "BRAND";
  // M2M: SKU/GTIN não autorizam substituir marca materialmente divergente.
  const canonicalBrand = null;

  return {
    conflicts,
    blockingConflicts: canonicalBrand ? [] : conflicts,
    canonicalBrand,
  };
}

export function shouldPauseMlListingForIdentityConflicts(
  item: any,
  conflicts: MlListingIdentityConflict[],
): boolean {
  return String(item?.status || "").trim().toLowerCase() === "active"
    && conflicts.length > 0;
}
