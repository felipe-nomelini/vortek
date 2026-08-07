import type { createServiceClient } from "@/lib/supabase";

const ACTIVE_JOB_STATUSES = new Set(["pendente", "rodando", "on_hold"]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

type ServiceClient = ReturnType<typeof createServiceClient>;

export type ReusableJob = {
  id: string;
  status: string;
  log: unknown;
};

function parseLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log !== "string") return [];
  try {
    const parsed = JSON.parse(log || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  const key = String(value || "").trim();
  return IDEMPOTENCY_KEY_PATTERN.test(key) ? key : null;
}

export function getJobIdempotencyKey(log: unknown): string | null {
  for (const entry of parseLog(log)) {
    const key = normalizeIdempotencyKey(entry?.payload?.idempotencyKey);
    if (key) return key;
  }
  return null;
}

export function getLatestJobSnapshot(log: unknown): any | null {
  const snapshots = parseLog(log)
    .filter((entry: any) => entry?.event === "progress_snapshot");
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

export function getJobPedidoId(log: unknown): string | null {
  for (const entry of parseLog(log)) {
    const pedidoId = String(entry?.payload?.pedidoId || "").trim();
    if (pedidoId) return pedidoId;
  }
  return null;
}

export function isJobUniqueViolation(error: unknown): boolean {
  return String((error as any)?.code || "") === "23505";
}

/**
 * Reutiliza a mesma execução quando a chave do cliente se repete ou quando já
 * existe job ativo para o mesmo recurso lógico.
 */
export async function findReusableJob(input: {
  client: ServiceClient;
  type: string;
  dedupeKey: string;
  idempotencyKey: string;
}): Promise<{ job: ReusableJob; reason: "same_request" | "active_job" } | null> {
  const { data, error } = await input.client
    .from("jobs")
    .select("id,status,log,created_at")
    .eq("tipo", input.type)
    .eq("dedupe_key", input.dedupeKey)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`Falha ao verificar job existente: ${error.message}`);
  const rows = (data || []) as ReusableJob[];
  const sameRequest = rows.find((job) => (
    getJobIdempotencyKey(job.log) === input.idempotencyKey
  ));
  if (sameRequest) return { job: sameRequest, reason: "same_request" };

  const activeJob = rows.find((job) => ACTIVE_JOB_STATUSES.has(String(job.status || "")));
  return activeJob ? { job: activeJob, reason: "active_job" } : null;
}
