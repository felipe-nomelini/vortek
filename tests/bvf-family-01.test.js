const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260913200000_bvf_family_01.sql"),
  "utf8",
);
const executableMigration = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const load = require("./helpers/load-integration-module");
const contracts = require("../src/lib/video-factory/contracts.ts");
const factual = load("src/lib/video-factory/factual-engine.ts", {
  "./contracts": contracts,
});
const family = load("src/lib/video-factory/family-engine.ts", {
  "./contracts": contracts,
  "./factual-engine": factual,
});

const ids = {
  family: "11111111-1111-4111-8111-111111111111",
  first: "22222222-2222-4222-8222-222222222222",
  second: "33333333-3333-4333-8333-333333333333",
  third: "44444444-4444-4444-8444-444444444444",
  job: "55555555-5555-4555-8555-555555555555",
  analysis: "66666666-6666-4666-8666-666666666666",
};

function research(overrides = {}) {
  return {
    status: "unavailable",
    searchedFields: [...contracts.BVF_FAMILY_ATTRIBUTE_KEYS],
    sourceUrls: [],
    acceptedFacts: [],
    ...overrides,
  };
}

function member(id, sku, voltage, overrides = {}) {
  return {
    product: {
      id,
      sku,
      name: `Ventilador de Mesa Turbo Preto ${voltage}`,
      brand: "Ventisol",
      category: "Ar e ventilação / Ventiladores de mesa",
      active: true,
      updatedAt: "2026-09-13T18:00:00.000Z",
      gtin: `789${sku.replace(/\D/g, "").padEnd(10, "0")}`,
      description:
        "Ventilador de mesa para circulação de ar. Dimensões do produto: 30 x 40 x 20 cm.",
      netWeightKg: 2,
    },
    offer: null,
    listing: null,
    kit: {
      status: "not_kit",
      totalUnits: null,
      reference: `produto_kits:absent:${id}`,
      observedAt: "2026-09-13T18:00:00.000Z",
    },
    research: research(),
    ...overrides,
  };
}

function analysisInput(overrides = {}) {
  return {
    family: {
      id: ids.family,
      familyKey: "VENTISOL_TURBO_MESA",
      name: "Ventisol Turbo de mesa",
      brand: "Ventisol",
      category: "Ar e ventilação / Ventiladores de mesa",
    },
    members: [member(ids.first, "VTK001", "127V"), member(ids.second, "VTK002", "220V")],
    ...overrides,
  };
}

test("migration é aditiva, preserva histórico e não escreve em domínios críticos", () => {
  assert.match(executableMigration, /create table public\.video_family_suggestions \(/i);
  assert.match(executableMigration, /create table public\.video_family_analysis_versions \(/i);
  assert.match(executableMigration, /before update or delete on public\.video_family_analysis_versions/i);
  assert.match(executableMigration, /removed_at = now\(\)/i);
  assert.match(executableMigration, /removed_by = p_actor_id/i);
  assert.match(executableMigration, /BVF_FAMILY_ANALYSIS_MEMBER_MISMATCH/i);
  assert.doesNotMatch(executableMigration, /on delete cascade/i);
  assert.doesNotMatch(executableMigration, /delete\s+from/i);

  const protectedTables = [
    "produtos",
    "produto_fornecedor_ofertas",
    "produto_kits",
    "produto_kit_componentes",
    "anuncios_ml",
    "pedidos",
    "compras",
    "fornecedores",
    "pricing_decisions",
  ].join("|");
  assert.doesNotMatch(
    executableMigration,
    new RegExp(
      `(?:alter\\s+table|insert\\s+into|update|delete\\s+from|create\\s+trigger)\\s+public\\.(?:${protectedTables})\\b`,
      "i",
    ),
  );
});

test("RLS, RPCs e grants mantêm escrita familiar atrás do backend", () => {
  for (const table of ["video_family_suggestions", "video_family_analysis_versions"]) {
    assert.match(
      executableMigration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
  }
  assert.match(executableMigration, /revoke insert, update on table public\.video_families/i);
  assert.match(executableMigration, /from service_role/i);
  assert.match(executableMigration, /profile\.cargo::text in \('admin', 'gerente'\)/i);
  assert.equal((executableMigration.match(/security definer/g) || []).length, 5);
  assert.equal((executableMigration.match(/set search_path = ''/g) || []).length, 6);
  assert.doesNotMatch(executableMigration, /grant[^;]*(?:insert|update|delete)[^;]*service_role/i);
});

test("sugestão parte de um SKU, remove tokens variáveis e nunca confirma sozinha", () => {
  const seed = member(ids.first, "VTK001", "127V").product;
  const close = member(ids.second, "VTK002", "220V").product;
  const unrelated = {
    ...member(ids.third, "VTK003", "127V").product,
    name: "Motor de reposição industrial Ventisol",
  };
  const suggestion = family.suggestBvfFamilyCandidates(seed, [seed, close, unrelated]);
  assert.equal(suggestion.seed.id, seed.id);
  assert.deepEqual(suggestion.candidates.map((row) => row.id), [close.id]);
  assert.ok(suggestion.candidates[0].removedVariationTokens.includes("220v"));
  assert.equal(suggestion.algorithmVersion, "BVF-FAMILY-SUGGEST-01-v1");
});

test("sugestão respeita o limite absoluto de vinte membros", () => {
  const seed = member(ids.first, "VTK001", "127V").product;
  const pool = Array.from({ length: 30 }, (_, index) => ({
    ...seed,
    id: `${String(index + 10).padStart(8, "0")}-1111-4111-8111-111111111111`,
    sku: `VTK${String(index + 10).padStart(3, "0")}`,
    name: `Ventilador de Mesa Turbo Preto ${index % 2 ? "127V" : "220V"}`,
  }));
  const suggestion = family.suggestBvfFamilyCandidates(seed, pool);
  assert.equal(suggestion.candidates.length, 19);
});

test("tensão variável fica bloqueada e fatos comuns ficam seguros", () => {
  const result = family.buildBvfFamilyAnalysis(analysisInput());
  const unsafeVoltage = result.analysisSnapshot.variationUnsafe.find(
    (item) => item.key === "voltage",
  );
  assert.equal(unsafeVoltage.reason, "varies");
  assert.deepEqual(unsafeVoltage.blockedIn, [
    "dialogue",
    "onscreen_text",
    "closing",
    "claims",
  ]);
  assert.ok(result.analysisSnapshot.variationSafe.some((item) => item.key === "brand"));
  assert.ok(result.analysisSnapshot.variationSafe.some((item) => item.key === "color"));
  assert.ok(result.analysisSnapshot.variationSafe.some((item) => item.key === "kit"));
  assert.ok(result.analysisSnapshot.variationUnsafe.some((item) => item.key === "sku"));
  assert.ok(result.analysisSnapshot.variationUnsafe.some((item) => item.key === "gtin"));
});

test("ausência de evidência não bloqueia a análise, mas bloqueia o atributo", () => {
  const result = family.buildBvfFamilyAnalysis(analysisInput());
  const model = result.analysisSnapshot.variationUnsafe.find((item) => item.key === "model");
  assert.equal(model.reason, "missing_evidence");
  assert.equal(result.analysisSnapshot.members[0].research.status, "unavailable");
  assert.ok(!result.analysisSnapshot.variationSafe.some((item) => item.key === "model"));
});

test("claim só é liberado quando aparece com evidência em todos os membros", () => {
  const common = family.buildBvfFamilyAnalysis(analysisInput());
  assert.deepEqual(
    common.analysisSnapshot.verifiedClaims.map((claim) => claim.text),
    [
      "Ventilador de mesa para circulação de ar.",
      "Dimensões do produto: 30 x 40 x 20 cm.",
    ],
  );

  const changed = analysisInput();
  changed.members[1].product.description =
    "Ventilador silencioso. Dimensões do produto: 30 x 40 x 20 cm.";
  const result = family.buildBvfFamilyAnalysis(changed);
  assert.deepEqual(result.analysisSnapshot.verifiedClaims.map((claim) => claim.text), [
    "Dimensões do produto: 30 x 40 x 20 cm.",
  ]);
});

test("guard rejeita referência insegura em qualquer canal narrativo", () => {
  const analysis = family.buildBvfFamilyAnalysis(analysisInput()).analysisSnapshot;
  const guard = family.buildBvfFamilyContentGuard(analysis);
  assert.ok(!guard.allowedFactKeys.includes("voltage"));
  assert.ok(guard.blockedAttributeKeys.includes("voltage"));
  assert.throws(
    () =>
      family.assertBvfFamilyNarrativeFactKeys(guard, {
        dialogue: ["voltage"],
        onscreen_text: [],
        closing: [],
        claims: [],
      }),
    /BVF_FAMILY_UNSAFE_FACT:dialogue:voltage/,
  );
  assert.doesNotThrow(() =>
    family.assertBvfFamilyNarrativeFactKeys(guard, {
      dialogue: ["brand"],
      onscreen_text: ["color"],
      closing: [],
      claims: [],
    }),
  );
});

test("briefing familiar referencia a análise e permanece aguardando aprovação", () => {
  const analysis = family.buildBvfFamilyAnalysis(analysisInput()).analysisSnapshot;
  const result = family.buildBvfFamilyBriefArtifacts({
    job: { id: ids.job, familyId: ids.family, familyKey: "VENTISOL_TURBO_MESA" },
    analysisVersion: {
      id: ids.analysis,
      version: 1,
      materialFingerprint: "a".repeat(64),
    },
    analysis,
    persona: null,
  });
  assert.equal(result.inputSnapshot.analysisVersion.id, ids.analysis);
  assert.equal(result.creativeBrief.factualRules.excludeVariationUnsafe, true);
  assert.ok(!JSON.stringify(result.creativeBrief.contentGuard).includes("127V"));
  assert.ok(!JSON.stringify(result.creativeBrief.contentGuard).includes("220V"));
});

test("fingerprint material ignora horários e reage à composição", () => {
  const first = family.buildBvfFamilyAnalysis(analysisInput());
  const shifted = analysisInput();
  shifted.members.forEach((row) => {
    row.product.updatedAt = "2026-09-13T20:00:00.000Z";
    row.kit.observedAt = "2026-09-13T20:00:00.000Z";
  });
  const second = family.buildBvfFamilyAnalysis(shifted);
  assert.equal(
    factual.stableBvfJson(first.materialFingerprintPayload),
    factual.stableBvfJson(second.materialFingerprintPayload),
  );
  const expanded = analysisInput({
    members: [
      ...analysisInput().members,
      member(ids.third, "VTK003", "127V"),
    ],
  });
  const third = family.buildBvfFamilyAnalysis(expanded);
  assert.notEqual(
    factual.stableBvfJson(first.materialFingerprintPayload),
    factual.stableBvfJson(third.materialFingerprintPayload),
  );
});

test("pesquisa familiar só aceita JSON com citação literal e exclui marketplace", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-key";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/search")) {
      return new Response(
        JSON.stringify({
          data: {
            web: [
              { url: "https://ventisol.example/ficha" },
              { url: "https://produto.mercadolivre.com.br/item" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          markdown: "A potência nominal declarada é 120 W.",
          json: {
            facts: [
              {
                key: "power",
                value: "120",
                unit: "W",
                quote: "A potência nominal declarada é 120 W.",
              },
              {
                key: "model",
                value: "Inventado",
                unit: null,
                quote: "Frase ausente",
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
  });
  const { researchBvfFamilyMemberFacts } = load(
    "src/services/video-factory/family-research.ts",
    {
      "server-only": {},
      "@/lib/video-factory/contracts": contracts,
    },
  );
  const result = await researchBvfFamilyMemberFacts({
    productId: ids.first,
    name: "Ventilador Turbo",
    brand: "Ventisol",
    gtin: null,
    supplierSkus: [],
    missingFields: ["power", "model"],
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.acceptedFacts.map((fact) => fact.key), ["power"]);
  assert.equal(calls.filter((call) => call.url.endsWith("/scrape")).length, 1);
  assert.ok(!calls.some((call) => call.body.url?.includes("mercadolivre")));
});
