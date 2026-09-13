import {
  BVF_BRIEF_ENGINE_VERSION,
  BVF_DIALOGUE_LANGUAGE,
  BVF_ONSCREEN_TEXT_LANGUAGE,
  BVF_PROMPT_LANGUAGE,
  bvfBriefInputSnapshotSchema,
  bvfCreativeBriefSchema,
  bvfFactualSnapshotSchema,
  bvfResearchSnapshotSchema,
  type BvfBriefInputSnapshot,
  type BvfCreativeBrief,
  type BvfFactSource,
  type BvfFactualSnapshot,
  type BvfResearchSnapshot,
} from "./contracts";

type BriefVideoType = "HUMAN_DEMO" | "CINEMATIC_PRODUCT";

export type BvfBriefEngineInput = {
  job: {
    id: string;
    sku: string;
    videoType: BriefVideoType;
    mlItemId: string | null;
  };
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    gtin: string | null;
    category: string | null;
    description: string | null;
    netWeightKg: number | null;
    updatedAt: string | null;
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
  persona: { id: string; code: string } | null;
  research: BvfResearchSnapshot;
  builtAt: string;
};

export type BvfBriefArtifacts = {
  engineVersion: typeof BVF_BRIEF_ENGINE_VERSION;
  inputSnapshot: BvfBriefInputSnapshot;
  factualSnapshot: BvfFactualSnapshot;
  creativeBrief: BvfCreativeBrief;
  materialFingerprintPayload: unknown;
};

function text(value: unknown, max: number): string | null {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validIso(value: string | null | undefined, fallback: string): string {
  if (value && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(fallback).toISOString();
}

function source(
  kind: BvfFactSource["kind"],
  reference: string,
  observedAt: string,
  url?: string,
): BvfFactSource {
  return {
    kind,
    reference: reference.slice(0, 500),
    observedAt,
    ...(url ? { url } : {}),
  };
}

function stripHtmlPreservingBreaks(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|li|div|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "");
}

function literalClaims(description: string | null): string[] {
  if (!description) return [];

  const parts = stripHtmlPreservingBreaks(description)
    .split(/\n+|\s*[•·▪◦]\s*|(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/u)
    .map((part) => part.replace(/^[-–—]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 3 && part.length <= 500);

  return [...new Set(parts)].slice(0, 50);
}

function decimal(value: string): number | null {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  return positiveNumber(normalized);
}

function toCentimeters(value: number, unit: string): number {
  const normalized = unit.toLowerCase();
  const centimeters =
    normalized === "mm" ? value / 10 : normalized === "m" ? value * 100 : value;
  return Number(centimeters.toFixed(6));
}

function parseExplicitProductDimensions(
  description: string | null,
): { widthCm: number; heightCm: number; depthCm: number } | null {
  if (!description) return null;
  const plain = stripHtmlPreservingBreaks(description);
  const pattern =
    /(?:dimens(?:ões|oes)|medidas)\s+(?:f[íi]sicas\s+)?(?:do|da)\s+(?:produto|item|equipamento|pe[çc]a)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/giu;

  for (const match of plain.matchAll(pattern)) {
    const context = plain.slice(Math.max(0, (match.index ?? 0) - 80), match.index);
    if (/embalagem|pacote|caixa/i.test(context)) continue;
    const width = decimal(match[1]);
    const height = decimal(match[2]);
    const depth = decimal(match[3]);
    if (!width || !height || !depth) continue;
    return {
      widthCm: toCentimeters(width, match[4]),
      heightCm: toCentimeters(height, match[4]),
      depthCm: toCentimeters(depth, match[4]),
    };
  }
  return null;
}

function parseResearchMeasurement(
  rawValue: string,
  rawUnit: string | null,
  target: "dimension" | "weight",
): number | null {
  const match = rawValue.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|kg|g|m)?/i);
  if (!match) return null;
  const value = decimal(match[1]);
  if (!value) return null;
  const unit = (rawUnit || match[2] || "").trim().toLowerCase();

  if (target === "dimension") {
    if (!unit || !["mm", "cm", "m"].includes(unit)) return null;
    return toCentimeters(value, unit);
  }

  if (!unit || !["g", "kg"].includes(unit)) return null;
  return unit === "kg" ? value * 1_000 : value;
}

function formatPtNumber(value: number): string {
  return Number(value.toFixed(3)).toString().replace(".", ",");
}

function stripVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileTimestamps);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "observedAt" && key !== "collectedAt")
      .map(([key, child]) => [key, stripVolatileTimestamps(child)]),
  );
}

export function stableBvfJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableBvfJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableBvfJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildBvfBriefArtifacts(
  rawInput: BvfBriefEngineInput,
): BvfBriefArtifacts {
  const builtAt = validIso(rawInput.builtAt, new Date().toISOString());
  const productObservedAt = validIso(rawInput.product.updatedAt, builtAt);
  const product = {
    id: rawInput.product.id,
    sku: text(rawInput.product.sku, 255) ?? "",
    name: text(rawInput.product.name, 2_000) ?? "",
    brand: text(rawInput.product.brand, 20_000),
    gtin: text(rawInput.product.gtin, 20_000),
    category: text(rawInput.product.category, 20_000),
    description: text(rawInput.product.description, 20_000),
    netWeightKg: positiveNumber(rawInput.product.netWeightKg),
    updatedAt: rawInput.product.updatedAt
      ? validIso(rawInput.product.updatedAt, builtAt)
      : null,
  };

  if (!product.sku || !product.name) {
    throw new Error("BVF_BRIEF_PRODUCT_IDENTITY_REQUIRED");
  }
  if (rawInput.job.sku !== product.sku) {
    throw new Error("BVF_BRIEF_SKU_MISMATCH");
  }
  if (rawInput.job.videoType === "HUMAN_DEMO" && !rawInput.persona) {
    throw new Error("BVF_BRIEF_PERSONA_REQUIRED");
  }

  const offer = rawInput.offer
    ? {
        id: rawInput.offer.id,
        name: text(rawInput.offer.name, 20_000),
        brand: text(rawInput.offer.brand, 20_000),
        gtin: text(rawInput.offer.gtin, 20_000),
        description: text(rawInput.offer.description, 20_000),
        supplierSku: text(rawInput.offer.supplierSku, 20_000),
        observedAt: validIso(rawInput.offer.observedAt, builtAt),
      }
    : null;
  const listing = rawInput.listing
    ? {
        itemId: text(rawInput.listing.itemId, 255) ?? "",
        title: text(rawInput.listing.title, 20_000),
        observedAt: validIso(rawInput.listing.observedAt, builtAt),
      }
    : null;
  const research = bvfResearchSnapshotSchema.parse(rawInput.research);

  const productSource = source(
    "bentevi_product",
    `produtos:${product.id}`,
    productObservedAt,
  );
  const offerSource = offer
    ? source("dslite_offer", `produto_fornecedor_ofertas:${offer.id}`, offer.observedAt)
    : null;
  const listingSource = listing
    ? source("bentevi_listing", `anuncios_ml:${listing.itemId}`, listing.observedAt)
    : null;
  const researchByKey = new Map(
    research.acceptedFacts.map((fact) => [fact.key, fact] as const),
  );

  const sourcedValue = (
    key: "brand" | "gtin" | "category" | "model",
    localValue: string | null,
    fallbackValue: string | null,
  ) => {
    if (localValue) return { value: localValue, source: productSource };
    if (fallbackValue && offerSource) {
      return { value: fallbackValue, source: offerSource };
    }
    const researched = researchByKey.get(key);
    if (!researched) return null;
    return {
      value: researched.value,
      source: source(
        "web",
        researched.quote,
        researched.collectedAt,
        researched.url,
      ),
    };
  };

  const identityFacts = [
    { key: "product_name", value: product.name, source: productSource },
    { key: "sku", value: product.sku, source: productSource },
  ];
  const brand = sourcedValue("brand", product.brand, offer?.brand ?? null);
  const gtin = sourcedValue("gtin", product.gtin, offer?.gtin ?? null);
  const category = sourcedValue("category", product.category, null);
  const model = sourcedValue("model", null, null);
  if (brand) identityFacts.push({ key: "brand", ...brand });
  if (gtin) identityFacts.push({ key: "gtin", ...gtin });
  if (category) identityFacts.push({ key: "category", ...category });
  if (model) identityFacts.push({ key: "model", ...model });
  if (listing?.title && listingSource) {
    identityFacts.push({
      key: "listing_title",
      value: listing.title,
      source: listingSource,
    });
  }

  const localDimensions =
    parseExplicitProductDimensions(product.description) ??
    parseExplicitProductDimensions(offer?.description ?? null);
  const localDimensionsSource = parseExplicitProductDimensions(product.description)
    ? productSource
    : localDimensions && offerSource
      ? offerSource
      : null;

  const researchDimension = (key: "width_cm" | "height_cm" | "depth_cm") => {
    const fact = researchByKey.get(key);
    if (!fact) return null;
    const value = parseResearchMeasurement(fact.value, fact.unit, "dimension");
    if (!value) return null;
    return {
      value,
      source: source("web", fact.quote, fact.collectedAt, fact.url),
    };
  };
  const dimension = (
    key: "width_cm" | "height_cm" | "depth_cm",
    localValue: number | undefined,
  ) =>
    localValue && localDimensionsSource
      ? { value: localValue, source: localDimensionsSource }
      : researchDimension(key);

  const researchedWeight = researchByKey.get("weight_g");
  const researchedWeightGrams = researchedWeight
    ? parseResearchMeasurement(
        researchedWeight.value,
        researchedWeight.unit,
        "weight",
      )
    : null;
  const physicalDimensions = {
    widthCm: dimension("width_cm", localDimensions?.widthCm),
    heightCm: dimension("height_cm", localDimensions?.heightCm),
    depthCm: dimension("depth_cm", localDimensions?.depthCm),
    weightGrams: product.netWeightKg
      ? { value: product.netWeightKg * 1_000, source: productSource }
      : researchedWeight && researchedWeightGrams
        ? {
            value: researchedWeightGrams,
            source: source(
              "web",
              researchedWeight.quote,
              researchedWeight.collectedAt,
              researchedWeight.url,
            ),
          }
        : null,
  };

  const widthCm = physicalDimensions.widthCm;
  const heightCm = physicalDimensions.heightCm;
  const depthCm = physicalDimensions.depthCm;
  const scaleAnchor =
    widthCm && heightCm && depthCm
      ? `Preserve a escala real de ${formatPtNumber(widthCm.value)} × ${formatPtNumber(heightCm.value)} × ${formatPtNumber(depthCm.value)} cm${
          physicalDimensions.weightGrams
            ? ` e ${formatPtNumber(physicalDimensions.weightGrams.value)} g`
            : ""
        } em relação às mãos e aos objetos do cenário, sem aumentar ou reduzir o produto.`
      : null;

  const claimDescription = product.description ?? offer?.description ?? null;
  const claimSource = product.description ? productSource : offerSource;
  const verifiedClaims = claimSource
    ? literalClaims(claimDescription).map((claim) => ({
        text: claim,
        source: claimSource,
      }))
    : [];

  const missingFacts = [
    !brand ? "brand" : null,
    !model ? "model" : null,
    !gtin ? "gtin" : null,
    !category ? "category" : null,
    !physicalDimensions.widthCm ? "width_cm" : null,
    !physicalDimensions.heightCm ? "height_cm" : null,
    !physicalDimensions.depthCm ? "depth_cm" : null,
    !physicalDimensions.weightGrams ? "weight_g" : null,
  ].filter((key): key is NonNullable<typeof key> => Boolean(key));

  const inputSnapshot = bvfBriefInputSnapshotSchema.parse({
    schemaVersion: "BVF-BRIEF-INPUT-v1",
    job: {
      id: rawInput.job.id,
      sku: rawInput.job.sku,
      videoType: rawInput.job.videoType,
      mlItemId: text(rawInput.job.mlItemId, 255),
    },
    product,
    offer,
    listing,
    research,
  });
  const factualSnapshot = bvfFactualSnapshotSchema.parse({
    schemaVersion: "BVF-FACTUAL-v1",
    facts: identityFacts,
    verifiedClaims,
    forbiddenClaims: [],
    physicalDimensions,
    scaleAnchor,
    variationSafe: [],
    variationUnsafe: [],
    missingFacts,
    research,
  });
  const creativeBrief = bvfCreativeBriefSchema.parse({
    schemaVersion: "BVF-CREATIVE-BRIEF-v1",
    target: {
      jobId: rawInput.job.id,
      sku: rawInput.job.sku,
      videoType: rawInput.job.videoType,
    },
    languages: {
      prompt: BVF_PROMPT_LANGUAGE,
      dialogue: BVF_DIALOGUE_LANGUAGE,
      onscreenText: BVF_ONSCREEN_TEXT_LANGUAGE,
    },
    persona: rawInput.persona,
    direction:
      rawInput.job.videoType === "HUMAN_DEMO"
        ? "Apresentar e demonstrar o SKU específico usando somente os fatos verificados do briefing."
        : "Manter o produto como protagonista e preservar fielmente geometria, marca e escala física.",
    factualRules: {
      useVerifiedClaimsOnly: true,
      excludeForbiddenClaims: true,
      preservePhysicalScale: Boolean(scaleAnchor),
    },
  });

  return {
    engineVersion: BVF_BRIEF_ENGINE_VERSION,
    inputSnapshot,
    factualSnapshot,
    creativeBrief,
    materialFingerprintPayload: stripVolatileTimestamps({
      engineVersion: BVF_BRIEF_ENGINE_VERSION,
      inputSnapshot,
      factualSnapshot,
      creativeBrief,
    }),
  };
}
