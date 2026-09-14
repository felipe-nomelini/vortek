import "server-only";

import { z } from "zod";

import { hasPermission, type VortekRole } from "@/lib/permissions";
import type {
  BvfAuthorizeGenerationInput,
  BvfCreateJobInput,
  BvfFamilyListFilters,
  BvfJobListFilters,
  BvfSuggestionListFilters,
} from "@/lib/video-factory/workflow-contracts";
import { createServiceClient } from "@/lib/supabase";
import { prepareBvfBrief } from "@/services/video-factory/briefing";
import {
  analyzeBvfFamily,
  prepareBvfFamilyBrief,
} from "@/services/video-factory/families";

const uuidSchema = z.string().uuid();
const commandResultSchema = z
  .object({
    jobId: z.string().uuid(),
    status: z.string().min(1),
    created: z.boolean().optional(),
    changed: z.boolean().optional(),
    authorized: z.boolean().optional(),
  })
  .passthrough();

const JOB_COLUMNS = [
  "id", "produto_id", "sku", "family_id", "family_key", "ml_item_id",
  "video_type", "content_scope", "persona_id", "persona_code", "persona_version",
  "status", "current_brief_version_id", "prompt_template_code",
  "prompt_template_version", "prompt_final", "generation_provider", "generation_model",
  "estimated_cost", "estimated_cost_currency", "generation_approved_at",
  "generation_approved_by", "generation_approved_brief_version_id", "output_asset_id",
  "approved_at", "approved_by", "rejected_at", "rejected_by", "rejection_reason",
  "rejection_code", "cancelled_at", "cancelled_by", "cancellation_reason",
  "created_by", "created_at", "updated_at",
].join(",");

export class BvfWorkflowError extends Error {
  constructor(
    readonly code: string,
    readonly context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(code, cause ? { cause } : undefined);
  }
}

function fail(code: string, cause?: unknown, context: Record<string, unknown> = {}): never {
  throw new BvfWorkflowError(code, context, cause);
}

function safeSearch(value: string) {
  return value.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim();
}

async function canManage(db: any, actorId: string) {
  const { data, error } = await db.from("profiles").select("cargo").eq("id", actorId).maybeSingle();
  if (error || !data) return false;
  return hasPermission(data.cargo as VortekRole, "video_factory.manage");
}

function availableActions(job: any, manage: boolean) {
  if (!manage) return [];
  const actions: string[] = [];
  if (["draft", "data_loaded", "brief_ready", "waiting_brief_approval"].includes(job.status)) {
    actions.push("prepare_brief");
  }
  if (
    job.status === "waiting_brief_approval" &&
    job.current_brief_version_id &&
    String(job.prompt_final ?? "").trim() &&
    String(job.generation_provider ?? "").trim() &&
    String(job.generation_model ?? "").trim() &&
    job.estimated_cost !== null &&
    job.estimated_cost_currency
  ) {
    actions.push("authorize_generation");
  }
  if ([
    "draft", "data_loaded", "brief_ready", "waiting_brief_approval",
    "approved_for_generation", "generation_error", "validation_failed",
    "insufficient_api_balance",
  ].includes(job.status)) actions.push("cancel");
  return actions;
}

export async function listBvfJobs(input: BvfJobListFilters, actorId: string) {
  const db: any = createServiceClient();
  let query = db
    .from("video_jobs")
    .select(JOB_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((input.page - 1) * input.pageSize, input.page * input.pageSize - 1);
  if (input.status) query = query.eq("status", input.status);
  if (input.videoType) query = query.eq("video_type", input.videoType);
  const term = safeSearch(input.search);
  if (term) {
    query = query.or(`sku.ilike.%${term}%,family_key.ilike.%${term}%,ml_item_id.ilike.%${term}%`);
  }
  const [{ data, error, count }, manage] = await Promise.all([query, canManage(db, actorId)]);
  if (error) fail("BVF_WORKFLOW_JOB_LIST_FAILED", error);
  return {
    data: (data ?? []).map((job: any) => ({ ...job, availableActions: availableActions(job, manage) })),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    canManage: manage,
  };
}

export async function getBvfJob(jobId: string, actorId: string) {
  const id = uuidSchema.parse(jobId);
  const db: any = createServiceClient();
  const [{ data: job, error }, manage] = await Promise.all([
    db.from("video_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle(),
    canManage(db, actorId),
  ]);
  if (error) fail("BVF_WORKFLOW_JOB_READ_FAILED", error);
  if (!job) fail("BVF_JOB_NOT_FOUND");
  const { data: versions, error: versionsError } = await db
    .from("video_brief_versions")
    .select("id,version,engine_version,material_fingerprint,family_analysis_version_id,created_by,created_at")
    .eq("job_id", id)
    .order("version", { ascending: false });
  if (versionsError) fail("BVF_WORKFLOW_BRIEF_HISTORY_FAILED", versionsError);
  let currentBrief = null;
  if (job.current_brief_version_id) {
    const current = await db
      .from("video_brief_versions")
      .select("id,version,engine_version,material_fingerprint,input_snapshot,factual_snapshot,creative_brief,family_analysis_version_id,created_by,created_at")
      .eq("job_id", id)
      .eq("id", job.current_brief_version_id)
      .maybeSingle();
    if (current.error) fail("BVF_WORKFLOW_BRIEF_READ_FAILED", current.error);
    currentBrief = current.data;
  }
  return {
    ...job,
    currentBrief,
    briefVersions: versions ?? [],
    availableActions: availableActions(job, manage),
    canManage: manage,
  };
}

export async function prepareBvfJobBrief(jobId: string, actorId: string) {
  const id = uuidSchema.parse(jobId);
  const db: any = createServiceClient();
  const { data: job, error } = await db
    .from("video_jobs")
    .select("id,content_scope,family_id,status")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("BVF_WORKFLOW_JOB_READ_FAILED", error);
  if (!job) fail("BVF_JOB_NOT_FOUND");
  if (!["draft", "data_loaded", "brief_ready", "waiting_brief_approval"].includes(job.status)) {
    fail("BVF_WORKFLOW_BRIEF_NOT_EDITABLE");
  }
  if (job.content_scope === "FAMILY") {
    if (!job.family_id) fail("BVF_WORKFLOW_FAMILY_TARGET_REQUIRED");
    const family = await db
      .from("video_families")
      .select("current_analysis_version_id")
      .eq("id", job.family_id)
      .maybeSingle();
    if (family.error) fail("BVF_WORKFLOW_FAMILY_READ_FAILED", family.error);
    if (!family.data?.current_analysis_version_id) {
      await analyzeBvfFamily({ familyId: job.family_id, actorId });
    }
    return prepareBvfFamilyBrief({ jobId: id, actorId });
  }
  return prepareBvfBrief({ jobId: id, actorId });
}

export async function createAndPrepareBvfJob(input: BvfCreateJobInput, actorId: string) {
  const db: any = createServiceClient();
  const productId = input.target.kind === "product" ? input.target.productId : null;
  const familyId = input.target.kind === "family" ? input.target.familyId : null;
  const { data, error } = await db.rpc("bvf_create_video_job", {
    p_actor_id: actorId,
    p_request_id: input.requestId,
    p_product_id: productId,
    p_family_id: familyId,
    p_video_type: input.videoType,
  });
  if (error) fail("BVF_WORKFLOW_JOB_CREATE_FAILED", error);
  const command = commandResultSchema.parse(data);
  if (["draft", "data_loaded", "brief_ready"].includes(command.status)) {
    try {
      await prepareBvfJobBrief(command.jobId, actorId);
    } catch (error) {
      fail("BVF_WORKFLOW_BRIEF_PREPARATION_FAILED", error, {
        jobId: command.jobId,
        canRetry: true,
      });
    }
  }
  return { created: command.created === true, job: await getBvfJob(command.jobId, actorId) };
}

export async function authorizeBvfGeneration(
  jobId: string,
  input: BvfAuthorizeGenerationInput,
  actorId: string,
) {
  const db: any = createServiceClient();
  const { data, error } = await db.rpc("bvf_authorize_video_generation", {
    p_job_id: uuidSchema.parse(jobId),
    p_actor_id: actorId,
    p_brief_version_id: input.briefVersionId,
    p_provider: input.provider,
    p_model: input.model,
    p_estimated_cost: input.estimatedCost,
    p_currency: input.currency,
  });
  if (error) fail("BVF_WORKFLOW_GENERATION_AUTHORIZATION_FAILED", error);
  return commandResultSchema.parse(data);
}

export async function cancelBvfJob(jobId: string, actorId: string, reason?: string) {
  const db: any = createServiceClient();
  const { data, error } = await db.rpc("bvf_cancel_video_job", {
    p_job_id: uuidSchema.parse(jobId),
    p_actor_id: actorId,
    p_reason: reason ?? null,
  });
  if (error) fail("BVF_WORKFLOW_JOB_CANCELLATION_FAILED", error);
  return commandResultSchema.parse(data);
}

export async function listBvfFamilies(input: BvfFamilyListFilters) {
  const db: any = createServiceClient();
  let query = db
    .from("video_families")
    .select("id,family_key,name,brand,category,description,default_persona_id,default_video_type,active,current_analysis_version_id,created_at,updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((input.page - 1) * input.pageSize, input.page * input.pageSize - 1);
  if (input.active !== "all") query = query.eq("active", input.active === "true");
  const term = safeSearch(input.search);
  if (term) query = query.or(`family_key.ilike.%${term}%,name.ilike.%${term}%,brand.ilike.%${term}%`);
  const { data, error, count } = await query;
  if (error) fail("BVF_WORKFLOW_FAMILY_LIST_FAILED", error);
  const ids = (data ?? []).map((row: any) => row.id);
  const members = ids.length
    ? await db.from("video_family_products").select("family_id").in("family_id", ids).is("removed_at", null)
    : { data: [], error: null };
  if (members.error) fail("BVF_WORKFLOW_FAMILY_MEMBERS_READ_FAILED", members.error);
  const counts = new Map<string, number>();
  for (const member of members.data ?? []) counts.set(member.family_id, (counts.get(member.family_id) ?? 0) + 1);
  return {
    data: (data ?? []).map((row: any) => ({ ...row, activeMemberCount: counts.get(row.id) ?? 0 })),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function getBvfFamily(familyId: string) {
  const id = uuidSchema.parse(familyId);
  const db: any = createServiceClient();
  const family = await db
    .from("video_families")
    .select("id,family_key,name,brand,category,description,verified_claims,forbidden_claims,variation_safe,variation_unsafe,default_persona_id,default_video_type,active,current_analysis_version_id,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (family.error) fail("BVF_WORKFLOW_FAMILY_READ_FAILED", family.error);
  if (!family.data) fail("BVF_FAMILY_NOT_FOUND");
  const [members, analyses] = await Promise.all([
    db.from("video_family_products")
      .select("id,produto_id,sku,created_by,created_at,removed_by,removed_at")
      .eq("family_id", id).order("created_at", { ascending: true }),
    db.from("video_family_analysis_versions")
      .select("id,version,engine_version,material_fingerprint,created_by,created_at")
      .eq("family_id", id).order("version", { ascending: false }),
  ]);
  if (members.error || analyses.error) fail("BVF_WORKFLOW_FAMILY_DETAIL_FAILED", members.error ?? analyses.error);
  let currentAnalysis = null;
  if (family.data.current_analysis_version_id) {
    const current = await db.from("video_family_analysis_versions")
      .select("id,version,engine_version,material_fingerprint,membership_snapshot,analysis_snapshot,created_by,created_at")
      .eq("family_id", id).eq("id", family.data.current_analysis_version_id).maybeSingle();
    if (current.error) fail("BVF_WORKFLOW_FAMILY_ANALYSIS_READ_FAILED", current.error);
    currentAnalysis = current.data;
  }
  return { ...family.data, members: members.data ?? [], analysisVersions: analyses.data ?? [], currentAnalysis };
}

export async function listBvfFamilySuggestions(input: BvfSuggestionListFilters) {
  const db: any = createServiceClient();
  let query = db.from("video_family_suggestions")
    .select("id,seed_product_id,seed_sku,algorithm_version,candidate_snapshot,status,created_by,reviewed_by,review_note,review_snapshot,reviewed_at,confirmed_family_id,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((input.page - 1) * input.pageSize, input.page * input.pageSize - 1);
  if (input.status !== "all") query = query.eq("status", input.status);
  const { data, error, count } = await query;
  if (error) fail("BVF_WORKFLOW_SUGGESTION_LIST_FAILED", error);
  return { data: data ?? [], total: count ?? 0, page: input.page, pageSize: input.pageSize };
}
