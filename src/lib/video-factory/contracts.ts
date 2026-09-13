import { z } from "zod";

export const BVF_PROMPT_LANGUAGE = "EN" as const;
export const BVF_DIALOGUE_LANGUAGE = "pt-BR" as const;
export const BVF_ONSCREEN_TEXT_LANGUAGE = "pt-BR" as const;

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

export type BvfVideoType = z.infer<typeof bvfVideoTypeSchema>;
export type BvfContentScope = z.infer<typeof bvfContentScopeSchema>;
export type BvfJobStatus = z.infer<typeof bvfJobStatusSchema>;
export type BvfAttemptStatus = z.infer<typeof bvfAttemptStatusSchema>;
export type BvfAssetType = z.infer<typeof bvfAssetTypeSchema>;
export type BvfMoney = z.infer<typeof bvfMoneySchema>;
