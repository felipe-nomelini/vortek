const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const contracts = require("../src/lib/configuracoes/contracts.ts");

test("contratos administrativos rejeitam campos fora do domínio", () => {
  assert.equal(
    contracts.integrationConfigurationSchema.safeParse({
      tipo: "mercadolivre",
      values: { access_token: "não permitido nesta operação" },
    }).success,
    false,
  );
  assert.equal(
    contracts.preferencesConfigurationSchema.safeParse({
      margem_lucro: 30,
      notificacoes_push: true,
      nfe_provider_default: "outro",
      simples_aliquota_confirmada_percentual: null,
      simples_aliquota_confirmada_em: null,
    }).success,
    false,
  );
});

test("auditoria de credenciais persiste somente o estado configurado", () => {
  const canary = "segredo-que-nao-pode-ser-persistido";
  const snapshot = contracts.sanitizeConfigurationAuditSnapshot(
    "integracoes.access_token",
    canary,
  );
  assert.deepEqual(snapshot, { configured: true });
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(canary));

  const readSnapshot = contracts.sanitizeStoredConfigurationAuditSnapshot(
    "integracoes.access_token",
    snapshot,
  );
  assert.deepEqual(readSnapshot, { configured: true });
});

test("snapshots comuns não ganham encapsulamento duplicado ao serem lidos", () => {
  const stored = { value: 32 };
  assert.deepEqual(
    contracts.sanitizeStoredConfigurationAuditSnapshot(
      "configuracoes.margem_lucro",
      stored,
    ),
    stored,
  );
});

test("tabela de auditoria é append-only para o papel usado pela aplicação", () => {
  const migration = read(
    "supabase/migrations/20260904163000_bnt_cfg_01_admin_audit.sql",
  );
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.configuracoes_auditoria from service_role/i);
  assert.match(migration, /grant select, insert on table public\.configuracoes_auditoria to service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*(?:update|delete)[^;]*service_role/i);
  for (const key of Object.keys(contracts.CONFIGURATION_DEFINITIONS)) {
    assert.match(migration, new RegExp(`'${key.replaceAll(".", "\\.")}'`));
  }
});

test("todas as mutações administrativas existentes registram auditoria", () => {
  for (const route of [
    "src/app/api/configuracoes/route.ts",
    "src/app/api/configuracoes/empresa/route.ts",
    "src/app/api/configuracoes/fiscal-provider/route.ts",
    "src/app/api/configuracoes/usuarios/route.ts",
    "src/app/api/configuracoes/usuarios/[id]/route.ts",
    "src/app/api/integracoes/config/route.ts",
  ]) {
    assert.match(read(route), /recordConfigurationAudit/);
  }
});
