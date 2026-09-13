import { z } from "zod";

export const BVF_PROMPT_LANGUAGE = "EN" as const;
export const BVF_DIALOGUE_LANGUAGE = "pt-BR" as const;
export const BVF_ONSCREEN_TEXT_LANGUAGE = "pt-BR" as const;
export const BVF_BRIEF_ENGINE_VERSION = "BVF-BRIEF-01-v1" as const;
export const BVF_FAMILY_ENGINE_VERSION = "BVF-FAMILY-01-v1" as const;
export const BVF_FAMILY_SUGGESTION_ALGORITHM_VERSION =
  "BVF-FAMILY-SUGGEST-01-v1" as const;
export const BVF_FAMILY_MIN_MEMBERS = 2 as const;
export const BVF_FAMILY_MAX_MEMBERS = 20 as const;

export const BVF_VIDEO_TYPES = [
  "HUMAN_DEMO",
  "CINEMATIC_PRODUCT",
  "FAMILY_VIDEO",
] as const;

export const BVF_CONTENT_SCOPES = ["SKU", "FAMILY"] as const;

export const BVF_JOB_STATUSES = [
  "draft",
  "data_loaded",
  "brief_ready",
  "waiting_brief_approval",
  "approved_for_generation",
  "queued",
  "generating",
  "generated",
  "validating",
  "waiting_content_approval",
  "approved",
  "rejected",
  "generation_error",
  "validation_failed",
  "insufficient_api_balance",
  "cancelled",
] as const;

export const BVF_ATTEMPT_STATUSES = [
  "queued",
  "generating",
  "succeeded",
  "failed",
  "cancelled",
  "insufficient_api_balance",
  "filtered",
] as const;

export const BVF_ASSET_TYPES = [
  "persona_reference",
  "product_reference",
  "generated_video",
  "approved_master",
  "thumbnail",
  "poster_frame",
] as const;

export const bvfVideoTypeSchema = z.enum(BVF_VIDEO_TYPES);
export const bvfContentScopeSchema = z.enum(BVF_CONTENT_SCOPES);
export const bvfJobStatusSchema = z.enum(BVF_JOB_STATUSES);
export const bvfAttemptStatusSchema = z.enum(BVF_ATTEMPT_STATUSES);
export const bvfAssetTypeSchema = z.enum(BVF_ASSET_TYPES);

export const bvfMoneySchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

export const BVF_FACT_SOURCE_KINDS = [
  "bentevi_product",
  "dslite_offer",
  "bentevi_listing",
  "bentevi_kit",
  "web",
] as const;

export const BVF_FAMILY_ATTRIBUTE_KEYS = [
  "brand",
  "category",
  "model",
  "voltage",
  "color",
  "size",
  "quantity",
  "kit",
  "capacity",
  "power",
  "finish",
  "width_cm",
  "height_cm",
  "depth_cm",
  "weight_g",
] as const;

export const BVF_FAMILY_CONTENT_CHANNELS = [
  "dialogue",
  "onscreen_text",
  "closing",
  "claims",
] as const;

export const BVF_RESEARCH_FACT_KEYS = [
  "brand",
  "model",
  "gtin",
  "category",
  "width_cm",
  "height_cm",
  "depth_cm",
  "weight_g",
] as const;

export const bvfFactSourceSchema = z
  .object({
    kind: z.enum(BVF_FACT_SOURCE_KINDS),
    reference: z.string().trim().min(1).max(500),
    observedAt: z.string().datetime({ offset: true }),
    url: z.string().url().startsWith("https://").optional(),
  })
  .strict();

export const bvfSourcedFactSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    value: z.union([
      z.string().trim().min(1).max(2_000),
      z.number().finite(),
      z.boolean(),
    ]),
    unit: z.string().trim().min(1).max(40).optional(),
    source: bvfFactSourceSchema,
  })
  .strict();

export const bvfSourcedClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    source: bvfFactSourceSchema,
  })
  .strict();

export const bvfSourcedMeasurementSchema = z
  .object({
    value: z.number().finite().positive(),
    source: bvfFactSourceSchema,
  })
  .strict();

export const bvfPhysicalDimensionsSchema = z
  .object({
    widthCm: bvfSourcedMeasurementSchema.nullable(),
    heightCm: bvfSourcedMeasurementSchema.nullable(),
    depthCm: bvfSourcedMeasurementSchema.nullable(),
    weightGrams: bvfSourcedMeasurementSchema.nullable(),
  })
  .strict();

export const bvfResearchFactSchema = z
  .object({
    key: z.enum(BVF_RESEARCH_FACT_KEYS),
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(40).nullable(),
    quote: z.string().trim().min(1).max(1_000),
    url: z.string().url().startsWith("https://"),
    collectedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const bvfResearchSnapshotSchema = z
  .object({
    status: z.enum(["not_needed", "completed", "no_match", "unavailable"]),
    searchedFields: z.array(z.enum(BVF_RESEARCH_FACT_KEYS)).max(8),
    sourceUrls: z.array(z.string().url().startsWith("https://")).max(5),
    acceptedFacts: z.array(bvfResearchFactSchema).max(24),
  })
  .strict();

export const bvfFamilyResearchFactSchema = z
  .object({
    key: z.enum(BVF_FAMILY_ATTRIBUTE_KEYS),
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(40).nullable(),
    quote: z.string().trim().min(1).max(1_000),
    url: z.string().url().startsWith("https://"),
    collectedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const bvfFamilyResearchSnapshotSchema = z
  .object({
    status: z.enum(["not_needed", "completed", "no_match", "unavailable"]),
    searchedFields: z.array(z.enum(BVF_FAMILY_ATTRIBUTE_KEYS)).max(15),
    sourceUrls: z.array(z.string().url().startsWith("https://")).max(4),
    acceptedFacts: z.array(bvfFamilyResearchFactSchema).max(30),
  })
  .strict();

export const bvfFamilyMemberValueSchema = z
  .object({
    sku: z.string().trim().min(1).max(255),
    value: z.string().trim().min(1).max(500).nullable(),
    unit: z.string().trim().min(1).max(40).nullable(),
    sources: z.array(bvfFactSourceSchema).max(4),
  })
  .strict();

export const bvfVariationSafeSchema = z
  .object({
    key: z.enum(BVF_FAMILY_ATTRIBUTE_KEYS),
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(40).nullable(),
    members: z.array(bvfFamilyMemberValueSchema).min(2).max(20),
  })
  .strict();

export const bvfVariationUnsafeSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().trim().min(1).max(120),
    reason: z.enum([
      "varies",
      "missing_evidence",
      "ambiguous_evidence",
      "identifier_specific",
    ]),
    members: z.array(bvfFamilyMemberValueSchema).min(2).max(20),
    blockedIn: z.tuple([
      z.literal("dialogue"),
      z.literal("onscreen_text"),
      z.literal("closing"),
      z.literal("claims"),
    ]),
  })
  .strict();

export const bvfFamilyClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    sourcesBySku: z
      .array(
        z
          .object({
            sku: z.string().trim().min(1).max(255),
            source: bvfFactSourceSchema,
          })
          .strict(),
      )
      .min(2)
      .max(20),
  })
  .strict();

export const bvfFamilyMemberSnapshotSchema = z
  .object({
    productId: z.string().uuid(),
    sku: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(2_000),
    active: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }),
    offerId: z.string().uuid().nullable(),
    listingItemId: z.string().trim().min(1).max(255).nullable(),
    kitStatus: z.enum(["not_kit", "ready", "inconclusive"]),
    research: bvfFamilyResearchSnapshotSchema,
  })
  .strict();

export const bvfFamilyAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("BVF-FAMILY-ANALYSIS-v1"),
    family: z
      .object({
        id: z.string().uuid(),
        familyKey: z.string().trim().min(1).max(255),
        name: z.string().trim().min(1).max(2_000),
        brand: z.string().trim().min(1).max(2_000).nullable(),
        category: z.string().trim().min(1).max(2_000).nullable(),
      })
      .strict(),
    members: z.array(bvfFamilyMemberSnapshotSchema).min(2).max(20),
    verifiedClaims: z.array(bvfFamilyClaimSchema).max(50),
    forbiddenClaims: z.array(bvfFamilyClaimSchema).max(50),
    physicalDimensions: bvfPhysicalDimensionsSchema,
    scaleAnchor: z.string().trim().min(1).max(1_000).nullable(),
    variationSafe: z.array(bvfVariationSafeSchema).max(100),
    variationUnsafe: z.array(bvfVariationUnsafeSchema).max(100),
  })
  .strict();

export const bvfFamilyContentGuardSchema = z
  .object({
    allowedFactKeys: z.array(z.enum(BVF_FAMILY_ATTRIBUTE_KEYS)).max(100),
    allowedClaims: z.array(z.string().trim().min(1).max(500)).max(50),
    blockedAttributeKeys: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .max(100),
    blockedIn: z.tuple([
      z.literal("dialogue"),
      z.literal("onscreen_text"),
      z.literal("closing"),
      z.literal("claims"),
    ]),
  })
  .strict();

export const bvfFamilyBriefInputSnapshotSchema = z
  .object({
    schemaVersion: z.literal("BVF-FAMILY-BRIEF-INPUT-v1"),
    job: z
      .object({
        id: z.string().uuid(),
        familyId: z.string().uuid(),
        familyKey: z.string().trim().min(1).max(255),
        videoType: z.literal("FAMILY_VIDEO"),
      })
      .strict(),
    analysisVersion: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        materialFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    family: bvfFamilyAnalysisSnapshotSchema.shape.family,
    members: bvfFamilyAnalysisSnapshotSchema.shape.members,
  })
  .strict();

export const bvfFamilyCreativeBriefSchema = z
  .object({
    schemaVersion: z.literal("BVF-FAMILY-CREATIVE-BRIEF-v1"),
    target: z
      .object({
        jobId: z.string().uuid(),
        familyId: z.string().uuid(),
        familyKey: z.string().trim().min(1).max(255),
        videoType: z.literal("FAMILY_VIDEO"),
      })
      .strict(),
    languages: z
      .object({
        prompt: z.literal(BVF_PROMPT_LANGUAGE),
        dialogue: z.literal(BVF_DIALOGUE_LANGUAGE),
        onscreenText: z.literal(BVF_ONSCREEN_TEXT_LANGUAGE),
      })
      .strict(),
    persona: z
      .object({
        id: z.string().uuid(),
        code: z.string().trim().min(1).max(100),
      })
      .strict()
      .nullable(),
    direction: z.string().trim().min(1).max(2_000),
    contentGuard: bvfFamilyContentGuardSchema,
    factualRules: z
      .object({
        useVerifiedClaimsOnly: z.literal(true),
        excludeForbiddenClaims: z.literal(true),
        excludeVariationUnsafe: z.literal(true),
        preservePhysicalScale: z.boolean(),
      })
      .strict(),
  })
  .strict();

const nullableTrimmedText = z.string().trim().min(1).max(20_000).nullable();

export const bvfBriefInputSnapshotSchema = z
  .object({
    schemaVersion: z.literal("BVF-BRIEF-INPUT-v1"),
    job: z
      .object({
        id: z.string().uuid(),
        sku: z.string().trim().min(1).max(255),
        videoType: z.enum(["HUMAN_DEMO", "CINEMATIC_PRODUCT"]),
        mlItemId: z.string().trim().min(1).max(255).nullable(),
      })
      .strict(),
    product: z
      .object({
        id: z.string().uuid(),
        sku: z.string().trim().min(1).max(255),
        name: z.string().trim().min(1).max(2_000),
        brand: nullableTrimmedText,
        gtin: nullableTrimmedText,
        category: nullableTrimmedText,
        description: nullableTrimmedText,
        netWeightKg: z.number().finite().positive().nullable(),
        updatedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
    offer: z
      .object({
        id: z.string().uuid(),
        name: nullableTrimmedText,
        brand: nullableTrimmedText,
        gtin: nullableTrimmedText,
        description: nullableTrimmedText,
        supplierSku: nullableTrimmedText,
        observedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    listing: z
      .object({
        itemId: z.string().trim().min(1).max(255),
        title: nullableTrimmedText,
        observedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    research: bvfResearchSnapshotSchema,
  })
  .strict();

export const bvfFactualSnapshotSchema = z
  .object({
    schemaVersion: z.literal("BVF-FACTUAL-v1"),
    facts: z.array(bvfSourcedFactSchema).max(100),
    verifiedClaims: z.array(bvfSourcedClaimSchema).max(50),
    forbiddenClaims: z.array(bvfSourcedClaimSchema).max(50),
    physicalDimensions: bvfPhysicalDimensionsSchema,
    scaleAnchor: z.string().trim().min(1).max(1_000).nullable(),
    variationSafe: z.array(z.string().trim().min(1).max(500)).max(100),
    variationUnsafe: z.array(z.string().trim().min(1).max(500)).max(100),
    missingFacts: z.array(z.enum(BVF_RESEARCH_FACT_KEYS)).max(8),
    research: bvfResearchSnapshotSchema,
  })
  .strict();

export const bvfCreativeBriefSchema = z
  .object({
    schemaVersion: z.literal("BVF-CREATIVE-BRIEF-v1"),
    target: z
      .object({
        jobId: z.string().uuid(),
        sku: z.string().trim().min(1).max(255),
        videoType: z.enum(["HUMAN_DEMO", "CINEMATIC_PRODUCT"]),
      })
      .strict(),
    languages: z
      .object({
        prompt: z.literal(BVF_PROMPT_LANGUAGE),
        dialogue: z.literal(BVF_DIALOGUE_LANGUAGE),
        onscreenText: z.literal(BVF_ONSCREEN_TEXT_LANGUAGE),
      })
      .strict(),
    persona: z
      .object({
        id: z.string().uuid(),
        code: z.string().trim().min(1).max(100),
      })
      .strict()
      .nullable(),
    direction: z.string().trim().min(1).max(2_000),
    factualRules: z
      .object({
        useVerifiedClaimsOnly: z.literal(true),
        excludeForbiddenClaims: z.literal(true),
        preservePhysicalScale: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type BvfVideoType = z.infer<typeof bvfVideoTypeSchema>;
export type BvfContentScope = z.infer<typeof bvfContentScopeSchema>;
export type BvfJobStatus = z.infer<typeof bvfJobStatusSchema>;
export type BvfAttemptStatus = z.infer<typeof bvfAttemptStatusSchema>;
export type BvfAssetType = z.infer<typeof bvfAssetTypeSchema>;
export type BvfMoney = z.infer<typeof bvfMoneySchema>;
export type BvfFactSource = z.infer<typeof bvfFactSourceSchema>;
export type BvfSourcedFact = z.infer<typeof bvfSourcedFactSchema>;
export type BvfSourcedClaim = z.infer<typeof bvfSourcedClaimSchema>;
export type BvfPhysicalDimensions = z.infer<
  typeof bvfPhysicalDimensionsSchema
>;
export type BvfResearchFact = z.infer<typeof bvfResearchFactSchema>;
export type BvfResearchSnapshot = z.infer<typeof bvfResearchSnapshotSchema>;
export type BvfFamilyAttributeKey = (typeof BVF_FAMILY_ATTRIBUTE_KEYS)[number];
export type BvfFamilyResearchFact = z.infer<
  typeof bvfFamilyResearchFactSchema
>;
export type BvfFamilyResearchSnapshot = z.infer<
  typeof bvfFamilyResearchSnapshotSchema
>;
export type BvfVariationSafe = z.infer<typeof bvfVariationSafeSchema>;
export type BvfVariationUnsafe = z.infer<typeof bvfVariationUnsafeSchema>;
export type BvfFamilyAnalysisSnapshot = z.infer<
  typeof bvfFamilyAnalysisSnapshotSchema
>;
export type BvfFamilyContentGuard = z.infer<
  typeof bvfFamilyContentGuardSchema
>;
export type BvfFamilyBriefInputSnapshot = z.infer<
  typeof bvfFamilyBriefInputSnapshotSchema
>;
export type BvfFamilyCreativeBrief = z.infer<
  typeof bvfFamilyCreativeBriefSchema
>;
export type BvfBriefInputSnapshot = z.infer<
  typeof bvfBriefInputSnapshotSchema
>;
export type BvfFactualSnapshot = z.infer<typeof bvfFactualSnapshotSchema>;
export type BvfCreativeBrief = z.infer<typeof bvfCreativeBriefSchema>;
