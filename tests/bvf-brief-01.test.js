const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260913160000_bvf_brief_01.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const executableMigration = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const service = fs.readFileSync(
  path.join(root, "src/services/video-factory/briefing.ts"),
  "utf8",
);
const load = require("./helpers/load-integration-module");
const {
  buildBvfBriefArtifacts,
  stableBvfJson,
} = load("src/lib/video-factory/factual-engine.ts", {
  "./contracts": require("../src/lib/video-factory/contracts.ts"),
});
const { researchBvfProductFacts } = load(
  "src/services/video-factory/factual-research.ts",
  {
    "server-only": {},
    "@/lib/video-factory/contracts": require("../src/lib/video-factory/contracts.ts"),
  },
);

const ids = {
  job: "11111111-1111-4111-8111-111111111111",
  product: "22222222-2222-4222-8222-222222222222",
  offer: "33333333-3333-4333-8333-333333333333",
  persona: "44444444-4444-4444-8444-444444444444",
};

function research(overrides = {}) {
  return {
    status: "not_needed",
    searchedFields: [],
    sourceUrls: [],
    acceptedFacts: [],
    ...overrides,
  };
}

function engineInput(overrides = {}) {
  return {
    job: {
      id: ids.job,
      sku: "SKU-REAL-1",
      videoType: "HUMAN_DEMO",
      mlItemId: null,
    },
    product: {
      id: ids.product,
      sku: "SKU-REAL-1",
      name: "Ferramenta de teste",
      brand: "Bentevi Tools",
      gtin: "7891234567890",
      category: "Ferramentas",
      description:
        "Corpo metálico resistente. Dimensões do produto: 9,8 x 5,2 x 5,9 cm.",
      netWeightKg: 0.593,
      updatedAt: "2026-09-13T12:00:00.000Z",
    },
    offer: {
      id: ids.offer,
      name: "Nome DSLite",
      brand: "Marca divergente",
      gtin: "9999999999999",
      description: "Texto DSLite que não substitui o cadastro Bentevi.",
      supplierSku: "FORN-1",
      observedAt: "2026-09-13T12:01:00.000Z",
    },
    listing: null,
    persona: { id: ids.persona, code: "RAFA" },
    research: research(),
    builtAt: "2026-09-13T12:02:00.000Z",
    ...overrides,
  };
}

test("migration cria histórico imutável sem escrever nos domínios fonte", () => {
  assert.match(executableMigration, /create table public\.video_brief_versions \(/i);
  assert.match(executableMigration, /on delete restrict/i);
  assert.match(executableMigration, /before update or delete on public\.video_brief_versions/i);
  assert.match(executableMigration, /BVF_BRIEF_VERSION_IMMUTABLE/);
  assert.match(executableMigration, /unique \(job_id, version\)/i);
  assert.match(executableMigration, /foreign key \(id, current_brief_version_id\)/i);

  const protectedTables = [
    "produtos",
    "produto_fornecedor_ofertas",
    "anuncios_ml",
    "pedidos",
    "pedido_itens",
    "fornecedores",
    "notas_fiscais",
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

test("RLS e RPC restringem gravação ao backend e RBAC real", () => {
  assert.match(
    executableMigration,
    /alter table public\.video_brief_versions enable row level security/i,
  );
  assert.match(
    executableMigration,
    /revoke all on table public\.video_brief_versions from public, anon, authenticated, service_role/i,
  );
  assert.match(
    executableMigration,
    /grant select on table public\.video_brief_versions to service_role/i,
  );
  assert.doesNotMatch(executableMigration, /grant[^;]*(?:insert|update|delete)[^;]*service_role/i);
  assert.match(executableMigration, /profile\.cargo::text in \('admin', 'gerente'\)/i);
  assert.match(executableMigration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(executableMigration, /v_job\.content_scope <> 'SKU'/i);
  assert.match(
    executableMigration,
    /v_job\.video_type not in \('HUMAN_DEMO', 'CINEMATIC_PRODUCT'\)/i,
  );
});

test("cadastro Bentevi prevalece e claims permanecem literais", () => {
  const result = buildBvfBriefArtifacts(engineInput());
  const brand = result.factualSnapshot.facts.find((fact) => fact.key === "brand");
  assert.equal(brand.value, "Bentevi Tools");
  assert.equal(brand.source.kind, "bentevi_product");
  assert.deepEqual(
    result.factualSnapshot.verifiedClaims.map((claim) => claim.text),
    [
      "Corpo metálico resistente.",
      "Dimensões do produto: 9,8 x 5,2 x 5,9 cm.",
    ],
  );
  assert.equal(result.factualSnapshot.verifiedClaims[0].source.kind, "bentevi_product");
});

test("âncora usa somente medidas físicas explícitas e peso líquido", () => {
  const result = buildBvfBriefArtifacts(engineInput());
  assert.deepEqual(
    {
      width: result.factualSnapshot.physicalDimensions.widthCm.value,
      height: result.factualSnapshot.physicalDimensions.heightCm.value,
      depth: result.factualSnapshot.physicalDimensions.depthCm.value,
      weight: result.factualSnapshot.physicalDimensions.weightGrams.value,
    },
    { width: 9.8, height: 5.2, depth: 5.9, weight: 593 },
  );
  assert.equal(
    result.factualSnapshot.scaleAnchor,
    "Preserve a escala real: largura 9,8 cm, altura 5,2 cm e profundidade 5,9 cm, com peso de 593 g em relação às mãos e aos objetos do cenário, sem aumentar ou reduzir o produto.",
  );

  const packageOnly = buildBvfBriefArtifacts(
    engineInput({
      product: {
        ...engineInput().product,
        description: "Dimensões da embalagem: 40 x 30 x 20 cm.",
        netWeightKg: null,
      },
    }),
  );
  assert.equal(packageOnly.factualSnapshot.scaleAnchor, null);
  assert.ok(packageOnly.factualSnapshot.missingFacts.includes("width_cm"));
  assert.ok(packageOnly.factualSnapshot.missingFacts.includes("weight_g"));
});

test("dimensões estruturadas do cadastro prevalecem sobre texto descritivo", () => {
  const result = buildBvfBriefArtifacts(
    engineInput({
      product: {
        ...engineInput().product,
        widthCm: 5.2,
        heightCm: 5.9,
        depthCm: 9.8,
      },
    }),
  );
  assert.deepEqual(
    {
      width: result.factualSnapshot.physicalDimensions.widthCm.value,
      height: result.factualSnapshot.physicalDimensions.heightCm.value,
      depth: result.factualSnapshot.physicalDimensions.depthCm.value,
    },
    { width: 5.2, height: 5.9, depth: 9.8 },
  );
  assert.equal(result.factualSnapshot.physicalDimensions.widthCm.source.kind, "bentevi_product");
});

test("pesquisa preenche somente lacunas com proveniência e citação", () => {
  const collectedAt = "2026-09-13T12:03:00.000Z";
  const acceptedFacts = [
    ["width_cm", "98", "mm", "Largura do produto: 98 mm."],
    ["height_cm", "5,2", "cm", "Altura do produto: 5,2 cm."],
    ["depth_cm", "0.059", "m", "Profundidade do produto: 0.059 m."],
  ].map(([key, value, unit, quote]) => ({
    key,
    value,
    unit,
    quote,
    url: "https://fabricante.example/ficha",
    collectedAt,
  }));
  const result = buildBvfBriefArtifacts(
    engineInput({
      product: {
        ...engineInput().product,
        description: "Corpo metálico resistente.",
      },
      research: research({
        status: "completed",
        searchedFields: ["width_cm", "height_cm", "depth_cm"],
        sourceUrls: ["https://fabricante.example/ficha"],
        acceptedFacts,
      }),
    }),
  );

  assert.equal(result.factualSnapshot.physicalDimensions.widthCm.value, 9.8);
  assert.equal(result.factualSnapshot.physicalDimensions.heightCm.value, 5.2);
  assert.equal(result.factualSnapshot.physicalDimensions.depthCm.value, 5.9);
  assert.equal(
    result.factualSnapshot.physicalDimensions.widthCm.source.reference,
    "Largura do produto: 98 mm.",
  );
  assert.equal(result.factualSnapshot.physicalDimensions.widthCm.source.kind, "web");
});

test("fingerprint material ignora horário de coleta, mas reage a fatos", () => {
  const first = buildBvfBriefArtifacts(engineInput());
  const second = buildBvfBriefArtifacts(
    engineInput({
      offer: {
        ...engineInput().offer,
        observedAt: "2026-09-13T13:01:00.000Z",
      },
      builtAt: "2026-09-13T13:02:00.000Z",
    }),
  );
  assert.equal(
    stableBvfJson(first.materialFingerprintPayload),
    stableBvfJson(second.materialFingerprintPayload),
  );

  const changed = buildBvfBriefArtifacts(
    engineInput({
      product: { ...engineInput().product, brand: "Outra marca" },
    }),
  );
  assert.notEqual(
    stableBvfJson(first.materialFingerprintPayload),
    stableBvfJson(changed.materialFingerprintPayload),
  );
});

test("adapter Firecrawl aceita apenas fatos pedidos com citação presente", async () => {
  const previousKey = process.env.FIRECRAWL_API_KEY;
  const previousFetch = global.fetch;
  const calls = [];
  process.env.FIRECRAWL_API_KEY = "test-only";
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/search")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            web: [
              {
                url: "https://bentevitools.example/produto",
                title: "Ficha oficial",
              },
            ],
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          markdown: "A largura física do produto é 98 mm.",
          json: {
            facts: [
              {
                key: "width_cm",
                value: "98",
                unit: "mm",
                quote: "A largura física do produto é 98 mm.",
              },
              {
                key: "height_cm",
                value: "20",
                unit: "cm",
                quote: "Texto que não existe na página.",
              },
            ],
          },
        },
      }),
    };
  };

  try {
    const result = await researchBvfProductFacts({
      productId: "55555555-5555-4555-8555-555555555555",
      name: "Ferramenta exclusiva do teste",
      brand: "Bentevi Tools",
      gtin: null,
      supplierSkus: [],
      missingFields: ["width_cm", "height_cm"],
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.acceptedFacts.map((fact) => fact.key), ["width_cm"]);
    assert.equal(result.acceptedFacts[0].quote, "A largura física do produto é 98 mm.");
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls[1].body.formats[1].schema.properties.facts.items.properties.key.enum,
      ["width_cm", "height_cm"],
    );
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});

test("orquestrador só lê fontes e persiste pelo RPC atômico", () => {
  for (const table of [
    "produtos",
    "produto_fornecedor_ofertas",
    "anuncios_ml",
    "profiles",
  ]) {
    assert.match(service, new RegExp(`\\.from\\(\\"${table}\\"\\)`));
  }
  assert.match(service, /\.rpc\(\s*"bvf_persist_brief_version"/);
  assert.doesNotMatch(service, /\.(?:insert|upsert|delete)\(/);
  assert.equal(service.match(/\.update\(/g)?.length, 1);
  assert.match(service, /createHash\("sha256"\)[\s\S]*\.update\(/);
  assert.match(service, /peso_liq, largura, altura, profundidade/);
  assert.doesNotMatch(service, /\bpeso_bruto\b/);
  assert.match(
    service,
    /missingFields: initialArtifacts\.factualSnapshot\.missingFacts/,
  );
});
