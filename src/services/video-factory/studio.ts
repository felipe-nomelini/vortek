import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { hasPermission, type VortekRole } from "@/lib/permissions";
import { assertVortekSku } from "@/lib/product-master-sku";
import { stableBvfJson } from "@/lib/video-factory/factual-engine";
import {
  BVF_UI_ENGINE_VERSION,
  bvfBriefReviewSchema,
  type BvfBriefReviewInput,
} from "@/lib/video-factory/ui-contracts";
import { createServiceClient } from "@/lib/supabase";

const uuidSchema = z.string().uuid();
const commandResultSchema = z
  .object({
    briefVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    created: z.boolean(),
    status: z.string().min(1),
    approvalInvalidated: z.boolean().optional(),
  })
  .passthrough();

const ASSET_COLUMNS = [
  "id",
  "asset_type",
  "persona_id",
  "produto_id",
  "reference_slot",
  "active",
  "mime_type",
  "width",
  "height",
  "checksum_sha256",
  "metadata",
  "created_by",
  "deactivated_at",
  "deactivated_by",
  "deactivation_reason",
  "created_at",
].join(",");

export class BvfStudioError extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super(code, cause ? { cause } : undefined);
  }
}

function fail(code: string, cause?: unknown): never {
  throw new BvfStudioError(code, cause);
}

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function nullablePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    try {
      const url = new URL(String(candidate));
      return url.protocol === "https:" ? [url.toString()] : [];
    } catch {
      return [];
    }
  });
}

async function canManage(db: any, actorId: string): Promise<boolean> {
  const { data, error } = await db
    .from("profiles")
    .select("cargo")
    .eq("id", uuidSchema.parse(actorId))
    .maybeSingle();
  if (error || !data) return false;
  return hasPermission(data.cargo as VortekRole, "video_factory.manage");
}

export async function getBvfStudioProductBySku(rawSku: string, actorId: string) {
  let sku: string;
  try {
    sku = assertVortekSku(rawSku);
  } catch (error) {
    fail("BVF_STUDIO_SKU_INVALID", error);
  }
  const db: any = createServiceClient();
  const [{ data: product, error }, manage] = await Promise.all([
    db
      .from("produtos")
      .select(
        "id,sku,nome,marca,categoria,descricao,imagens,ativo,estoque,peso_liq,largura,altura,profundidade,updated_at",
      )
      .eq("sku", sku)
      .maybeSingle(),
    canManage(db, actorId),
  ]);
  if (error) fail("BVF_STUDIO_PRODUCT_READ_FAILED", error);
  if (!product) fail("BVF_PRODUCT_NOT_FOUND");

  const [listings, references] = await Promise.all([
    db
      .from("anuncios_ml")
      .select(
        "ml_item_id,titulo,status,preco_ml,vendidos,visitas,qualidade,qualidade_info,permalink,thumbnail,updated_at",
      )
      .eq("produto_id", product.id)
      .order("updated_at", { ascending: false }),
    db
      .from("video_assets")
      .select(ASSET_COLUMNS)
      .eq("asset_type", "product_reference")
      .eq("produto_id", product.id)
      .order("active", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (listings.error) fail("BVF_STUDIO_LISTINGS_READ_FAILED", listings.error);
  if (references.error) fail("BVF_STUDIO_REFERENCES_READ_FAILED", references.error);

  return {
    canManage: manage,
    product: {
      id: product.id,
      sku: product.sku,
      name: product.nome,
      brand: nullableText(product.marca),
      category: nullableText(product.categoria),
      description: nullableText(product.descricao),
      active: product.ativo === true,
      stock: Number(product.estoque ?? 0),
      dimensions: {
        widthCm: nullablePositive(product.largura),
        heightCm: nullablePositive(product.altura),
        depthCm: nullablePositive(product.profundidade),
        weightGrams: nullablePositive(product.peso_liq)
          ? Number(product.peso_liq) * 1_000
          : null,
      },
      images: safeImageUrls(product.imagens),
      updatedAt: nullableText(product.updated_at),
    },
    listings: (listings.data ?? []).map((listing: any) => ({
      itemId: listing.ml_item_id,
      title: nullableText(listing.titulo),
      status: nullableText(listing.status),
      price: typeof listing.preco_ml === "number" ? listing.preco_ml : null,
      sold: Number(listing.vendidos ?? 0),
      visits: Number(listing.visitas ?? 0),
      quality: typeof listing.qualidade === "number" ? listing.qualidade : null,
      tip:
        listing.qualidade_info && typeof listing.qualidade_info === "object"
          ? nullableText(listing.qualidade_info.dica)
          : null,
      permalink: nullableText(listing.permalink),
      thumbnail: nullableText(listing.thumbnail),
      updatedAt: nullableText(listing.updated_at),
    })),
    references: references.data ?? [],
  };
}

export async function listBvfStudioPersonas(actorId: string) {
  const db: any = createServiceClient();
  const [{ data: personas, error }, manage] = await Promise.all([
    db
      .from("video_personas")
      .select(
        "id,code,version,name,status,role,visual_description,personality,voice_description,accent,humor_style,allowed_categories,forbidden_categories,dialogue_rules,created_at,updated_at",
      )
      .order("code")
      .order("version", { ascending: false }),
    canManage(db, actorId),
  ]);
  if (error) fail("BVF_STUDIO_PERSONAS_READ_FAILED", error);
  const ids = (personas ?? []).map((persona: any) => persona.id);
  const references = ids.length
    ? await db
        .from("video_assets")
        .select(ASSET_COLUMNS)
        .eq("asset_type", "persona_reference")
        .in("persona_id", ids)
        .order("active", { ascending: false })
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (references.error) fail("BVF_STUDIO_REFERENCES_READ_FAILED", references.error);
  const byPersona = new Map<string, any[]>();
  for (const asset of references.data ?? []) {
    const current = byPersona.get(asset.persona_id) ?? [];
    current.push(asset);
    byPersona.set(asset.persona_id, current);
  }
  return {
    canManage: manage,
    data: (personas ?? []).map((persona: any) => ({
      ...persona,
      references: byPersona.get(persona.id) ?? [],
    })),
  };
}

function currentVerifiedClaims(factualSnapshot: any): any[] {
  return Array.isArray(factualSnapshot?.verifiedClaims)
    ? factualSnapshot.verifiedClaims
    : [];
}

function currentUnsafeAttributes(factualSnapshot: any): any[] {
  return Array.isArray(factualSnapshot?.variationUnsafe)
    ? factualSnapshot.variationUnsafe
    : [];
}

function assertReviewCompleteness(
  input: BvfBriefReviewInput,
  factualSnapshot: any,
) {
  const claims = currentVerifiedClaims(factualSnapshot);
  const indexes = input.claimDecisions.map((decision) => decision.index);
  if (
    indexes.length !== claims.length ||
    new Set(indexes).size !== claims.length ||
    indexes.some((index) => index < 0 || index >= claims.length)
  ) {
    fail("BVF_UI_CLAIM_REVIEW_INCOMPLETE");
  }

  const unsafeKeys = currentUnsafeAttributes(factualSnapshot).map((item) =>
    String(item?.key ?? ""),
  );
  if (
    unsafeKeys.some(
      (key) => !input.variationUnsafeAcknowledgements.includes(key),
    )
  ) {
    fail("BVF_UI_VARIATION_REVIEW_INCOMPLETE");
  }

  const dimensions = factualSnapshot?.physicalDimensions;
  const hasScale = Boolean(
    dimensions?.widthCm && dimensions?.heightCm && dimensions?.depthCm,
  );
  if (input.scaleReview.status === "defined" && !hasScale) {
    fail("BVF_UI_SCALE_NOT_DEFINED");
  }
}

function normalizedLines(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function blockedFamilyTokens(factualSnapshot: any): string[] {
  return currentUnsafeAttributes(factualSnapshot).flatMap((item) => [
    nullableText(item?.key),
    nullableText(item?.label),
    ...(Array.isArray(item?.members)
      ? item.members.map((member: any) => nullableText(member?.value))
      : []),
  ]).filter((value): value is string => Boolean(value && value.length >= 2));
}

function normalizeForGuard(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function assertFamilyNarrativeSafe(input: BvfBriefReviewInput, factualSnapshot: any) {
  if (factualSnapshot?.schemaVersion !== "BVF-FAMILY-ANALYSIS-v1") return;
  const narrative = normalizeForGuard(
    [input.direction, ...Object.values(input.sections)].join(" "),
  );
  for (const token of blockedFamilyTokens(factualSnapshot)) {
    const normalized = normalizeForGuard(token);
    if (normalized.length >= 3 && narrative.includes(normalized)) {
      fail("BVF_UI_VARIATION_UNSAFE_CONTENT");
    }
  }
}

export async function reviewBvfJobBrief(
  rawJobId: string,
  rawInput: unknown,
  actorId: string,
) {
  const jobId = uuidSchema.parse(rawJobId);
  const input = bvfBriefReviewSchema.parse(rawInput);
  const db: any = createServiceClient();
  const [{ data: job, error }, manage] = await Promise.all([
    db
      .from("video_jobs")
      .select(
        "id,produto_id,family_id,persona_id,content_scope,video_type,status,current_brief_version_id",
      )
      .eq("id", jobId)
      .maybeSingle(),
    canManage(db, actorId),
  ]);
  if (error) fail("BVF_UI_JOB_READ_FAILED", error);
  if (!job) fail("BVF_JOB_NOT_FOUND");
  if (!manage) fail("BVF_UI_PERMISSION_DENIED");
  if (!job.current_brief_version_id) fail("BVF_UI_BRIEF_REQUIRED");

  const { data: brief, error: briefError } = await db
    .from("video_brief_versions")
    .select(
      "id,version,engine_version,input_snapshot,factual_snapshot,creative_brief,family_analysis_version_id",
    )
    .eq("job_id", jobId)
    .eq("id", job.current_brief_version_id)
    .maybeSingle();
  if (briefError) fail("BVF_UI_BRIEF_READ_FAILED", briefError);
  if (!brief) fail("BVF_UI_BRIEF_REQUIRED");

  assertReviewCompleteness(input, brief.factual_snapshot);
  assertFamilyNarrativeSafe(input, brief.factual_snapshot);

  const referenceIds = [
    ...new Set([
      ...input.selectedProductReferenceIds,
      ...input.selectedPersonaReferenceIds,
    ]),
  ];
  const references = referenceIds.length
    ? await db
        .from("video_assets")
        .select(ASSET_COLUMNS)
        .in("id", referenceIds)
    : { data: [], error: null };
  if (references.error) fail("BVF_UI_REFERENCES_READ_FAILED", references.error);
  if ((references.data ?? []).length !== referenceIds.length) {
    fail("BVF_UI_REFERENCE_NOT_FOUND");
  }
  const assetsById = new Map<string, any>(
    (references.data ?? []).map((asset: any) => [asset.id, asset]),
  );
  const referenceSnapshot = referenceIds.map((id) => {
    const asset = assetsById.get(id);
    if (!asset) fail("BVF_UI_REFERENCE_NOT_FOUND");
    return {
      assetId: asset.id,
      assetType: asset.asset_type,
      referenceSlot: asset.reference_slot,
      checksumSha256: asset.checksum_sha256,
      width: asset.width,
      height: asset.height,
    };
  });

  const claimDecisions = input.claimDecisions.map((decision) => ({
    ...decision,
    text: String(currentVerifiedClaims(brief.factual_snapshot)[decision.index]?.text ?? ""),
  }));
  const creativeBrief = {
    schemaVersion: "BVF-UI-CREATIVE-BRIEF-v1",
    target: brief.creative_brief?.target ?? null,
    languages: brief.creative_brief?.languages ?? null,
    persona: brief.creative_brief?.persona ?? null,
    direction: input.direction,
    sections: input.sections,
    factualRules: brief.creative_brief?.factualRules ?? null,
    ...(brief.creative_brief?.contentGuard
      ? { contentGuard: brief.creative_brief.contentGuard }
      : {}),
    references: referenceSnapshot,
    review: {
      claimDecisions,
      additionalForbiddenClaims: normalizedLines(input.additionalForbiddenClaims).map(
        (text) => ({
          text,
          source: { kind: "operator_review", reference: actorId },
        }),
      ),
      scale: input.scaleReview,
      variationUnsafeAcknowledgements: [
        ...new Set(input.variationUnsafeAcknowledgements),
      ],
    },
  };
  const materialFingerprint = createHash("sha256")
    .update(
      stableBvfJson({
        engineVersion: BVF_UI_ENGINE_VERSION,
        inputSnapshot: brief.input_snapshot,
        factualSnapshot: brief.factual_snapshot,
        creativeBrief,
      }),
    )
    .digest("hex");

  const { data, error: persistenceError } = await db.rpc(
    "bvf_persist_reviewed_brief_version",
    {
      p_job_id: jobId,
      p_actor_id: uuidSchema.parse(actorId),
      p_expected_brief_version_id: input.expectedBriefVersionId,
      p_engine_version: BVF_UI_ENGINE_VERSION,
      p_material_fingerprint: materialFingerprint,
      p_creative_brief: creativeBrief,
      p_reference_asset_ids: referenceIds,
    },
  );
  if (persistenceError) fail("BVF_UI_BRIEF_PERSISTENCE_FAILED", persistenceError);
  return commandResultSchema.parse(data);
}
