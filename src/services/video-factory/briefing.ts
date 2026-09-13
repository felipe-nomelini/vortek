import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  bvfBriefInputSnapshotSchema,
  bvfCreativeBriefSchema,
  bvfFactualSnapshotSchema,
  type BvfResearchSnapshot,
} from "@/lib/video-factory/contracts";
import {
  buildBvfBriefArtifacts,
  stableBvfJson,
  type BvfBriefEngineInput,
} from "@/lib/video-factory/factual-engine";
import { createServiceClient } from "@/lib/supabase";
import { researchBvfProductFacts } from "@/services/video-factory/factual-research";
import type { Json } from "@/types/database";

const uuidSchema = z.string().uuid();
const persistenceResultSchema = z
  .object({
    briefVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    created: z.boolean(),
    status: z.string().min(1),
  })
  .strict();

export type PrepareBvfBriefInput = {
  jobId: string;
  actorId: string;
  signal?: AbortSignal;
};

export type PrepareBvfBriefResult = z.infer<typeof persistenceResultSchema> & {
  inputSnapshot: z.infer<typeof bvfBriefInputSnapshotSchema>;
  factualSnapshot: z.infer<typeof bvfFactualSnapshotSchema>;
  creativeBrief: z.infer<typeof bvfCreativeBriefSchema>;
};

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function nullablePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

export async function prepareBvfBrief(
  rawInput: PrepareBvfBriefInput,
): Promise<PrepareBvfBriefResult> {
  const jobId = uuidSchema.parse(rawInput.jobId);
  const actorId = uuidSchema.parse(rawInput.actorId);
  const db = createServiceClient();

  const { data: actor, error: actorError } = await db
    .from("profiles")
    .select("id, cargo")
    .eq("id", actorId)
    .maybeSingle();
  if (actorError) fail("BVF_BRIEF_ACTOR_LOOKUP_FAILED", actorError.message);
  if (!actor || !["admin", "gerente"].includes(actor.cargo)) {
    fail("BVF_BRIEF_PERMISSION_DENIED");
  }

  const { data: job, error: jobError } = await db
    .from("video_jobs")
    .select(
      "id, produto_id, sku, ml_item_id, content_scope, video_type, persona_id, status",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) fail("BVF_BRIEF_JOB_LOOKUP_FAILED", jobError.message);
  if (!job) fail("BVF_JOB_NOT_FOUND");
  if (job.content_scope !== "SKU") fail("BVF_BRIEF_SKU_SCOPE_REQUIRED");
  if (!["HUMAN_DEMO", "CINEMATIC_PRODUCT"].includes(job.video_type)) {
    fail("BVF_BRIEF_VIDEO_TYPE_UNSUPPORTED");
  }
  if (!job.sku) fail("BVF_BRIEF_JOB_SKU_REQUIRED");

  let productQuery = db
    .from("produtos")
    .select(
      "id, sku, nome, marca, gtin, categoria, descricao, peso_liq, updated_at, oferta_preferencial_id, ml_item_id",
    );
  productQuery = job.produto_id
    ? productQuery.eq("id", job.produto_id)
    : productQuery.eq("sku", job.sku);
  const { data: product, error: productError } = await productQuery.maybeSingle();
  if (productError) fail("BVF_BRIEF_PRODUCT_LOOKUP_FAILED", productError.message);
  if (!product) fail("BVF_PRODUCT_NOT_FOUND");
  if (product.sku !== job.sku) fail("BVF_BRIEF_SKU_MISMATCH");

  const offerColumns =
    "id, produto_id, nome, marca, gtin, descricao, sku_fornecedor, last_sync_at, updated_at";
  let offer: {
    id: string;
    produto_id: string;
    nome: string;
    marca: string | null;
    gtin: string | null;
    descricao: string;
    sku_fornecedor: string | null;
    last_sync_at: string | null;
    updated_at: string;
  } | null = null;

  if (product.oferta_preferencial_id) {
    const { data, error } = await db
      .from("produto_fornecedor_ofertas")
      .select(offerColumns)
      .eq("id", product.oferta_preferencial_id)
      .eq("produto_id", product.id)
      .maybeSingle();
    if (error) fail("BVF_BRIEF_OFFER_LOOKUP_FAILED", error.message);
    offer = data;
  }
  if (!offer) {
    const { data, error } = await db
      .from("produto_fornecedor_ofertas")
      .select(offerColumns)
      .eq("produto_id", product.id)
      .eq("ativo", true)
      .order("last_sync_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("BVF_BRIEF_OFFER_LOOKUP_FAILED", error.message);
    offer = data;
  }

  const requestedMlItemId = nullableText(job.ml_item_id ?? product.ml_item_id);
  let listing: {
    ml_item_id: string;
    titulo: string;
    updated_at: string;
  } | null = null;
  if (requestedMlItemId) {
    const { data, error } = await db
      .from("anuncios_ml")
      .select("ml_item_id, titulo, updated_at")
      .eq("ml_item_id", requestedMlItemId)
      .eq("produto_id", product.id)
      .maybeSingle();
    if (error) fail("BVF_BRIEF_LISTING_LOOKUP_FAILED", error.message);
    listing = data;
  }
  if (!listing) {
    const { data, error } = await db
      .from("anuncios_ml")
      .select("ml_item_id, titulo, updated_at")
      .eq("produto_id", product.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("BVF_BRIEF_LISTING_LOOKUP_FAILED", error.message);
    listing = data;
  }

  let persona: { id: string; code: string } | null = null;
  if (job.video_type === "HUMAN_DEMO") {
    let personaQuery = db
      .from("video_personas")
      .select("id, code")
      .eq("status", "active");
    personaQuery = job.persona_id
      ? personaQuery.eq("id", job.persona_id)
      : personaQuery.eq("code", "RAFA").eq("version", "v1");
    const { data, error } = await personaQuery.maybeSingle();
    if (error) fail("BVF_BRIEF_PERSONA_LOOKUP_FAILED", error.message);
    if (!data) fail("BVF_BRIEF_ACTIVE_PERSONA_NOT_FOUND");
    persona = data;
  }

  const builtAt = new Date().toISOString();
  const initialResearch: BvfResearchSnapshot = {
    status: "not_needed",
    searchedFields: [],
    sourceUrls: [],
    acceptedFacts: [],
  };
  const engineInput: Omit<BvfBriefEngineInput, "research"> = {
    job: {
      id: job.id,
      sku: job.sku,
      videoType: job.video_type as "HUMAN_DEMO" | "CINEMATIC_PRODUCT",
      mlItemId: nullableText(job.ml_item_id),
    },
    product: {
      id: product.id,
      sku: product.sku,
      name: product.nome,
      brand: nullableText(product.marca),
      gtin: nullableText(product.gtin),
      category: nullableText(product.categoria),
      description: nullableText(product.descricao),
      netWeightKg: nullablePositive(product.peso_liq),
      updatedAt: nullableText(product.updated_at),
    },
    offer: offer
      ? {
          id: offer.id,
          name: nullableText(offer.nome),
          brand: nullableText(offer.marca),
          gtin: nullableText(offer.gtin),
          description: nullableText(offer.descricao),
          supplierSku: nullableText(offer.sku_fornecedor),
          observedAt: offer.last_sync_at ?? offer.updated_at,
        }
      : null,
    listing: listing
      ? {
          itemId: listing.ml_item_id,
          title: nullableText(listing.titulo),
          observedAt: listing.updated_at,
        }
      : null,
    persona,
    builtAt,
  };

  const initialArtifacts = buildBvfBriefArtifacts({
    ...engineInput,
    research: initialResearch,
  });
  const research = await researchBvfProductFacts({
    productId: product.id,
    name: product.nome,
    brand: nullableText(product.marca),
    gtin: nullableText(product.gtin),
    supplierSkus: offer?.sku_fornecedor ? [offer.sku_fornecedor] : [],
    missingFields: initialArtifacts.factualSnapshot.missingFacts,
    signal: rawInput.signal,
  });
  const artifacts = buildBvfBriefArtifacts({ ...engineInput, research });
  const materialFingerprint = createHash("sha256")
    .update(stableBvfJson(artifacts.materialFingerprintPayload))
    .digest("hex");

  const { data: persistenceData, error: persistenceError } = await db.rpc(
    "bvf_persist_brief_version",
    {
      p_job_id: job.id,
      p_actor_id: actorId,
      p_engine_version: artifacts.engineVersion,
      p_material_fingerprint: materialFingerprint,
      p_input_snapshot: artifacts.inputSnapshot as Json,
      p_factual_snapshot: artifacts.factualSnapshot as Json,
      p_creative_brief: artifacts.creativeBrief as Json,
      p_product_id: product.id,
      p_persona_id: persona?.id,
    },
  );
  if (persistenceError) {
    fail("BVF_BRIEF_PERSISTENCE_FAILED", persistenceError.message);
  }
  const persisted = persistenceResultSchema.parse(persistenceData);

  return {
    ...persisted,
    inputSnapshot: artifacts.inputSnapshot,
    factualSnapshot: artifacts.factualSnapshot,
    creativeBrief: artifacts.creativeBrief,
  };
}
