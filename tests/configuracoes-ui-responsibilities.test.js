const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("src/app/(app)/configuracoes/page.tsx");
const empresa = read("src/components/configuracoes/EmpresaTab.tsx");
const integracoes = read("src/components/configuracoes/IntegracoesTab.tsx");
const usuarios = read("src/components/configuracoes/UsuariosTab.tsx");
const preferencias = read("src/components/configuracoes/PreferenciasTab.tsx");
const auditoria = read("src/components/configuracoes/AuditoriaTab.tsx");

test("Configurações mantém uma rota e delega as tabs administrativas", () => {
  for (const component of [
    "EmpresaTab",
    "IntegracoesTab",
    "UsuariosTab",
    "PreferenciasTab",
    "AuditoriaTab",
  ]) {
    assert.match(page, new RegExp(`<${component} messageApi=\\{messageApi\\} \\/>`));
  }
  for (const key of ["empresa", "integracoes", "usuarios", "preferencias", "historico"]) {
    assert.match(page, new RegExp(`key: "${key}"`));
  }
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /<Suspense/);
  assert.equal(page.match(/forceRender: true/g)?.length, 4);
  assert.match(auditoria, /fetch\(`\/api\/configuracoes\/auditoria\?/);
});

test("página permanece apenas como shell e não concentra operações das tabs", () => {
  for (const pattern of [
    /\/api\/configuracoes/,
    /\/api\/integracoes/,
    /\/api\/push/,
    /SecretCredentialField/,
    /<Modal/,
    /<Table/,
  ]) {
    assert.doesNotMatch(page, pattern);
  }
});

test("cada tab concentra somente seu fluxo operacional", () => {
  assert.match(empresa, /fetch\("\/api\/configuracoes\/empresa"/);
  assert.doesNotMatch(empresa, /\/api\/integracoes|\/api\/push|\/usuarios/);

  assert.match(integracoes, /fetch\("\/api\/integracoes\/config"/);
  assert.match(integracoes, /function SecretCredentialField/);
  assert.doesNotMatch(integracoes, /\/api\/configuracoes\/usuarios|\/api\/push/);

  assert.match(usuarios, /fetch\("\/api\/configuracoes\/usuarios"/);
  assert.match(usuarios, /<Table<Usuario>/);
  assert.doesNotMatch(usuarios, /\/api\/integracoes|\/api\/push/);

  assert.match(preferencias, /fetch\("\/api\/configuracoes"/);
  assert.match(preferencias, /\/api\/push\/subscription/);
  assert.doesNotMatch(preferencias, /\/api\/integracoes|\/usuarios/);
});
