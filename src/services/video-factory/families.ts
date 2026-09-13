import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BVF_FAMILY_MAX_MEMBERS,
  BVF_FAMILY_MIN_MEMBERS,
  bvfFamilyAnalysisSnapshotSchema,
  type BvfFamilyResearchSnapshot,
} from "@/lib/video-factory/contracts";
import {
  buildBvfFamilyAnalysis,
  buildBvfFamilyBriefArtifacts,
  missingBvfFamilyResearchFields,
  suggestBvfFamilyCandidates,
  type BvfFamilyMemberInput,
  type BvfFamilySuggestionProduct,
} from "@/lib/video-factory/family-engine";
import { stableBvfJson } from "@/lib/video-factory/factual-engine";
import { createServiceClient } from "@/lib/supabase";
import { researchBvfFamilyMemberFacts } from "@/services/video-factory/family-research";
import type { Json } from "@/types/database";

const uuidSchema = z.string().uuid();
const suggestionResultSchema = z
  .object({
    suggestionId: z.string().uuid(),
    created: z.boolean(),
    status: z.enum(["pending", "accepted", "rejected"]),
  })
  .strict();
const reviewResultSchema = z
  .object({
    suggestionId: z.string().uuid(),
    status: z.enum(["accepted", "rejected"]),
    familyId: z.string().uuid().nullable(),
  })
  .strict();
const membershipResultSchema = z
  .object({
    familyId: z.string().uuid(),
    memberCount: z.number().int().min(BVF_FAMILY_MIN_MEMBERS).max(BVF_FAMILY_MAX_MEMBERS),
    changed: z.boolean(),
  })
  .strict();
const analysisResultSchema = z
  .object({
    analysisVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    created: z.boolean(),
  })
  .strict();
const briefResultSchema = z
  .object({
    briefVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    created: z.boolean(),
    status: z.literal("waiting_brief_approval"),
  })
  .strict();

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function nullablePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableBvfJson(value)).digest("hex");
}

async function authorizeManager(db: any, actorId: string) {
  const { data, error } = await db
    .from("profiles")
    .select("id,cargo")
    .eq("id", actorId)
    .maybeSingle();
  if (error) fail("BVF_FAMILY_ACTOR_LOOKUP_FAILED", error.message);
  if (!data || !["admin", "gerente"].includes(data.cargo)) {
    fail("BVF_FAMILY_PERMISSION_DENIED");
  }
}

function suggestionProduct(row: any): BvfFamilySuggestionProduct {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.nome),
    brand: nullableText(row.marca),
    category: nullableText(row.categoria),
    active: row.ativo === true,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function suggestBvfFamily(input: {
  seedProductId: string;
  actorId: string;
}) {
  const seedProductId = uuidSchema.parse(input.seedProductId);
  const actorId = uuidSchema.parse(input.actorId);
  const db: any = createServiceClient();
  await authorizeManager(db, actorId);

  const productColumns = "id,sku,nome,marca,categoria,ativo,updated_at";
  const { data: seedRow, error: seedError } = await db
    .from("produtos")
    .select(productColumns)
    .eq("id", seedProductId)
    .maybeSingle();
  if (seedError) fail("BVF_FAMILY_SEED_LOOKUP_FAILED", seedError.message);
  if (!seedRow) fail("BVF_FAMILY_SEED_NOT_FOUND");
  const seed = suggestionProduct(seedRow);
  if (!seed.active) fail("BVF_FAMILY_SEED_INACTIVE");
  if (!seed.brand || !seed.category) fail("BVF_FAMILY_SEED_IDENTITY_INCOMPLETE");

  const { data: poolRows, error: poolError } = await db
    .from("produtos")
    .select(productColumns)
    .eq("ativo", true)
    .eq("marca", seedRow.marca)
    .eq("categoria", seedRow.categoria)
    .order("sku", { ascending: true })
    .limit(1_000);
  if (poolError) fail("BVF_FAMILY_CANDIDATE_LOOKUP_FAILED", poolError.message);

  const suggestion = suggestBvfFamilyCandidates(
    seed,
    (poolRows ?? []).map(suggestionProduct),
  );
  if (!suggestion.candidates.length) fail("BVF_FAMILY_NO_CANDIDATES");
  const materialFingerprint = fingerprint({
    algorithmVersion: suggestion.algorithmVersion,
    seedProductId: suggestion.seed.id,
    candidateProductIds: suggestion.candidates.map((candidate) => candidate.id),
    candidateScores: suggestion.candidates.map((candidate) => candidate.score),
  });
  const { data, error } = await db.rpc("bvf_record_family_suggestion", {
    p_actor_id: actorId,
    p_seed_product_id: seedProductId,
    p_algorithm_version: suggestion.algorithmVersion,
    p_material_fingerprint: materialFingerprint,
    p_candidate_snapshot: suggestion as unknown as Json,
  });
  if (error) fail("BVF_FAMILY_SUGGESTION_PERSISTENCE_FAILED", error.message);
  return {
    ...suggestionResultSchema.parse(data),
    materialFingerprint,
    suggestion,
  };
}

export async function reviewBvfFamilySuggestion(input: {
  suggestionId: string;
  actorId: string;
  decision: "accept" | "reject";
  note?: string | null;
  family?: {
    familyKey: string;
    name: string;
    description?: string | null;
    memberProductIds: string[];
  };
}) {
  const suggestionId = uuidSchema.parse(input.suggestionId);
  const actorId = uuidSchema.parse(input.actorId);
  if (input.decision === "accept" && !input.family) {
    fail("BVF_FAMILY_ACCEPTANCE_PAYLOAD_REQUIRED");
  }
  const memberProductIds = input.family?.memberProductIds.map((id) => uuidSchema.parse(id)) ?? [];
  const db: any = createServiceClient();
  await authorizeManager(db, actorId);
  const { data, error } = await db.rpc("bvf_review_family_suggestion", {
    p_suggestion_id: suggestionId,
    p_actor_id: actorId,
    p_decision: input.decision,
    p_review_note: nullableText(input.note),
    p_family_key: input.family?.familyKey ?? null,
    p_family_name: input.family?.name ?? null,
    p_family_description: nullableText(input.family?.description),
    p_member_product_ids: memberProductIds,
  });
  if (error) fail("BVF_FAMILY_SUGGESTION_REVIEW_FAILED", error.message);
  return reviewResultSchema.parse(data);
}

export async function setBvfFamilyMembers(input: {
  familyId: string;
  actorId: string;
  memberProductIds: string[];
}) {
  const familyId = uuidSchema.parse(input.familyId);
  const actorId = uuidSchema.parse(input.actorId);
  const memberProductIds = input.memberProductIds.map((id) => uuidSchema.parse(id));
  const db: any = createServiceClient();
  await authorizeManager(db, actorId);
  const { data, error } = await db.rpc("bvf_set_family_members", {
    p_family_id: familyId,
    p_actor_id: actorId,
    p_member_product_ids: memberProductIds,
  });
  if (error) fail("BVF_FAMILY_MEMBERSHIP_UPDATE_FAILED", error.message);
  return membershipResultSchema.parse(data);
}

function emptyResearch(): BvfFamilyResearchSnapshot {
  return {
    status: "not_needed",
    searchedFields: [],
    sourceUrls: [],
    acceptedFacts: [],
  };
}

async function mapConcurrent<T, R>(
  rows: T[],
  concurrency: number,
  map: (row: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        output[index] = await map(rows[index]);
      }
    }),
  );
  return output;
}

async function loadFamilyAnalysisInput(
  db: any,
  familyId: string,
  signal?: AbortSignal,
) {
  const { data: family, error: familyError } = await db
    .from("video_families")
    .select("id,family_key,name,brand,category,active")
    .eq("id", familyId)
    .maybeSingle();
  if (familyError) fail("BVF_FAMILY_LOOKUP_FAILED", familyError.message);
  if (!family) fail("BVF_FAMILY_NOT_FOUND");
  if (!family.active) fail("BVF_FAMILY_INACTIVE");

  const { data: membershipRows, error: membershipError } = await db
    .from("video_family_products")
    .select("produto_id,sku,created_at")
    .eq("family_id", familyId)
    .is("removed_at", null)
    .order("sku", { ascending: true });
  if (membershipError) fail("BVF_FAMILY_MEMBERS_LOOKUP_FAILED", membershipError.message);
  if (
    !membershipRows ||
    membershipRows.length < BVF_FAMILY_MIN_MEMBERS ||
    membershipRows.length > BVF_FAMILY_MAX_MEMBERS ||
    membershipRows.some((row: any) => !row.produto_id)
  ) {
    fail("BVF_FAMILY_MEMBER_COUNT_INVALID");
  }
  const productIds = membershipRows.map((row: any) => String(row.produto_id));
  const { data: products, error: productsError } = await db
    .from("produtos")
    .select(
      "id,sku,nome,marca,categoria,gtin,descricao,peso_liq,ativo,updated_at,oferta_preferencial_id,ml_item_id",
    )
    .in("id", productIds);
  if (productsError) fail("BVF_FAMILY_PRODUCTS_LOOKUP_FAILED", productsError.message);
  if (!products || products.length !== productIds.length) fail("BVF_FAMILY_PRODUCT_NOT_FOUND");

  const [{ data: offers, error: offersError }, { data: listings, error: listingsError }] =
    await Promise.all([
      db
        .from("produto_fornecedor_ofertas")
        .select(
          "id,produto_id,nome,marca,gtin,descricao,sku_fornecedor,ativo,last_sync_at,updated_at",
        )
        .in("produto_id", productIds)
        .eq("ativo", true),
      db
        .from("anuncios_ml")
        .select("produto_id,ml_item_id,titulo,updated_at")
        .in("produto_id", productIds)
        .order("updated_at", { ascending: false }),
    ]);
  if (offersError) fail("BVF_FAMILY_OFFERS_LOOKUP_FAILED", offersError.message);
  if (listingsError) fail("BVF_FAMILY_LISTINGS_LOOKUP_FAILED", listingsError.message);

  const { data: kits, error: kitsError } = await db
    .from("produto_kits")
    .select("produto_id,ativo,updated_at")
    .in("produto_id", productIds);
  if (kitsError) fail("BVF_FAMILY_KITS_LOOKUP_FAILED", kitsError.message);
  const kitIds = (kits ?? []).map((row: any) => String(row.produto_id));
  const components = kitIds.length
    ? await db
        .from("produto_kit_componentes")
        .select("kit_produto_id,componente_produto_id,quantidade,updated_at")
        .in("kit_produto_id", kitIds)
    : { data: [], error: null };
  if (components.error) fail("BVF_FAMILY_KIT_COMPONENTS_LOOKUP_FAILED", components.error.message);

  const rawMembers: BvfFamilyMemberInput[] = membershipRows.map((membership: any) => {
    const product = products.find((row: any) => row.id === membership.produto_id);
    if (!product || product.sku !== membership.sku) fail("BVF_FAMILY_MEMBER_SKU_MISMATCH");
    const productOffers = (offers ?? [])
      .filter((row: any) => row.produto_id === product.id)
      .sort((left: any, right: any) => {
        if (left.id === product.oferta_preferencial_id) return -1;
        if (right.id === product.oferta_preferencial_id) return 1;
        return String(right.last_sync_at ?? right.updated_at).localeCompare(
          String(left.last_sync_at ?? left.updated_at),
        );
      });
    const offer = productOffers[0] ?? null;
    const listing = (listings ?? []).find((row: any) => row.produto_id === product.id) ?? null;
    const kit = (kits ?? []).find((row: any) => row.produto_id === product.id) ?? null;
    const kitComponents = (components.data ?? []).filter(
      (row: any) => row.kit_produto_id === product.id,
    );
    const kitReady =
      kit?.ativo === true &&
      kitComponents.length > 0 &&
      kitComponents.every(
        (row: any) => Number.isSafeInteger(Number(row.quantidade)) && Number(row.quantidade) > 0,
      );
    const kitStatus = !kit ? "not_kit" : kitReady ? "ready" : "inconclusive";
    return {
      product: {
        ...suggestionProduct(product),
        gtin: nullableText(product.gtin),
        description: nullableText(product.descricao),
        netWeightKg: nullablePositive(product.peso_liq),
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
      kit: {
        status: kitStatus,
        totalUnits: kitReady
          ? kitComponents.reduce((total: number, row: any) => total + Number(row.quantidade), 0)
          : null,
        reference: kit ? `produto_kits:${product.id}` : `produto_kits:absent:${product.id}`,
        observedAt: kit?.updated_at ?? product.updated_at,
      },
      research: emptyResearch(),
    };
  });

  const members = await mapConcurrent(rawMembers, 3, async (member) => ({
    ...member,
    research: await researchBvfFamilyMemberFacts({
      productId: member.product.id,
      name: member.product.name,
      brand: member.product.brand,
      gtin: member.product.gtin,
      supplierSkus: member.offer?.supplierSku ? [member.offer.supplierSku] : [],
      missingFields: missingBvfFamilyResearchFields(member),
      signal,
    }),
  }));

  return {
    family: {
      id: family.id,
      familyKey: family.family_key,
      name: family.name,
      brand: nullableText(family.brand),
      category: nullableText(family.category),
    },
    members,
  };
}

export async function analyzeBvfFamily(input: {
  familyId: string;
  actorId: string;
  signal?: AbortSignal;
}) {
  const familyId = uuidSchema.parse(input.familyId);
  const actorId = uuidSchema.parse(input.actorId);
  const db: any = createServiceClient();
  await authorizeManager(db, actorId);
  const engineInput = await loadFamilyAnalysisInput(db, familyId, input.signal);
  const artifacts = buildBvfFamilyAnalysis(engineInput);
  const materialFingerprint = fingerprint(artifacts.materialFingerprintPayload);
  const { data, error } = await db.rpc("bvf_persist_family_analysis", {
    p_family_id: familyId,
    p_actor_id: actorId,
    p_engine_version: artifacts.engineVersion,
    p_material_fingerprint: materialFingerprint,
    p_membership_snapshot: artifacts.membershipSnapshot as unknown as Json,
    p_analysis_snapshot: artifacts.analysisSnapshot as unknown as Json,
  });
  if (error) fail("BVF_FAMILY_ANALYSIS_PERSISTENCE_FAILED", error.message);
  return {
    ...analysisResultSchema.parse(data),
    materialFingerprint,
    analysisSnapshot: artifacts.analysisSnapshot,
  };
}

export async function prepareBvfFamilyBrief(input: {
  jobId: string;
  actorId: string;
}) {
  const jobId = uuidSchema.parse(input.jobId);
  const actorId = uuidSchema.parse(input.actorId);
  const db: any = createServiceClient();
  await authorizeManager(db, actorId);
  const { data: job, error: jobError } = await db
    .from("video_jobs")
    .select("id,family_id,family_key,video_type,content_scope,persona_id,status")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) fail("BVF_FAMILY_BRIEF_JOB_LOOKUP_FAILED", jobError.message);
  if (!job) fail("BVF_JOB_NOT_FOUND");
  if (job.video_type !== "FAMILY_VIDEO" || job.content_scope !== "FAMILY") {
    fail("BVF_FAMILY_BRIEF_SCOPE_REQUIRED");
  }
  if (!job.family_id || !job.family_key) fail("BVF_FAMILY_BRIEF_TARGET_REQUIRED");

  const { data: family, error: familyError } = await db
    .from("video_families")
    .select("id,family_key,default_persona_id,current_analysis_version_id,active")
    .eq("id", job.family_id)
    .maybeSingle();
  if (familyError) fail("BVF_FAMILY_LOOKUP_FAILED", familyError.message);
  if (!family || !family.active) fail("BVF_FAMILY_NOT_FOUND");
  if (family.family_key !== job.family_key) fail("BVF_FAMILY_BRIEF_TARGET_MISMATCH");
  if (!family.current_analysis_version_id) fail("BVF_FAMILY_ANALYSIS_REQUIRED");

  const { data: version, error: versionError } = await db
    .from("video_family_analysis_versions")
    .select("id,family_id,version,material_fingerprint,analysis_snapshot")
    .eq("id", family.current_analysis_version_id)
    .eq("family_id", family.id)
    .maybeSingle();
  if (versionError) fail("BVF_FAMILY_ANALYSIS_LOOKUP_FAILED", versionError.message);
  if (!version) fail("BVF_FAMILY_ANALYSIS_REQUIRED");

  const personaId = job.persona_id ?? family.default_persona_id;
  let persona: { id: string; code: string } | null = null;
  if (personaId) {
    const { data, error } = await db
      .from("video_personas")
      .select("id,code,status")
      .eq("id", personaId)
      .eq("status", "active")
      .maybeSingle();
    if (error) fail("BVF_FAMILY_PERSONA_LOOKUP_FAILED", error.message);
    if (!data) fail("BVF_FAMILY_ACTIVE_PERSONA_NOT_FOUND");
    persona = { id: data.id, code: data.code };
  }

  const analysis = bvfFamilyAnalysisSnapshotSchema.parse(version.analysis_snapshot);
  const artifacts = buildBvfFamilyBriefArtifacts({
    job: { id: job.id, familyId: family.id, familyKey: family.family_key },
    analysisVersion: {
      id: version.id,
      version: version.version,
      materialFingerprint: version.material_fingerprint,
    },
    analysis,
    persona,
  });
  const materialFingerprint = fingerprint(artifacts.materialFingerprintPayload);
  const { data, error } = await db.rpc("bvf_persist_family_brief_version", {
    p_job_id: job.id,
    p_actor_id: actorId,
    p_engine_version: artifacts.engineVersion,
    p_material_fingerprint: materialFingerprint,
    p_input_snapshot: artifacts.inputSnapshot as unknown as Json,
    p_factual_snapshot: artifacts.factualSnapshot as unknown as Json,
    p_creative_brief: artifacts.creativeBrief as unknown as Json,
    p_family_id: family.id,
    p_family_analysis_version_id: version.id,
    p_persona_id: persona?.id ?? null,
  });
  if (error) fail("BVF_FAMILY_BRIEF_PERSISTENCE_FAILED", error.message);
  return {
    ...briefResultSchema.parse(data),
    materialFingerprint,
    inputSnapshot: artifacts.inputSnapshot,
    factualSnapshot: artifacts.factualSnapshot,
    creativeBrief: artifacts.creativeBrief,
  };
}
