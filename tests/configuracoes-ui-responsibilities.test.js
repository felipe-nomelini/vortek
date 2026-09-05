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
const notificacoes = read("src/components/configuracoes/NotificacoesTab.tsx");
const auditoria = read("src/components/configuracoes/AuditoriaTab.tsx");
const operacao = read("src/components/configuracoes/OperacaoTab.tsx");
const mercadoLivre = read("src/components/configuracoes/MercadoLivreTab.tsx");

test("oito abas usam um único cabeçalho sem sobrescrever sua tipografia", () => {
  const ts = require("typescript");
  for (const name of ["Empresa", "Comercial", "Operacao", "MercadoLivre", "Notificacoes", "Integracoes", "Usuarios", "Auditoria"]) {
    const source = read(`src/components/configuracoes/${name}Tab.tsx`);
    const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const headings = [];
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ConfiguracoesTabHeading") headings.push(node);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(headings.length, 1, name);
    assert.deepEqual(headings[0].attributes.properties.map(prop => prop.name?.getText(ast)).sort(), ["description", "title"], name);
  }
});

test("cabeçalho padroniza título 20/28 e descrição 14/22 com cores Bentevi", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const load = require("./helpers/load-integration-module");
  const { benteviColors } = require("../src/theme/bentevi.ts");
  const Heading = load("src/components/configuracoes/ConfiguracoesTabHeading.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"), antd: require("antd"),
    "@/theme/bentevi": { benteviColors },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Heading, { title: "Título de teste", description: "Descrição de teste" }));
  assert.match(html, /<h4[^>]*style="[^"]*margin:0 0 6px;font-size:20px;font-weight:600;line-height:28px/);
  assert.match(html, /display:block;font-size:14px;line-height:22px/);
  assert.ok(html.includes(benteviColors.text));
  assert.ok(html.includes(benteviColors.textSecondary));
});

test("Configurações mantém uma rota e delega as tabs administrativas", () => {
  for (const component of [
    "EmpresaTab",
    "OperacaoTab",
    "MercadoLivreTab",
    "IntegracoesTab",
    "UsuariosTab",
    "NotificacoesTab",
    "AuditoriaTab",
  ]) {
    assert.match(page, new RegExp(`<${component} messageApi=\\{messageApi\\} \\/>`));
  }
  for (const key of ["empresa", "operacao", "mercado-livre", "notificacoes", "integracoes", "usuarios", "historico"]) {
    assert.match(page, new RegExp(`key: "${key}"`));
  }
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /<Suspense/);
  assert.equal(page.match(/forceRender: true/g)?.length, 7);
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
  assert.doesNotMatch(integracoes, /Conectar com ML|\/api\/integracao\/ml\/connect/);
  assert.doesNotMatch(integracoes, /\/api\/configuracoes\/usuarios|\/api\/push/);

  assert.match(usuarios, /fetch\("\/api\/configuracoes\/usuarios"/);
  assert.match(usuarios, /<Table<Usuario>/);
  assert.doesNotMatch(usuarios, /\/api\/integracoes|\/api\/push/);

  assert.match(notificacoes, /fetch\("\/api\/configuracoes\/notificacoes"/);
  assert.match(notificacoes, /\/api\/push\/subscription/);
  assert.doesNotMatch(notificacoes, /\/api\/integracoes|\/configuracoes\/usuarios/);

  assert.match(operacao, /fetch\("\/api\/configuracoes\/operacao"/);
  assert.doesNotMatch(operacao, /\/api\/integracoes|\/api\/push|\/usuarios/);

  assert.match(mercadoLivre, /fetch\("\/api\/configuracoes\/mercado-livre"/);
  assert.match(mercadoLivre, /\/api\/integracao\/ml\/connect/);
  assert.doesNotMatch(mercadoLivre, /application\.(accessToken|refreshToken|clientSecret)(?!Configured)/);
});
