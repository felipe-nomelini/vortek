const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260913120000_bvf_v1_initial.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const executableMigration = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const expectedTables = [
  "video_personas",
  "video_families",
  "video_family_products",
  "video_prompt_templates",
  "video_jobs",
  "video_generation_attempts",
  "video_assets",
  "video_asset_links",
];

test("migration BVF é aditiva, determinística e não muta domínios críticos", () => {
  for (const table of expectedTables) {
    assert.match(executableMigration, new RegExp(`create table public\\.${table} \\(`));
  }

  assert.equal(
    executableMigration.match(/create table public\.video_/g)?.length,
    expectedTables.length,
  );
  assert.doesNotMatch(executableMigration, /create table if not exists/i);
  assert.doesNotMatch(executableMigration, /create extension|pgcrypto/i);
  assert.doesNotMatch(executableMigration, /on delete cascade/i);

  const protectedTables = [
    "produtos",
    "profiles",
    "pedidos",
    "pedido_itens",
    "fornecedores",
    "notas_fiscais",
    "pricing_decisions",
    "ml_anuncios",
  ].join("|");
  assert.doesNotMatch(
    executableMigration,
    new RegExp(
      `(?:alter\\s+table|insert\\s+into|update|delete\\s+from|create\\s+trigger)\\s+public\\.(?:${protectedTables})\\b`,
      "i",
    ),
  );
});

test("histórico BVF é preservado sem DELETE no contrato operacional", () => {
  assert.doesNotMatch(executableMigration, /grant[^;]*\bdelete\b/is);
  assert.match(executableMigration, /on delete restrict/);
  assert.match(executableMigration, /removed_at timestamptz/);
  assert.match(executableMigration, /unlinked_at timestamptz/);
  assert.match(executableMigration, /'cancelled'/);
  assert.match(executableMigration, /unique \(job_id, attempt_number\)/);
});

test("RLS usa somente o backend privilegiado e o bucket permanece privado", () => {
  for (const table of expectedTables) {
    assert.match(
      executableMigration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
  }

  assert.match(
    executableMigration,
    /revoke all on table[\s\S]*from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    executableMigration,
    /grant select, insert, update on table[\s\S]*to service_role;/i,
  );
  assert.doesNotMatch(executableMigration, /create policy[\s\S]*on public\.video_/i);
  assert.doesNotMatch(executableMigration, /grant[^;]*to authenticated/i);

  assert.match(
    executableMigration,
    /insert into storage\.buckets[\s\S]*'video-factory'[\s\S]*false/i,
  );
  assert.match(executableMigration, /create policy bvf_private_bucket_guard/);
  assert.match(executableMigration, /as restrictive/);
  assert.match(executableMigration, /bucket_id <> 'video-factory'/);
});

test("governança factual, variações, escala e custos têm contratos explícitos", () => {
  for (const field of [
    "verified_claims",
    "forbidden_claims",
    "physical_dimensions",
    "scale_anchor",
    "variation_safe",
    "variation_unsafe",
  ]) {
    assert.match(executableMigration, new RegExp(`\\b${field}\\b`));
  }

  assert.match(executableMigration, /jsonb_typeof\(verified_claims\) = 'array'/);
  assert.match(executableMigration, /jsonb_typeof\(physical_dimensions\) = 'object'/);
  assert.match(executableMigration, /cost_currency ~ '\^\[A-Z\]\{3\}\$'/);
  assert.match(executableMigration, /actual_cost numeric\(14, 6\)/);
  assert.match(executableMigration, /duration_seconds numeric\(12, 3\)/);
});

test("estados detalhados dos jobs permanecem completos", () => {
  const { BVF_JOB_STATUSES } = require("../src/lib/video-factory/contracts.ts");
  const expected = [
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
  ];

  assert.deepEqual(BVF_JOB_STATUSES, expected);
  for (const status of expected) {
    assert.match(executableMigration, new RegExp(`'${status}'`));
  }
});

test("RAFA é seed factual, sem URL ou conteúdo comercial inventado", () => {
  assert.match(executableMigration, /'RAFA',[\s\n]*'v1',[\s\n]*'Rafa'/);
  assert.match(executableMigration, /'Sudeste brasileiro leve'/);
  assert.match(executableMigration, /'\["Ferramentas"[\s\S]*"Oficina"\]'::jsonb/);
  assert.match(executableMigration, /'\[\]'::jsonb/);
  assert.doesNotMatch(executableMigration, /https?:\/\//i);
  assert.doesNotMatch(executableMigration, /canonical_image|public_url/i);
  assert.doesNotMatch(executableMigration, /o melhor|o mais potente|imperdível|corre que acaba/i);
});

test("templates V1 são versionados, ativos e independentes de provider", () => {
  for (const code of [
    "BENTEVI_HUMAN_DEMO",
    "BENTEVI_FAMILY_VIDEO",
    "BENTEVI_CINEMATIC_PRODUCT",
  ]) {
    assert.match(executableMigration, new RegExp(`'${code}'`));
  }

  assert.match(executableMigration, /prompt_templates_code_version_key unique \(code, version\)/);
  assert.match(executableMigration, /Prompt template versions are immutable/);
  assert.equal(
    executableMigration.match(/PROMPT_LANGUAGE=EN/g)?.length,
    3,
  );
  assert.equal(
    executableMigration.match(/ONSCREEN_TEXT=pt-BR/g)?.length,
    3,
  );
  assert.doesNotMatch(executableMigration, /'gemini'|'veo'/i);
});

test("abstração VideoProvider não acopla o domínio a SDK concreto", () => {
  const provider = fs.readFileSync(
    path.join(root, "src/services/video-factory/provider.ts"),
    "utf8",
  );

  assert.match(provider, /interface VideoProvider/);
  for (const operation of ["estimateCost", "generate", "getStatus", "download"]) {
    assert.match(provider, new RegExp(`\\b${operation}\\(`));
  }
  assert.match(provider, /idempotencyKey: string/);
  assert.doesNotMatch(provider, /from ["'][^"']*(?:gemini|veo|google)[^"']*["']/i);
});
