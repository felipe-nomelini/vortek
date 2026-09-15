const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260915100000_bvf_ui_01.sql"),
  "utf8",
);
const executable = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const studio = fs.readFileSync(
  path.join(root, "src/components/video-factory/VideoFactoryStudio.tsx"),
  "utf8",
);
const service = fs.readFileSync(
  path.join(root, "src/services/video-factory/studio.ts"),
  "utf8",
);
const load = require("./helpers/load-integration-module");
const zod = require("zod");
const contracts = require("../src/lib/video-factory/contracts.ts");
const uiContracts = load("src/lib/video-factory/ui-contracts.ts", {
  zod,
  "@/lib/video-factory/contracts": contracts,
});

const id = "11111111-1111-4111-8111-111111111111";

function validReview() {
  return {
    expectedBriefVersionId: id,
    direction: "Mostrar o uso real do produto sem extrapolar os fatos.",
    sections: {
      hook: "Conheça o produto.",
      problem: "",
      solution: "",
      demonstration: "",
      humor: "",
      dialogue: "",
      onscreenText: "",
      closing: "",
    },
    claimDecisions: [{ index: 0, decision: "verified" }],
    additionalForbiddenClaims: ["o melhor do mercado"],
    scaleReview: { status: "unavailable", reason: "Dimensões ausentes no cadastro." },
    selectedProductReferenceIds: [id],
    selectedPersonaReferenceIds: [],
    variationUnsafeAcknowledgements: [],
  };
}

test("migration versiona a revisão, invalida aprovação material e mantém o gate pago", () => {
  assert.match(executable, /create function public\.bvf_persist_reviewed_brief_version/i);
  assert.match(executable, /insert into public\.video_brief_versions/i);
  assert.match(executable, /status = 'waiting_brief_approval'/i);
  assert.match(executable, /generation_approved_at = null/i);
  assert.match(executable, /generation_approved_brief_version_id = null/i);
  assert.match(executable, /create or replace function public\.bvf_authorize_video_generation/i);
  assert.match(executable, /BVF-UI-01-v1/);
  assert.match(executable, /BVF_UI_REVIEW_REQUIRED/);
  assert.match(executable, /BVF_WORKFLOW_GENERATION_QUOTE_CHANGED/);
  assert.match(executable, /for update/i);
  assert.equal((executable.match(/security definer/gi) || []).length, 2);
  assert.equal((executable.match(/set search_path = ''/gi) || []).length, 2);
});

test("migration não amplia RLS nem escreve em domínios críticos", () => {
  assert.doesNotMatch(executable, /create policy|alter table .* disable row level security/i);
  assert.match(executable, /grant execute on function public\.bvf_persist_reviewed_brief_version[\s\S]*to service_role/i);
  assert.doesNotMatch(executable, /grant[^;]*to (?:anon|authenticated)/i);
  assert.doesNotMatch(executable, /delete\s+from/i);

  const protectedTables = [
    "produtos", "pedidos", "compras", "fornecedores", "notas_fiscais",
    "pricing_decisions", "anuncios_ml", "produto_fornecedor_ofertas",
  ].join("|");
  assert.doesNotMatch(
    executable,
    new RegExp(`(?:alter\\s+table|insert\\s+into|update|delete\\s+from)\\s+public\\.(?:${protectedTables})\\b`, "i"),
  );
});

test("contrato exige revisão factual explícita sem permitir claim verificado livre", () => {
  assert.equal(uiContracts.bvfBriefReviewSchema.safeParse(validReview()).success, true);
  assert.equal(uiContracts.bvfBriefReviewSchema.safeParse({
    ...validReview(),
    direction: "",
  }).success, false);
  assert.equal(uiContracts.bvfBriefReviewSchema.safeParse({
    ...validReview(),
    scaleReview: { status: "unavailable", reason: "" },
  }).success, false);
  assert.equal(uiContracts.bvfBriefReviewSchema.safeParse({
    ...validReview(),
    verifiedClaims: ["fato inventado"],
  }).success, false);
});

test("todos os estados do domínio possuem apresentação própria", () => {
  assert.deepEqual(
    Object.keys(uiContracts.BVF_JOB_STATUS_PRESENTATION).sort(),
    [...contracts.BVF_JOB_STATUSES].sort(),
  );
  for (const status of contracts.BVF_JOB_STATUSES) {
    assert.notEqual(uiContracts.parseBvfJobStatusPresentation(status).label, "Estado desconhecido");
  }
});

test("UI representa os dois gates e não finge provider, custo ou master", () => {
  assert.match(studio, /Gate #1 — briefing e custo/);
  assert.match(studio, /Provider ainda não configurado/);
  assert.match(studio, /Nenhum custo ou prompt foi inventado/);
  assert.match(studio, /Gate #2 — master/);
  assert.match(studio, /Aguardando geração/);
  assert.match(studio, /Nenhuma geração será simulada/);
  assert.doesNotMatch(studio, /api\/gemini|api\/veo|fake(?:Cost|Video|Job)/i);
});

test("serviço do estúdio limita escritas à revisão BVF e lê produto/anúncio", () => {
  assert.match(service, /\.from\("produtos"\)/);
  assert.match(service, /\.from\("anuncios_ml"\)/);
  assert.match(service, /\.from\("video_assets"\)/);
  assert.match(service, /\.rpc\(\s*"bvf_persist_reviewed_brief_version"/);
  assert.doesNotMatch(service, /\.from\("(?:produtos|anuncios_ml)"\)[\s\S]{0,200}\.(?:insert|update|delete)\(/);
  assert.doesNotMatch(service, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test("novas APIs exigem sessão/RBAC pelo autorizador existente", () => {
  const routeFiles = [
    "src/app/api/video-factory/personas/route.ts",
    "src/app/api/video-factory/studio/products/by-sku/route.ts",
    "src/app/api/video-factory/jobs/[id]/brief-review/route.ts",
  ];
  const source = routeFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.equal((source.match(/authorizeApiRequest/g) || []).length, 6);
  assert.match(source, /video_factory\.read/);
  assert.match(source, /video_factory\.manage/);
  assert.doesNotMatch(source, /export async function DELETE/);
});
