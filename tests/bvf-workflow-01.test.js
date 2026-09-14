const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260914090000_bvf_workflow_01.sql"),
  "utf8",
);
const executable = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const load = require("./helpers/load-integration-module");
const zod = require("zod");
const contracts = require("../src/lib/video-factory/contracts.ts");
const workflowContracts = load("src/lib/video-factory/workflow-contracts.ts", {
  zod,
  "@/lib/video-factory/contracts": contracts,
});

test("migration limita a state machine ao domínio BVF", () => {
  assert.match(executable, /create function public\.bvf_create_video_job/i);
  assert.match(executable, /create function public\.bvf_authorize_video_generation/i);
  assert.match(executable, /create function public\.bvf_cancel_video_job/i);
  assert.equal((executable.match(/security definer/gi) || []).length, 3);
  assert.equal((executable.match(/set search_path = ''/gi) || []).length, 3);
  assert.match(executable, /for update/i);
  assert.match(executable, /revoke insert, update on table public\.video_jobs from service_role/i);
  assert.doesNotMatch(executable, /grant[^;]*(?:insert|update|delete)[^;]*table[^;]*service_role/i);
  assert.doesNotMatch(executable, /create policy/i);
  assert.doesNotMatch(executable, /delete\s+from/i);

  const protectedTables = [
    "produtos", "pedidos", "compras", "fornecedores", "notas_fiscais",
    "pricing_decisions", "anuncios_ml",
  ].join("|");
  assert.doesNotMatch(
    executable,
    new RegExp(`(?:alter\\s+table|insert\\s+into|update|delete\\s+from)\\s+public\\.(?:${protectedTables})\\b`, "i"),
  );
});

test("criação é idempotente e cancelamento é auditável", () => {
  assert.match(executable, /creation_request_id uuid/i);
  assert.match(executable, /unique index video_jobs_creation_request_idx/i);
  assert.match(executable, /\(created_by, creation_request_id\)/i);
  assert.match(executable, /BVF_WORKFLOW_IDEMPOTENCY_CONFLICT/i);
  assert.match(executable, /cancelled_at = now\(\)/i);
  assert.match(executable, /cancelled_by = p_actor_id/i);
  assert.match(executable, /status = 'cancelled'/i);
});

test("um único gate vincula briefing e cotação exatos", () => {
  assert.match(executable, /generation_approved_brief_version_id uuid/i);
  assert.match(executable, /video_jobs_generation_approved_brief_fkey/i);
  assert.match(executable, /current_brief_version_id is distinct from p_brief_version_id/i);
  assert.match(executable, /generation_provider is distinct from btrim\(p_provider\)/i);
  assert.match(executable, /estimated_cost is distinct from p_estimated_cost/i);
  assert.match(executable, /status = 'approved_for_generation'/i);
  assert.doesNotMatch(executable, /brief_approved_at|brief_approved_by/i);
});

test("contratos aceitam apenas combinações válidas de alvo e vídeo", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(workflowContracts.bvfCreateJobSchema.safeParse({
    requestId: id,
    target: { kind: "product", productId: id },
    videoType: "HUMAN_DEMO",
  }).success, true);
  assert.equal(workflowContracts.bvfCreateJobSchema.safeParse({
    requestId: id,
    target: { kind: "family", familyId: id },
    videoType: "FAMILY_VIDEO",
  }).success, true);
  assert.equal(workflowContracts.bvfCreateJobSchema.safeParse({
    requestId: id,
    target: { kind: "product", productId: id },
    videoType: "FAMILY_VIDEO",
  }).success, false);
});

test("rotas aplicam o RBAC existente e não expõem DELETE", () => {
  const routeFiles = fs.readdirSync(path.join(root, "src/app/api/video-factory"), { recursive: true })
    .filter((name) => name.endsWith("route.ts"));
  assert.ok(routeFiles.length >= 10);
  const source = routeFiles.map((name) => fs.readFileSync(path.join(root, "src/app/api/video-factory", name), "utf8")).join("\n");
  assert.match(source, /video_factory\.read/);
  assert.match(source, /video_factory\.manage/);
  assert.doesNotMatch(source, /export async function DELETE/);
});
