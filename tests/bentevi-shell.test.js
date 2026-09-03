const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const navigationModuleUrl = pathToFileURL(
  path.join(__dirname, '../src/lib/app-navigation.ts'),
).href;

async function loadNavigation() {
  return import(navigationModuleUrl);
}

function itemKeys(entries) {
  return entries.flatMap((entry) =>
    entry.type === 'group'
      ? [entry.key, ...entry.children.map((child) => child.key)]
      : [entry.key],
  );
}

test('preserva ordem, grupos e URLs da navegação desktop', async () => {
  const { APP_NAVIGATION } = await loadNavigation();

  assert.deepEqual(itemKeys(APP_NAVIGATION), [
    '/dashboard',
    '/tv',
    '/produtos/ofertas',
    '/produtos',
    '/estoque',
    '/clientes',
    'fornecedores-group',
    '/fornecedores/cadastros',
    '/fornecedores/creditos',
    'pedidos-group',
    '/pedidos',
    '/compras',
    '/notas-fiscais',
    '/anuncios',
    'catalogo-group',
    '/catalogo/no-catalogo',
    '/catalogo/elegiveis',
    '/perguntas',
    '/reputacao',
    '/reclamacoes',
    '/configuracoes',
  ]);
});

test('reflete no menu as restrições administrativas já existentes', async () => {
  const { navigationForRole } = await loadNavigation();

  const adminKeys = itemKeys(navigationForRole('admin'));
  assert.ok(adminKeys.includes('/produtos/ofertas'));
  assert.ok(adminKeys.includes('/configuracoes'));
  assert.ok(adminKeys.includes('/fornecedores/creditos'));

  for (const role of ['gerente', 'operador', 'visualizador', null]) {
    const keys = itemKeys(navigationForRole(role));
    assert.ok(keys.includes('/produtos/ofertas'));
    assert.ok(!keys.includes('/configuracoes'));
    assert.ok(!keys.includes('/fornecedores/creditos'));
  }
});

test('resolve aliases, rotas aninhadas e detalhes pelo item responsável', async () => {
  const { resolveNavigation } = await loadNavigation();

  assert.equal(resolveNavigation('/catalogo')?.key, '/catalogo/no-catalogo');
  assert.equal(resolveNavigation('/catalogo/elegiveis')?.key, '/catalogo/elegiveis');
  assert.equal(resolveNavigation('/produtos/123')?.key, '/produtos');
  assert.equal(resolveNavigation('/produtos/ofertas')?.key, '/produtos/ofertas');
  assert.equal(resolveNavigation('/produtos/ofertas/123')?.key, '/produtos/ofertas');
  assert.equal(resolveNavigation('/clientes/123')?.key, '/clientes');
  assert.equal(resolveNavigation('/fornecedores/123')?.key, '/fornecedores/cadastros');
  assert.equal(resolveNavigation('/fornecedores/creditos')?.key, '/fornecedores/creditos');
  assert.equal(resolveNavigation('/pedidos/123')?.key, '/pedidos');
  assert.equal(resolveNavigation('/rota-inexistente'), null);
});

test('shell usa APIs autenticadas e não recupera perfil ou saúde do localStorage', () => {
  const shellSource = fs.readFileSync(
    path.join(__dirname, '../src/components/AppShell.tsx'),
    'utf8',
  );

  assert.match(shellSource, /fetch\('\/api\/auth\/me'/);
  assert.match(shellSource, /fetch\('\/api\/integracoes\/status'/);
  assert.match(shellSource, /fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
  assert.doesNotMatch(shellSource, /vortek_user_profile|vortek_integrations|localStorage/);
});

test('mantém o título do submenu selecionado legível sobre o fundo escuro', () => {
  const shellSource = fs.readFileSync(
    path.join(__dirname, '../src/components/AppShell.tsx'),
    'utf8',
  );
  const shellStyles = fs.readFileSync(
    path.join(__dirname, '../src/components/AppShell.module.css'),
    'utf8',
  );

  assert.match(shellSource, /className=\{styles\.navigation\}/);
  assert.match(
    shellStyles,
    /\.navigation :global\(\.ant-menu-submenu-selected > \.ant-menu-submenu-title\)/,
  );
  assert.match(shellStyles, /var\(--bentevi-primary, #ffbd0e\)/);
});
