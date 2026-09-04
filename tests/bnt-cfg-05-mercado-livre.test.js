const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contracts = require("../src/lib/configuracoes/contracts.ts");
const saleTerms = require("../src/lib/ml-sale-terms.ts");

test("contrato Mercado Livre separa aplicativo e garantia", () => {
  assert.equal(contracts.mercadoLivreConfigurationPatchSchema.safeParse({
    section: "application", clientId: "123456", clientSecret: "secret-write-only",
  }).success, true);
  assert.equal(contracts.mercadoLivreConfigurationPatchSchema.safeParse({
    section: "application", clientId: "abc",
  }).success, false);
  assert.equal(contracts.mercadoLivreConfigurationPatchSchema.safeParse({
    section: "warranty", warrantyTypeId: "2230279", warrantyDuration: 12, warrantyUnit: "meses",
  }).success, true);
  assert.equal(contracts.mercadoLivreConfigurationPatchSchema.safeParse({
    section: "warranty", warrantyTypeId: "inventado", warrantyDuration: 0, warrantyUnit: "semanas",
  }).success, false);
});

test("garantia padrão só é criada quando a categoria aceita exatamente seus termos", () => {
  const configured = { typeId: "2230279", duration: 12, unit: "meses" };
  assert.deepEqual(saleTerms.buildSupportedMlWarrantyTerms([], configured), []);
  assert.deepEqual(saleTerms.buildSupportedMlWarrantyTerms([
    { id: "WARRANTY_TYPE", values: [{ id: "2230280", name: "Garantia do vendedor" }] },
    { id: "WARRANTY_TIME", value_type: "number_unit" },
  ], configured), []);
  assert.deepEqual(saleTerms.buildSupportedMlWarrantyTerms([
    { id: "WARRANTY_TYPE", values: [{ id: "2230279", name: "Garantia de fábrica" }] },
    { id: "WARRANTY_TIME", value_type: "number_unit" },
  ], configured), [
    { id: "WARRANTY_TYPE", value_id: "2230279", value_name: "Garantia de fábrica" },
    { id: "WARRANTY_TIME", value_name: "12 meses" },
  ]);
});

test("normalização não inventa garantia quando ela não foi informada", () => {
  assert.deepEqual(saleTerms.normalizeMlSaleTerms([]), []);
  assert.equal(saleTerms.normalizeMlWarrantyTime("prazo livre"), null);
});

test("rota dedicada não devolve segredos e protege desconexão parcial", () => {
  const route = read("src/app/api/configuracoes/mercado-livre/route.ts");
  assert.match(route, /requireAdminUser/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /clientSecretConfigured/);
  assert.match(route, /As credenciais locais foram preservadas/);
  assert.doesNotMatch(route, /clientSecret:\s*integration\.client_secret/);
  assert.doesNotMatch(route, /accessToken:\s*integration\.access_token/);
  assert.doesNotMatch(route, /refreshToken:\s*integration\.refresh_token/);
});

test("OAuth falha fechado sem domínio configurado e retorna à aba dedicada", () => {
  const config = read("src/lib/ml-oauth-config.ts");
  const callback = read("src/app/api/integracao/ml/callback/route.ts");
  assert.doesNotMatch(config, /app\.vortek\.shop|DEFAULT_APP_URL/);
  assert.match(config, /NEXT_PUBLIC_APP_URL não configurada/);
  assert.match(callback, /requireAdminUser/);
  assert.match(callback, /tab=mercado-livre/);
});

test("migration limita garantia e adiciona as chaves de auditoria", () => {
  const migration = read("supabase/migrations/20260905003000_bnt_cfg_05_mercado_livre.sql");
  assert.match(migration, /ml_default_warranty_type_id in \('2230279', '2230280'\)/);
  assert.match(migration, /ml_default_warranty_duration between 1 and 1200/);
  assert.match(migration, /ml_default_warranty_unit in \('dias', 'meses', 'anos'\)/);
  assert.match(migration, /integracoes\.mercadolivre\.oauth_tokens/);
});
