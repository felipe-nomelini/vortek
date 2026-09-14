import { z } from "zod";

import {
  BVF_FAMILY_MAX_MEMBERS,
  BVF_FAMILY_MIN_MEMBERS,
  bvfJobStatusSchema,
  bvfVideoTypeSchema,
} from "@/lib/video-factory/contracts";

const productTargetSchema = z
  .object({ kind: z.literal("product"), productId: z.string().uuid() })
  .strict();
const familyTargetSchema = z
  .object({ kind: z.literal("family"), familyId: z.string().uuid() })
  .strict();

export const bvfCreateJobSchema = z
  .object({
    requestId: z.string().uuid(),
    target: z.discriminatedUnion("kind", [productTargetSchema, familyTargetSchema]),
    videoType: bvfVideoTypeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.target.kind === "family" && value.videoType === "FAMILY_VIDEO") ||
      (value.target.kind === "product" && value.videoType !== "FAMILY_VIDEO");
    if (!valid) context.addIssue({ code: "custom", message: "Tipo de vídeo incompatível com o alvo" });
  });

export const bvfJobListFiltersSchema = z
  .object({
    status: bvfJobStatusSchema.optional(),
    videoType: bvfVideoTypeSchema.optional(),
    search: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const bvfAuthorizeGenerationSchema = z
  .object({
    briefVersionId: z.string().uuid(),
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    estimatedCost: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

export const bvfCancelJobSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const bvfFamilyListFiltersSchema = z
  .object({
    search: z.string().trim().max(100).default(""),
    active: z.enum(["true", "false", "all"]).default("true"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const bvfSuggestionListFiltersSchema = z
  .object({
    status: z.enum(["pending", "accepted", "rejected", "all"]).default("pending"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const bvfSuggestFamilySchema = z
  .object({ seedProductId: z.string().uuid() })
  .strict();

export const bvfReviewFamilySuggestionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accept"),
      note: z.string().trim().min(1).max(500).optional(),
      family: z
        .object({
          familyKey: z.string().trim().min(1).max(120),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().min(1).max(2_000).optional(),
          memberProductIds: z
            .array(z.string().uuid())
            .min(BVF_FAMILY_MIN_MEMBERS)
            .max(BVF_FAMILY_MAX_MEMBERS),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      note: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
]);

export const bvfSetFamilyMembersSchema = z
  .object({
    memberProductIds: z
      .array(z.string().uuid())
      .min(BVF_FAMILY_MIN_MEMBERS)
      .max(BVF_FAMILY_MAX_MEMBERS),
  })
  .strict();

export type BvfCreateJobInput = z.infer<typeof bvfCreateJobSchema>;
export type BvfJobListFilters = z.infer<typeof bvfJobListFiltersSchema>;
export type BvfAuthorizeGenerationInput = z.infer<typeof bvfAuthorizeGenerationSchema>;
export type BvfFamilyListFilters = z.infer<typeof bvfFamilyListFiltersSchema>;
export type BvfSuggestionListFilters = z.infer<typeof bvfSuggestionListFiltersSchema>;
