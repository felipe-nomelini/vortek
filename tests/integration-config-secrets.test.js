const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  toIntegrationConfigDto,
} = require("../src/lib/integration-config-dto.ts");

const root = path.resolve(__dirname, "..");

test("DTO de integrações nunca serializa os secrets armazenados", () => {
  const dto = toIntegrationConfigDto({
    tipo: "mercadolivre",
    client_id: "client-id-publico",
    client_secret: "sentinela-client-secret",
    access_token: "sentinela-access-token",
    refresh_token: "sentinela-refresh-token",
    redirect_uri: "https://dev.vortek.shop/callback",
    url: "https://example.invalid",
    conectado: true,
    last_refresh_error: null,
    last_refresh_error_code: null,
    token_expires_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  });

  assert.equal(dto.client_secret_configurado, true);
  assert.equal(dto.access_token_configurado, true);
  assert.equal(dto.refresh_token_configurado, true);
  assert.equal(dto.client_id, "client-id-publico");
  for (const field of ["client_secret", "access_token", "refresh_token"]) {
    assert.equal(Object.hasOwn(dto, field), false);
  }
  const serialized = JSON.stringify(dto);
  assert.doesNotMatch(serialized, /sentinela-(client-secret|access-token|refresh-token)/);
});

test("flags tratam valores nulos, vazios e espaços como não configurados", () => {
  const dto = toIntegrationConfigDto({
    tipo: "brasilnfe",
    client_secret: null,
    access_token: "",
    refresh_token: "   ",
  });

  assert.equal(dto.client_secret_configurado, false);
  assert.equal(dto.access_token_configurado, false);
  assert.equal(dto.refresh_token_configurado, false);
});

test("GET e PATCH aplicam o mesmo DTO seguro", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/integracoes/config/route.ts"),
    "utf8",
  );

  assert.match(route, /integracoes: \(data \|\| \[\]\)\.map\(\(row\) =>/);
  assert.match(route, /integracao: toIntegrationConfigDto\(data/);
  assert.equal(route.match(/toIntegrationConfigDto\(/g)?.length, 2);
  assert.doesNotMatch(route, /integracoes: data \|\| \[\]/);
  assert.doesNotMatch(route, /integracao: data[ },]/);
});

test("cliente não lê secrets existentes e testes usam configuração server-side", () => {
  const page = fs.readFileSync(
    path.join(root, "src/app/(app)/configuracoes/page.tsx"),
    "utf8",
  );
  const integrationsTab = fs.readFileSync(
    path.join(root, "src/components/configuracoes/IntegracoesTab.tsx"),
    "utf8",
  );
  const dsliteRoute = fs.readFileSync(
    path.join(root, "src/app/api/integracoes/teste/dslite/route.ts"),
    "utf8",
  );
  const brasilNfeRoute = fs.readFileSync(
    path.join(root, "src/app/api/integracoes/teste/brasilnfe/route.ts"),
    "utf8",
  );

  assert.doesNotMatch(
    `${page}\n${integrationsTab}`,
    /(?:^|[^A-Za-z0-9_])integration\.(client_secret|access_token|refresh_token)(?!_configurado)/,
  );
  assert.doesNotMatch(page, /client_secret|access_token|refresh_token/);
  assert.match(integrationsTab, /client_secret_configurado/);
  assert.match(integrationsTab, /access_token_configurado/);
  assert.match(integrationsTab, /refresh_token_configurado/);
  for (const source of [dsliteRoute, brasilNfeRoute]) {
    assert.match(source, /createServiceClient\(\)/);
    assert.doesNotMatch(source, /request\.json\(/);
  }
});
