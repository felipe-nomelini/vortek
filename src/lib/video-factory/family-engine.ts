import {
  BVF_DIALOGUE_LANGUAGE,
  BVF_FAMILY_ATTRIBUTE_KEYS,
  BVF_FAMILY_CONTENT_CHANNELS,
  BVF_FAMILY_ENGINE_VERSION,
  BVF_FAMILY_MAX_MEMBERS,
  BVF_FAMILY_MIN_MEMBERS,
  BVF_FAMILY_SUGGESTION_ALGORITHM_VERSION,
  BVF_ONSCREEN_TEXT_LANGUAGE,
  BVF_PROMPT_LANGUAGE,
  bvfFamilyAnalysisSnapshotSchema,
  bvfFamilyBriefInputSnapshotSchema,
  bvfFamilyContentGuardSchema,
  bvfFamilyCreativeBriefSchema,
  bvfFamilyResearchSnapshotSchema,
  type BvfFactSource,
  type BvfFamilyAnalysisSnapshot,
  type BvfFamilyAttributeKey,
  type BvfFamilyBriefInputSnapshot,
  type BvfFamilyContentGuard,
  type BvfFamilyCreativeBrief,
  type BvfFamilyResearchSnapshot,
  type BvfVariationSafe,
  type BvfVariationUnsafe,
} from "./contracts";
import { buildBvfBriefArtifacts } from "./factual-engine";

export type BvfFamilySuggestionProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  active: boolean;
  updatedAt: string;
};

export type BvfFamilySuggestion = {
  schemaVersion: "BVF-FAMILY-SUGGESTION-v1";
  algorithmVersion: typeof BVF_FAMILY_SUGGESTION_ALGORITHM_VERSION;
  seed: BvfFamilySuggestionProduct;
  candidates: Array<
    BvfFamilySuggestionProduct & {
      score: number;
      matchedStableTokens: string[];
      removedVariationTokens: string[];
    }
  >;
};

export type BvfFamilyMemberInput = {
  product: BvfFamilySuggestionProduct & {
    gtin: string | null;
    description: string | null;
    netWeightKg: number | null;
  };
  offer: {
    id: string;
    name: string | null;
    brand: string | null;
    gtin: string | null;
    description: string | null;
    supplierSku: string | null;
    observedAt: string;
  } | null;
  listing: {
    itemId: string;
    title: string | null;
    observedAt: string;
  } | null;
  kit: {
    status: "not_kit" | "ready" | "inconclusive";
    totalUnits: number | null;
    reference: string;
    observedAt: string;
  };
  research: BvfFamilyResearchSnapshot;
};

export type BvfFamilyAnalysisInput = {
  family: {
    id: string;
    familyKey: string;
    name: string;
    brand: string | null;
    category: string | null;
  };
  members: BvfFamilyMemberInput[];
};

export type BvfFamilyAnalysisArtifacts = {
  engineVersion: typeof BVF_FAMILY_ENGINE_VERSION;
  membershipSnapshot: {
    schemaVersion: "BVF-FAMILY-MEMBERSHIP-v1";
    familyId: string;
    members: Array<{ productId: string; sku: string }>;
  };
  analysisSnapshot: BvfFamilyAnalysisSnapshot;
  materialFingerprintPayload: unknown;
};

export type BvfFamilyBriefArtifacts = {
  engineVersion: typeof BVF_FAMILY_ENGINE_VERSION;
  inputSnapshot: BvfFamilyBriefInputSnapshot;
  factualSnapshot: BvfFamilyAnalysisSnapshot;
  creativeBrief: BvfFamilyCreativeBrief;
  materialFingerprintPayload: unknown;
};

type Observation = {
  key: BvfFamilyAttributeKey;
  label: string;
  value: string;
  unit: string | null;
  normalizedValue: string;
  source: BvfFactSource;
};

type MemberFacts = {
  input: BvfFamilyMemberInput;
  observations: Map<BvfFamilyAttributeKey, Observation[]>;
  claims: Array<{ text: string; source: BvfFactSource }>;
};

const ATTRIBUTE_LABELS: Record<BvfFamilyAttributeKey, string> = {
  brand: "Marca",
  category: "Categoria",
  model: "Modelo",
  voltage: "Tensão",
  color: "Cor",
  size: "Tamanho",
  quantity: "Quantidade",
  kit: "Kit",
  capacity: "Capacidade",
  power: "Potência",
  finish: "Acabamento",
  width_cm: "Largura física",
  height_cm: "Altura física",
  depth_cm: "Profundidade física",
  weight_g: "Peso líquido",
};

const COLOR_TERMS = [
  "amarelo",
  "azul",
  "bege",
  "branco",
  "bronze",
  "cinza",
  "cobre",
  "dourado",
  "grafite",
  "laranja",
  "marrom",
  "prata",
  "preto",
  "rosa",
  "roxo",
  "transparente",
  "verde",
  "vermelho",
] as const;

const FINISH_TERMS = [
  "brilhante",
  "cromado",
  "escovado",
  "fosco",
  "satin",
  "acetinado",
] as const;

const STOPWORDS = new Set([
  "a",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "o",
  "os",
  "para",
  "por",
  "the",
]);

function clean(value: unknown, max = 2_000): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizedText(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validIso(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("BVF_FAMILY_INVALID_OBSERVED_AT");
  }
  return new Date(value).toISOString();
}

function source(
  kind: BvfFactSource["kind"],
  reference: string,
  observedAt: string,
  url?: string,
): BvfFactSource {
  return {
    kind,
    reference: clean(reference, 500),
    observedAt: validIso(observedAt),
    ...(url ? { url } : {}),
  };
}

function decimal(raw: string): number | null {
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function canonicalNumber(raw: string): string {
  const value = decimal(raw);
  return value === null ? raw.trim() : String(Number(value.toFixed(6)));
}

function observation(
  key: BvfFamilyAttributeKey,
  value: string,
  unit: string | null,
  evidence: BvfFactSource,
): Observation | null {
  const display = clean(value, 500);
  if (!display) return null;
  const normalizedUnit = unit ? clean(unit, 40).toLowerCase() : null;
  const normalizedValue = `${normalizedText(display)}|${normalizedUnit ?? ""}`;
  if (!normalizedText(display)) return null;
  return {
    key,
    label: ATTRIBUTE_LABELS[key],
    value: display,
    unit: normalizedUnit,
    normalizedValue,
    source: evidence,
  };
}

function push(
  map: Map<BvfFamilyAttributeKey, Observation[]>,
  item: Observation | null,
) {
  if (!item) return;
  const list = map.get(item.key) ?? [];
  if (!list.some((current) => current.normalizedValue === item.normalizedValue)) {
    list.push(item);
  } else {
    const existing = list.find(
      (current) => current.normalizedValue === item.normalizedValue,
    );
    if (existing && existing.source.kind === "web" && item.source.kind !== "web") {
      Object.assign(existing, item);
    }
  }
  map.set(item.key, list);
}

function firstMatch(
  text: string,
  labels: string,
): { value: string; unit: string | null } | null {
  const match = text.match(
    new RegExp(
      `\\b(?:${labels})\\s*[:\\-]\\s*([^;|\\n]{1,120}?)(?=\\s+\\b(?:marca|modelo|cor|tamanho|voltagem|tensao|tensão|capacidade|potencia|potência|acabamento|quantidade)\\s*[:\\-]|$)`,
      "iu",
    ),
  );
  return match?.[1] ? { value: clean(match[1], 120), unit: null } : null;
}

function textObservations(
  input: BvfFamilyMemberInput,
  map: Map<BvfFamilyAttributeKey, Observation[]>,
) {
  const productSource = source(
    "bentevi_product",
    `produtos:${input.product.id}`,
    input.product.updatedAt,
  );
  const offerSource = input.offer
    ? source(
        "dslite_offer",
        `produto_fornecedor_ofertas:${input.offer.id}`,
        input.offer.observedAt,
      )
    : null;
  const listingSource = input.listing
    ? source(
        "bentevi_listing",
        `anuncios_ml:${input.listing.itemId}`,
        input.listing.observedAt,
      )
    : null;
  const sources = [
    { text: `${input.product.name}\n${input.product.description ?? ""}`, source: productSource },
    ...(input.offer && offerSource
      ? [{ text: `${input.offer.name ?? ""}\n${input.offer.description ?? ""}`, source: offerSource }]
      : []),
    ...(input.listing && listingSource
      ? [{ text: input.listing.title ?? "", source: listingSource }]
      : []),
  ];

  push(map, observation("brand", input.product.brand ?? input.offer?.brand ?? "", null, productSource));
  push(map, observation("category", input.product.category ?? "", null, productSource));

  for (const item of sources) {
    const text = clean(item.text, 20_000);
    const normalized = normalizedText(text);
    const labelled: Array<[BvfFamilyAttributeKey, string]> = [
      ["model", "modelo|model"],
      ["voltage", "voltagem|tens[aã]o"],
      ["color", "cor"],
      ["size", "tamanho|medida|di[aâ]metro"],
      ["quantity", "quantidade|conte[uú]do"],
      ["capacity", "capacidade"],
      ["power", "pot[eê]ncia"],
      ["finish", "acabamento"],
    ];
    for (const [key, labels] of labelled) {
      const found = firstMatch(text, labels);
      if (found) push(map, observation(key, found.value, found.unit, item.source));
    }

    const voltages = [
      ...normalized.matchAll(/\b(?:bivolt|110\s*v|120\s*v|127\s*v|220\s*v|\d+(?:[.,]\d+)?\s*vdc)\b/giu),
    ].map((match) => match[0].replace(/\s+/g, ""));
    if (voltages.length) {
      push(
        map,
        observation("voltage", [...new Set(voltages)].sort().join("/"), null, item.source),
      );
    }

    const colors = COLOR_TERMS.filter((term) =>
      new RegExp(`\\b${term}\\b`, "iu").test(normalized),
    );
    if (colors.length) {
      push(map, observation("color", colors.sort().join("/"), null, item.source));
    }

    const finishes = FINISH_TERMS.filter((term) =>
      new RegExp(`\\b${term}\\b`, "iu").test(normalized),
    );
    if (finishes.length) {
      push(map, observation("finish", finishes.sort().join("/"), null, item.source));
    }

    const powers = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(W\s*RMS|W|VA)\b/giu)].map(
      (match) => `${canonicalNumber(match[1])} ${clean(match[2]).toUpperCase().replace(/\s+/g, " ")}`,
    );
    if (powers.length) {
      push(map, observation("power", [...new Set(powers)].sort().join("/"), null, item.source));
    }

    const quantities = [
      ...text.matchAll(/\b(?:com|c\s*\/)\s*(\d{1,3})\s*(?:unidades?|pe[çc]as?|pilhas?|baterias?)\b/giu),
      ...text.matchAll(/(?:^|\s)[-/]\s*(\d{1,3})\s*$/giu),
    ].map((match) => Number(match[1])).filter((value) => value > 0);
    if (/\bpar\b/iu.test(text)) quantities.push(2);
    if (quantities.length) {
      push(
        map,
        observation(
          "quantity",
          [...new Set(quantities)].sort((a, b) => a - b).join("/"),
          "un",
          item.source,
        ),
      );
    }
  }

  const kitSource = source(
    "bentevi_kit",
    input.kit.reference,
    input.kit.observedAt,
  );
  if (input.kit.status !== "inconclusive") {
    push(
      map,
      observation("kit", input.kit.status === "ready" ? "Sim" : "Não", null, kitSource),
    );
  }
  if (input.kit.status === "ready" && input.kit.totalUnits) {
    push(map, observation("quantity", String(input.kit.totalUnits), "un", kitSource));
  }
}

export function extractBvfFamilyMemberFacts(
  input: BvfFamilyMemberInput,
): MemberFacts {
  const observations = new Map<BvfFamilyAttributeKey, Observation[]>();
  textObservations(input, observations);

  const skuArtifacts = buildBvfBriefArtifacts({
    job: {
      id: input.product.id,
      sku: input.product.sku,
      videoType: "CINEMATIC_PRODUCT",
      mlItemId: input.listing?.itemId ?? null,
    },
    product: {
      id: input.product.id,
      sku: input.product.sku,
      name: input.product.name,
      brand: input.product.brand,
      gtin: input.product.gtin,
      category: input.product.category,
      description: input.product.description,
      netWeightKg: input.product.netWeightKg,
      updatedAt: input.product.updatedAt,
    },
    offer: input.offer,
    listing: input.listing,
    persona: null,
    research: {
      status: "not_needed",
      searchedFields: [],
      sourceUrls: [],
      acceptedFacts: [],
    },
    builtAt: input.product.updatedAt,
  });

  const dimensions = skuArtifacts.factualSnapshot.physicalDimensions;
  const measured: Array<
    [BvfFamilyAttributeKey, { value: number; source: BvfFactSource } | null, string]
  > = [
    ["width_cm", dimensions.widthCm, "cm"],
    ["height_cm", dimensions.heightCm, "cm"],
    ["depth_cm", dimensions.depthCm, "cm"],
    ["weight_g", dimensions.weightGrams, "g"],
  ];
  for (const [key, fact, unit] of measured) {
    if (fact) push(observations, observation(key, String(fact.value), unit, fact.source));
  }

  const locallyKnown = new Set(observations.keys());
  const research = bvfFamilyResearchSnapshotSchema.parse(input.research);
  for (const fact of research.acceptedFacts) {
    if (locallyKnown.has(fact.key)) continue;
    push(
      observations,
      observation(
        fact.key,
        fact.value,
        fact.unit,
        source("web", fact.quote, fact.collectedAt, fact.url),
      ),
    );
  }

  return {
    input,
    observations,
    claims: skuArtifacts.factualSnapshot.verifiedClaims,
  };
}

export function missingBvfFamilyResearchFields(
  input: BvfFamilyMemberInput,
): BvfFamilyAttributeKey[] {
  const known = extractBvfFamilyMemberFacts({
    ...input,
    research: {
      status: "not_needed",
      searchedFields: [],
      sourceUrls: [],
      acceptedFacts: [],
    },
  }).observations;
  return BVF_FAMILY_ATTRIBUTE_KEYS.filter((key) => !known.has(key));
}

function variationTokens(value: string): string[] {
  const normalized = normalizedText(value);
  const patterns = [
    /\b(?:bivolt|110v|120v|127v|220v|\d+vdc)\b/g,
    /\b\d+(?:[.,]\d+)?(?:mm|cm|m|pol|w|va|mah|ah|gb|tb|l|ml)\b/g,
    /\b(?:kit|par|c)\s*\/?\s*\d+\b/g,
    new RegExp(`\\b(?:${COLOR_TERMS.join("|")})\\b`, "g"),
    new RegExp(`\\b(?:${FINISH_TERMS.join("|")})\\b`, "g"),
  ];
  return [...new Set(patterns.flatMap((pattern) => normalized.match(pattern) ?? []))];
}

function stableTokens(product: BvfFamilySuggestionProduct): string[] {
  const removed = new Set(variationTokens(product.name));
  const brandTokens = new Set(normalizedText(product.brand).split(" ").filter(Boolean));
  return [
    ...new Set(
      normalizedText(product.name)
        .split(" ")
        .filter(
          (token) =>
            token.length >= 2 &&
            !STOPWORDS.has(token) &&
            !brandTokens.has(token) &&
            !removed.has(token) &&
            !/^\d+$/.test(token),
        ),
    ),
  ];
}

function leafCategory(value: string | null): string {
  return normalizedText(value?.split("/").at(-1) ?? "");
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token));
  const union = new Set([...leftSet, ...rightSet]);
  return union.size ? intersection.length / union.size : 0;
}

export function suggestBvfFamilyCandidates(
  seed: BvfFamilySuggestionProduct,
  pool: BvfFamilySuggestionProduct[],
): BvfFamilySuggestion {
  if (!seed.active) throw new Error("BVF_FAMILY_SEED_INACTIVE");
  const seedBrand = normalizedText(seed.brand);
  const seedCategory = leafCategory(seed.category);
  if (!seedBrand || !seedCategory) {
    throw new Error("BVF_FAMILY_SEED_IDENTITY_INCOMPLETE");
  }
  const seedTokens = stableTokens(seed);
  if (seedTokens.length < 2) throw new Error("BVF_FAMILY_SEED_TOKENS_INSUFFICIENT");

  const candidates = pool
    .filter(
      (product) =>
        product.id !== seed.id &&
        product.active &&
        normalizedText(product.brand) === seedBrand &&
        leafCategory(product.category) === seedCategory,
    )
    .flatMap((product) => {
      const tokens = stableTokens(product);
      const matchedStableTokens = seedTokens.filter((token) => tokens.includes(token));
      const score = jaccard(seedTokens, tokens);
      return matchedStableTokens.length >= 2 && score >= 0.6
        ? [
            {
              ...product,
              score: Number(score.toFixed(6)),
              matchedStableTokens,
              removedVariationTokens: variationTokens(product.name),
            },
          ]
        : [];
    })
    .sort((left, right) => right.score - left.score || left.sku.localeCompare(right.sku))
    .slice(0, BVF_FAMILY_MAX_MEMBERS - 1);

  return {
    schemaVersion: "BVF-FAMILY-SUGGESTION-v1",
    algorithmVersion: BVF_FAMILY_SUGGESTION_ALGORITHM_VERSION,
    seed,
    candidates,
  };
}

function selectedObservation(
  facts: MemberFacts,
  key: BvfFamilyAttributeKey,
): { value: Observation | null; ambiguous: boolean } {
  const values = facts.observations.get(key) ?? [];
  return {
    value: values.length === 1 ? values[0] : null,
    ambiguous: values.length > 1,
  };
}

function memberValue(
  facts: MemberFacts,
  key: BvfFamilyAttributeKey,
) {
  const selected = selectedObservation(facts, key);
  return {
    sku: facts.input.product.sku,
    value: selected.value?.value ?? null,
    unit: selected.value?.unit ?? null,
    sources: selected.value ? [selected.value.source] : [],
  };
}

function commonClaims(facts: MemberFacts[]) {
  const first = facts[0];
  if (!first) return [];
  const maps = facts.map(
    (member) =>
      new Map(member.claims.map((claim) => [normalizedText(claim.text), claim] as const)),
  );
  return first.claims.flatMap((claim) => {
    const key = normalizedText(claim.text);
    const matches = maps.map((map) => map.get(key));
    if (!key || matches.some((match) => !match)) return [];
    return [
      {
        text: claim.text,
        sourcesBySku: facts.map((member, index) => ({
          sku: member.input.product.sku,
          source: matches[index]!.source,
        })),
      },
    ];
  });
}

function ptNumber(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Number(parsed.toFixed(3)).toString().replace(".", ",")
    : value;
}

export function buildBvfFamilyAnalysis(
  input: BvfFamilyAnalysisInput,
): BvfFamilyAnalysisArtifacts {
  if (
    input.members.length < BVF_FAMILY_MIN_MEMBERS ||
    input.members.length > BVF_FAMILY_MAX_MEMBERS
  ) {
    throw new Error("BVF_FAMILY_MEMBER_COUNT_INVALID");
  }
  const sortedMembers = [...input.members].sort((left, right) =>
    left.product.sku.localeCompare(right.product.sku),
  );
  const uniqueProducts = new Set(sortedMembers.map((member) => member.product.id));
  const uniqueSkus = new Set(sortedMembers.map((member) => member.product.sku));
  if (uniqueProducts.size !== sortedMembers.length || uniqueSkus.size !== sortedMembers.length) {
    throw new Error("BVF_FAMILY_MEMBER_DUPLICATED");
  }
  const facts = sortedMembers.map(extractBvfFamilyMemberFacts);
  const variationSafe: BvfVariationSafe[] = [];
  const variationUnsafe: BvfVariationUnsafe[] = [];

  for (const key of BVF_FAMILY_ATTRIBUTE_KEYS) {
    const selected = facts.map((member) => selectedObservation(member, key));
    const members = facts.map((member) => memberValue(member, key));
    const ambiguous = selected.some((item) => item.ambiguous);
    const missing = selected.some((item) => !item.value);
    const values = new Set(
      selected.flatMap((item) => (item.value ? [item.value.normalizedValue] : [])),
    );
    if (!ambiguous && !missing && values.size === 1) {
      const common = selected[0].value!;
      variationSafe.push({
        key,
        label: ATTRIBUTE_LABELS[key],
        value: common.value,
        unit: common.unit,
        members,
      });
      continue;
    }
    variationUnsafe.push({
      key,
      label: ATTRIBUTE_LABELS[key],
      reason: ambiguous
        ? "ambiguous_evidence"
        : missing
          ? "missing_evidence"
          : "varies",
      members,
      blockedIn: [...BVF_FAMILY_CONTENT_CHANNELS],
    });
  }

  for (const [key, label, valueOf] of [
    ["sku", "SKU", (member: MemberFacts) => member.input.product.sku],
    ["gtin", "GTIN", (member: MemberFacts) => member.input.product.gtin],
    ["ml_item_id", "ID do anúncio", (member: MemberFacts) => member.input.listing?.itemId],
  ] as const) {
    variationUnsafe.push({
      key,
      label,
      reason: "identifier_specific",
      members: facts.map((member) => ({
        sku: member.input.product.sku,
        value: valueOf(member) ?? null,
        unit: null,
        sources: [],
      })),
      blockedIn: [...BVF_FAMILY_CONTENT_CHANNELS],
    });
  }

  const safeByKey = new Map(variationSafe.map((item) => [item.key, item]));
  const measurement = (key: "width_cm" | "height_cm" | "depth_cm" | "weight_g") => {
    const safe = safeByKey.get(key);
    if (!safe) return null;
    const value = Number(safe.value);
    const source = safe.members[0]?.sources[0];
    return Number.isFinite(value) && value > 0 && source ? { value, source } : null;
  };
  const physicalDimensions = {
    widthCm: measurement("width_cm"),
    heightCm: measurement("height_cm"),
    depthCm: measurement("depth_cm"),
    weightGrams: measurement("weight_g"),
  };
  const scaleAnchor =
    physicalDimensions.widthCm &&
    physicalDimensions.heightCm &&
    physicalDimensions.depthCm
      ? `Preserve a escala comum comprovada de ${ptNumber(String(physicalDimensions.widthCm.value))} × ${ptNumber(String(physicalDimensions.heightCm.value))} × ${ptNumber(String(physicalDimensions.depthCm.value))} cm${
          physicalDimensions.weightGrams
            ? ` e ${ptNumber(String(physicalDimensions.weightGrams.value))} g`
            : ""
        }, sem representar uma variação específica da família.`
      : null;

  const analysisSnapshot = bvfFamilyAnalysisSnapshotSchema.parse({
    schemaVersion: "BVF-FAMILY-ANALYSIS-v1",
    family: input.family,
    members: facts.map((member) => ({
      productId: member.input.product.id,
      sku: member.input.product.sku,
      name: member.input.product.name,
      active: member.input.product.active,
      updatedAt: validIso(member.input.product.updatedAt),
      offerId: member.input.offer?.id ?? null,
      listingItemId: member.input.listing?.itemId ?? null,
      kitStatus: member.input.kit.status,
      research: member.input.research,
    })),
    verifiedClaims: commonClaims(facts),
    forbiddenClaims: [],
    physicalDimensions,
    scaleAnchor,
    variationSafe,
    variationUnsafe,
  });
  const membershipSnapshot = {
    schemaVersion: "BVF-FAMILY-MEMBERSHIP-v1" as const,
    familyId: input.family.id,
    members: sortedMembers.map((member) => ({
      productId: member.product.id,
      sku: member.product.sku,
    })),
  };
  return {
    engineVersion: BVF_FAMILY_ENGINE_VERSION,
    membershipSnapshot,
    analysisSnapshot,
    materialFingerprintPayload: {
      engineVersion: BVF_FAMILY_ENGINE_VERSION,
      membershipSnapshot,
      analysisSnapshot: stripVolatileTimes(analysisSnapshot),
    },
  };
}

function stripVolatileTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["observedAt", "collectedAt", "updatedAt"].includes(key))
      .map(([key, child]) => [key, stripVolatileTimes(child)]),
  );
}

export function buildBvfFamilyContentGuard(
  analysis: BvfFamilyAnalysisSnapshot,
): BvfFamilyContentGuard {
  return bvfFamilyContentGuardSchema.parse({
    allowedFactKeys: analysis.variationSafe.map((item) => item.key),
    allowedClaims: analysis.verifiedClaims.map((claim) => claim.text),
    blockedAttributeKeys: analysis.variationUnsafe.map((item) => item.key),
    blockedIn: [...BVF_FAMILY_CONTENT_CHANNELS],
  });
}

export function assertBvfFamilyNarrativeFactKeys(
  guard: BvfFamilyContentGuard,
  draft: Record<(typeof BVF_FAMILY_CONTENT_CHANNELS)[number], string[]>,
) {
  const allowed = new Set(guard.allowedFactKeys);
  const blocked = new Set(guard.blockedAttributeKeys);
  for (const channel of BVF_FAMILY_CONTENT_CHANNELS) {
    for (const key of draft[channel]) {
      if (!allowed.has(key as BvfFamilyAttributeKey) || blocked.has(key)) {
        throw new Error(`BVF_FAMILY_UNSAFE_FACT:${channel}:${key}`);
      }
    }
  }
}

export function buildBvfFamilyBriefArtifacts(input: {
  job: { id: string; familyId: string; familyKey: string };
  analysisVersion: { id: string; version: number; materialFingerprint: string };
  analysis: BvfFamilyAnalysisSnapshot;
  persona: { id: string; code: string } | null;
}): BvfFamilyBriefArtifacts {
  if (
    input.analysis.family.id !== input.job.familyId ||
    input.analysis.family.familyKey !== input.job.familyKey
  ) {
    throw new Error("BVF_FAMILY_BRIEF_TARGET_MISMATCH");
  }
  const contentGuard = buildBvfFamilyContentGuard(input.analysis);
  const inputSnapshot = bvfFamilyBriefInputSnapshotSchema.parse({
    schemaVersion: "BVF-FAMILY-BRIEF-INPUT-v1",
    job: {
      id: input.job.id,
      familyId: input.job.familyId,
      familyKey: input.job.familyKey,
      videoType: "FAMILY_VIDEO",
    },
    analysisVersion: input.analysisVersion,
    family: input.analysis.family,
    members: input.analysis.members,
  });
  const creativeBrief = bvfFamilyCreativeBriefSchema.parse({
    schemaVersion: "BVF-FAMILY-CREATIVE-BRIEF-v1",
    target: {
      jobId: input.job.id,
      familyId: input.job.familyId,
      familyKey: input.job.familyKey,
      videoType: "FAMILY_VIDEO",
    },
    languages: {
      prompt: BVF_PROMPT_LANGUAGE,
      dialogue: BVF_DIALOGUE_LANGUAGE,
      onscreenText: BVF_ONSCREEN_TEXT_LANGUAGE,
    },
    persona: input.persona,
    direction:
      "Apresentar a família sem identificar uma variação específica e usando exclusivamente fatos seguros para todos os SKUs.",
    contentGuard,
    factualRules: {
      useVerifiedClaimsOnly: true,
      excludeForbiddenClaims: true,
      excludeVariationUnsafe: true,
      preservePhysicalScale: Boolean(input.analysis.scaleAnchor),
    },
  });
  return {
    engineVersion: BVF_FAMILY_ENGINE_VERSION,
    inputSnapshot,
    factualSnapshot: input.analysis,
    creativeBrief,
    materialFingerprintPayload: {
      engineVersion: BVF_FAMILY_ENGINE_VERSION,
      inputSnapshot: stripVolatileTimes(inputSnapshot),
      factualSnapshot: stripVolatileTimes(input.analysis),
      creativeBrief,
    },
  };
}
