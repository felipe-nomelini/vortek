import { z } from "zod";

import {
  BVF_JOB_STATUSES,
  bvfJobStatusSchema,
  type BvfJobStatus,
} from "@/lib/video-factory/contracts";

export const BVF_UI_ENGINE_VERSION = "BVF-UI-01-v1" as const;

export const bvfCreativeSectionsSchema = z
  .object({
    hook: z.string().trim().max(2_000).default(""),
    problem: z.string().trim().max(2_000).default(""),
    solution: z.string().trim().max(2_000).default(""),
    demonstration: z.string().trim().max(4_000).default(""),
    humor: z.string().trim().max(1_000).default(""),
    dialogue: z.string().trim().max(4_000).default(""),
    onscreenText: z.string().trim().max(2_000).default(""),
    closing: z.string().trim().max(2_000).default(""),
  })
  .strict();

export const bvfBriefReviewSchema = z
  .object({
    expectedBriefVersionId: z.string().uuid(),
    direction: z.string().trim().min(1).max(2_000),
    sections: bvfCreativeSectionsSchema,
    claimDecisions: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            decision: z.enum(["verified", "forbidden"]),
          })
          .strict(),
      )
      .max(50),
    additionalForbiddenClaims: z.array(z.string().trim().min(1).max(500)).max(50),
    scaleReview: z.discriminatedUnion("status", [
      z.object({ status: z.literal("defined") }).strict(),
      z
        .object({
          status: z.literal("unavailable"),
          reason: z.string().trim().min(3).max(500),
        })
        .strict(),
    ]),
    selectedProductReferenceIds: z.array(z.string().uuid()).max(20),
    selectedPersonaReferenceIds: z.array(z.string().uuid()).max(3),
    variationUnsafeAcknowledgements: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .max(100),
  })
  .strict();

export type BvfBriefReviewInput = z.infer<typeof bvfBriefReviewSchema>;
export type BvfCreativeSections = z.infer<typeof bvfCreativeSectionsSchema>;

export type BvfJobStatusPresentation = {
  label: string;
  tone: "default" | "processing" | "success" | "warning" | "error";
};

export const BVF_JOB_STATUS_PRESENTATION: Record<
  BvfJobStatus,
  BvfJobStatusPresentation
> = {
  draft: { label: "Rascunho", tone: "default" },
  data_loaded: { label: "Dados carregados", tone: "processing" },
  brief_ready: { label: "Briefing pronto", tone: "processing" },
  waiting_brief_approval: {
    label: "Aguardando autorização para gerar",
    tone: "warning",
  },
  approved_for_generation: {
    label: "Briefing e custo autorizados",
    tone: "success",
  },
  queued: { label: "Na fila de geração", tone: "processing" },
  generating: { label: "Gerando", tone: "processing" },
  generated: { label: "Gerado", tone: "processing" },
  validating: { label: "Validando tecnicamente", tone: "processing" },
  waiting_content_approval: {
    label: "Aguardando aprovação do master",
    tone: "warning",
  },
  approved: { label: "Master aprovado", tone: "success" },
  rejected: { label: "Master rejeitado", tone: "error" },
  generation_error: { label: "Erro de geração", tone: "error" },
  validation_failed: { label: "Validação técnica falhou", tone: "error" },
  insufficient_api_balance: { label: "Saldo de API insuficiente", tone: "warning" },
  cancelled: { label: "Cancelado", tone: "default" },
};

if (Object.keys(BVF_JOB_STATUS_PRESENTATION).length !== BVF_JOB_STATUSES.length) {
  throw new Error("BVF_UI_JOB_STATUS_PRESENTATION_INCOMPLETE");
}

export function parseBvfJobStatusPresentation(value: unknown) {
  const parsed = bvfJobStatusSchema.safeParse(value);
  return parsed.success
    ? BVF_JOB_STATUS_PRESENTATION[parsed.data]
    : { label: "Estado desconhecido", tone: "default" as const };
}

export function isBvfUiReviewedCreativeBrief(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).schemaVersion ===
        "BVF-UI-CREATIVE-BRIEF-v1",
  );
}
