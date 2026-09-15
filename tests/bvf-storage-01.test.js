const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260914210000_bvf_storage_01.sql"),
  "utf8",
);
const executable = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const load = require("./helpers/load-integration-module");
const zod = require("zod");
const contracts = load("src/lib/video-factory/storage-contracts.ts", { zod });
const service = load("src/services/video-factory/storage.ts", {
  "server-only": {},
  "node:crypto": require("node:crypto"),
  "node:dns/promises": require("node:dns/promises"),
  "node:https": { default: require("node:https") },
  "node:net": require("node:net"),
  sharp: { default: require("sharp") },
  zod,
  "@/lib/video-factory/storage-contracts": contracts,
  "@/lib/supabase": { createServiceClient: () => { throw new Error("not used"); } },
});

const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

test("migration isola referências de jobs e preserva histórico", () => {
  assert.match(executable, /alter column job_id drop not null/i);
  assert.match(executable, /reference_slot text/i);
  assert.match(executable, /active boolean not null default true/i);
  assert.match(executable, /deactivated_at timestamptz/i);
  assert.match(executable, /video_assets_lifecycle_check/i);
  assert.match(executable, /video_assets_association_check/i);
  assert.match(executable, /video_assets_persona_active_slot_idx/i);
  assert.match(executable, /where asset_type = 'persona_reference' and active = true/i);
  assert.doesNotMatch(executable, /delete\s+from/i);
  assert.doesNotMatch(executable, /on delete cascade/i);
});

test("migration mantém o Storage privado e fecha escrita direta", () => {
  assert.match(executable, /create function public\.bvf_register_reference_asset/i);
  assert.match(executable, /create function public\.bvf_deactivate_reference_asset/i);
  assert.equal((executable.match(/security definer/gi) || []).length, 2);
  assert.equal((executable.match(/set search_path = ''/gi) || []).length, 2);
  assert.match(executable, /revoke insert, update on table public\.video_assets from service_role/i);
  assert.doesNotMatch(executable, /create policy/i);
  assert.doesNotMatch(executable, /update\s+storage\.buckets|insert\s+into\s+storage\.buckets/i);
  assert.doesNotMatch(executable, /public_url|createSignedUploadUrl/i);
});

test("migration não escreve nos domínios operacionais", () => {
  const protectedTables = [
    "produtos", "pedidos", "compras", "fornecedores", "notas_fiscais",
    "pricing_decisions", "anuncios_ml",
  ].join("|");
  assert.doesNotMatch(
    executable,
    new RegExp(`(?:alter\\s+table|insert\\s+into|update|delete\\s+from)\\s+public\\.(?:${protectedTables})\\b`, "i"),
  );
});

test("contratos aceitam os três slots e exatamente um alvo na consulta", () => {
  for (const slot of ["front", "profile", "full_body"]) {
    assert.equal(contracts.bvfReferenceUploadFieldsSchema.safeParse({
      requestId: id,
      target: { kind: "persona", personaId: secondId, slot },
    }).success, true);
  }
  assert.equal(contracts.bvfReferenceUploadFieldsSchema.safeParse({
    requestId: id,
    target: { kind: "persona", personaId: secondId, slot: "other" },
  }).success, false);
  assert.equal(contracts.bvfReferenceListFiltersSchema.safeParse({ personaId: id }).success, true);
  assert.equal(contracts.bvfReferenceListFiltersSchema.safeParse({ productId: id }).success, true);
  assert.equal(contracts.bvfReferenceListFiltersSchema.safeParse({ personaId: id, productId: id }).success, false);
  assert.equal(contracts.bvfReferenceListFiltersSchema.safeParse({}).success, false);
});

test("paths privados são determinísticos e separados por consumidor", () => {
  assert.equal(
    service.buildBvfReferenceStoragePath(id, { kind: "persona", personaId: secondId, slot: "front" }, "jpg"),
    `personas/${secondId}/front/${id}.jpg`,
  );
  assert.equal(
    service.buildBvfReferenceStoragePath(id, { kind: "product", productId: secondId }, "webp"),
    `products/${secondId}/${id}.webp`,
  );
  assert.equal(
    service.buildBvfJobStoragePath({ assetId: id, jobId: secondId, attemptId: id, assetType: "thumbnail", extension: "png" }),
    `jobs/${secondId}/${id}/thumbnail/${id}.png`,
  );
  assert.equal(
    service.buildBvfApprovedStoragePath({ assetId: id, jobId: secondId, attemptId: id }),
    `approved/${secondId}/${id}/${id}.mp4`,
  );
});

test("URLs remotas recusam protocolo, credencial, porta e endereços internos", () => {
  assert.equal(service.parseBvfRemoteImageUrl("https://example.com/image.jpg").hostname, "example.com");
  for (const value of [
    "http://example.com/image.jpg",
    "https://user:pass@example.com/image.jpg",
    "https://example.com:8443/image.jpg",
  ]) {
    assert.throws(() => service.parseBvfRemoteImageUrl(value), /BVF_STORAGE_REMOTE_URL_INVALID/);
  }
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.162", "::1"]) {
    assert.equal(service.isBvfBlockedRemoteAddress(address), true);
  }
  assert.equal(service.isBvfBlockedRemoteAddress("8.8.8.8"), false);
});

test("imagem é reconhecida pelo conteúdo, medida e assinada com SHA-256", async () => {
  const image = await require("sharp")({
    create: { width: 40, height: 30, channels: 3, background: "#111111" },
  }).png().toBuffer();
  const inspected = await service.inspectBvfReferenceImage(image);
  assert.equal(inspected.mimeType, "image/png");
  assert.equal(inspected.extension, "png");
  assert.equal(inspected.width, 40);
  assert.equal(inspected.height, 30);
  assert.match(inspected.checksumSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(
    () => service.inspectBvfReferenceImage(Buffer.from("not-an-image")),
    /BVF_STORAGE_IMAGE_INVALID/,
  );
  await assert.rejects(
    () => service.inspectBvfReferenceImage(Buffer.alloc(contracts.BVF_REFERENCE_MAX_BYTES + 1)),
    /BVF_STORAGE_FILE_TOO_LARGE/,
  );
});

test("rotas usam RBAC existente, URL curta e não expõem DELETE ou upload assinado", () => {
  const routeRoot = path.join(root, "src/app/api/video-factory/assets");
  const routeFiles = fs.readdirSync(routeRoot, { recursive: true })
    .filter((name) => name.endsWith("route.ts"));
  assert.equal(routeFiles.length, 5);
  const source = routeFiles
    .map((name) => fs.readFileSync(path.join(routeRoot, name), "utf8"))
    .join("\n");
  assert.match(source, /video_factory\.read/);
  assert.match(source, /video_factory\.manage/);
  assert.doesNotMatch(source, /export async function DELETE|createSignedUploadUrl|publicUrl/);
  assert.equal(contracts.BVF_SIGNED_URL_TTL_SECONDS, 600);
});
