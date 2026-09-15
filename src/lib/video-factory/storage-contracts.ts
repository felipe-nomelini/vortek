import { z } from "zod";

export const BVF_REFERENCE_SLOTS = ["front", "profile", "full_body"] as const;
export const BVF_REFERENCE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const BVF_REFERENCE_MAX_BYTES = 6 * 1024 * 1024;
export const BVF_REFERENCE_MAX_DIMENSION = 8_192;
export const BVF_REFERENCE_MAX_PIXELS = 50_000_000;
export const BVF_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const bvfReferenceSlotSchema = z.enum(BVF_REFERENCE_SLOTS);
export const bvfReferenceTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("persona"),
      personaId: z.string().uuid(),
      slot: bvfReferenceSlotSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("product"),
      productId: z.string().uuid(),
    })
    .strict(),
]);

export const bvfReferenceUploadFieldsSchema = z
  .object({
    requestId: z.string().uuid(),
    target: bvfReferenceTargetSchema,
  })
  .strict();

export const bvfProductImageImportSchema = z
  .object({
    requestId: z.string().uuid(),
    productId: z.string().uuid(),
    sourceUrl: z.string().trim().url().startsWith("https://").max(2_000),
  })
  .strict();

export const bvfReferenceListFiltersSchema = z
  .object({
    personaId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    includeInactive: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(Boolean(value.personaId)) + Number(Boolean(value.productId)) !== 1) {
      context.addIssue({
        code: "custom",
        message: "Informe exatamente uma persona ou um produto",
      });
    }
  });

export const bvfDeactivateReferenceSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type BvfReferenceSlot = z.infer<typeof bvfReferenceSlotSchema>;
export type BvfReferenceTarget = z.infer<typeof bvfReferenceTargetSchema>;
export type BvfReferenceListFilters = z.infer<typeof bvfReferenceListFiltersSchema>;
