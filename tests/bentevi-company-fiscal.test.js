const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const contracts = require("../src/lib/configuracoes/contracts.ts");
const cnpj = require("../src/lib/fiscal/cnpj.js");

const validCompany = {
  nome: "Bentevi",
  cnpj: "65.850.289/0001-83",
  email: "contato@bentevi.shop",
  telefone: "",
  endereco_fiscal: {
    cep: "13000000",
    logradouro: "Rua de Homologação",
    numero: "S/N",
    complemento: "",
    bairro: "Centro",
    municipio: "Campinas",
    uf: "SP",
    codigo_ibge: "3509502",
  },
};

test("valida CNPJ numérico e alfanumérico pelo contrato vigente", () => {
  assert.equal(cnpj.isValidCnpj("65.850.289/0001-83"), true);
  assert.equal(cnpj.isValidCnpj("00.000.000/E08G-12"), true);
  assert.equal(cnpj.isValidCnpj("65.850.289/0001-84"), false);
  assert.equal(cnpj.isValidCnpj("00.000.000/0000-00"), false);
  assert.equal(cnpj.formatCnpj("00000000e08g12"), "00.000.000/E08G-12");
});

test("contrato da empresa exige endereço fiscal estruturado", () => {
  const parsed = contracts.companyConfigurationSchema.safeParse(validCompany);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.cnpj, "65850289000183");

  assert.equal(
    contracts.companyConfigurationSchema.safeParse({
      ...validCompany,
      endereco_fiscal: { ...validCompany.endereco_fiscal, cep: "13000" },
    }).success,
    false,
  );
  assert.equal(
    contracts.companyConfigurationSchema.safeParse({
      ...validCompany,
      endereco_fiscal: { ...validCompany.endereco_fiscal, uf: "RS" },
    }).success,
    false,
  );
  assert.equal(
    contracts.companyConfigurationSchema.safeParse({
      ...validCompany,
      nickname: "fonte que pertence ao Mercado Livre",
    }).success,
    false,
  );
});

test("contrato tributário mantém alíquota e confirmação inseparáveis", () => {
  const base = {
    simples_inicio_atividade: "2026-03-23",
    simples_aliquota_confirmada_percentual: 7.2,
    simples_aliquota_confirmada_em: "2026-08-01",
  };
  assert.equal(contracts.fiscalConfigurationSchema.safeParse(base).success, true);
  assert.equal(
    contracts.fiscalConfigurationSchema.safeParse({
      ...base,
      simples_aliquota_confirmada_em: null,
    }).success,
    false,
  );
  assert.equal(
    contracts.fiscalConfigurationSchema.safeParse({
      ...base,
      simples_aliquota_confirmada_em: "2026-01-01",
    }).success,
    false,
  );
});

test("BNT-CFG-02 elimina fontes fiscais ambíguas da interface e operação", () => {
  const companyUi = read("src/components/configuracoes/EmpresaTab.tsx");
  const notifications = read("src/components/configuracoes/NotificacoesTab.tsx");
  const integrations = read("src/components/configuracoes/IntegracoesTab.tsx");
  const pricingContext = read("src/services/pricing-tax-context.ts");
  const orderSync = read("src/app/api/sync/pedidos/route.ts");
  const dslite = read("src/app/api/dslite/pedido/route.ts");

  for (const label of [
    "Identidade e contato",
    "Endereço fiscal",
    "Simples Nacional",
    "Saúde do emissor fiscal",
  ]) {
    assert.match(companyUi, new RegExp(label));
  }
  assert.doesNotMatch(companyUi, /Nickname ML/);
  assert.doesNotMatch(notifications, /Tributação da precificação|23\/03\/2026/);
  assert.doesNotMatch(integrations, /Provedor fiscal padrão/);
  assert.doesNotMatch(pricingContext, /DEFAULT_ACTIVITY_START_DATE/);
  assert.doesNotMatch(orderSync, /endereco_fallback/);
  assert.doesNotMatch(dslite, /endereco_fallback/);
  assert.match(companyUi, /emission_environment\.valid/);
  assert.match(companyUi, /return_environment\.valid/);
});

test("DTO da empresa não exige complemento para considerar o endereço estruturado", () => {
  const route = read("src/app/api/configuracoes/empresa/route.ts");
  assert.doesNotMatch(route, /Object\.values\(address\)\.every\(Boolean\)/);
  assert.match(route, /address\.codigo_ibge/);
});

test("migration mantém uma empresa e protege tabelas administrativas", () => {
  const migration = read(
    "supabase/migrations/20260904210000_bnt_cfg_02_company_fiscal.sql",
  );
  assert.match(migration, /empresa_singleton_idx/);
  assert.match(migration, /on public\.empresa \(\(true\)\)/);
  assert.match(migration, /alter column simples_inicio_atividade drop default/i);
  assert.match(migration, /alter table public\.empresa enable row level security/i);
  assert.match(migration, /revoke all on table public\.empresa from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update on table public\.empresa to service_role/i);
});
