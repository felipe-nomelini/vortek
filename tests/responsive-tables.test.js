const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const adjustableTableConsumers = [
  'src/app/(app)/anuncios/page.tsx',
  'src/app/(app)/clientes/page.tsx',
  'src/app/(app)/compras/page.tsx',
  'src/app/(app)/fornecedores/page.tsx',
  'src/app/(app)/notas-fiscais/page.tsx',
  'src/app/(app)/pedidos/page.tsx',
  'src/app/(app)/produtos/page.tsx',
  'src/app/(app)/produtos/ofertas/page.tsx',
  'src/app/(app)/reclamacoes/page.tsx',
  'src/components/catalogo/CatalogoView.tsx',
  'src/components/fiscal/FiscalReturnsPanel.tsx',
];

test('tabelas antes ajustáveis usam o componente responsivo sem largura horizontal forçada', () => {
  for (const file of adjustableTableConsumers) {
    const source = read(file);
    assert.match(source, /ResponsiveTable/);
    assert.doesNotMatch(source, /ResizableTable/);
    assert.doesNotMatch(source, /storageKey=/);
    assert.doesNotMatch(source, /scroll=\{\{ x:/);
    assert.doesNotMatch(source, /fixed: ['"](?:left|right)['"]/);
  }
});

test('componente compartilhado ocupa a largura disponível e oferece cartões completos', () => {
  const component = read('src/components/ResponsiveTable.tsx');
  const styles = read('src/components/ResponsiveTable.module.css');

  assert.match(component, /tableLayout="fixed"/);
  assert.match(component, /flattenColumns/);
  assert.match(component, /Selecionar esta página/);
  assert.match(component, /Ordenar cartões por/);
  assert.match(component, /<Pagination/);
  assert.match(styles, /@media \(max-width: 1199px\)/);
  assert.match(styles, /overflow-x: hidden !important/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /\.desktopActionCell/);
  assert.match(styles, /\.ant-space-item:last-child/);
  assert.match(styles, /\.actionField/);
});

test('dependências e estilos do redimensionamento foram removidos', () => {
  const packageJson = read('package.json');
  const lockfile = read('package-lock.json');
  const globals = read('src/app/globals.css');

  assert.doesNotMatch(packageJson, /react-resizable/);
  assert.doesNotMatch(lockfile, /react-resizable/);
  assert.doesNotMatch(globals, /rt-resizable/);
  assert.equal(fs.existsSync(path.join(root, 'src/components/ResizableTable.tsx')), false);
});

test('ações de Vendas usam textos curtos em botões, menus e modal', () => {
  const page = read('src/app/(app)/pedidos/page.tsx');
  const modals = read('src/components/pedidos/PedidosDsliteModals.tsx');
  const whatsappModals = read('src/components/pedidos/PedidosLabelWhatsappModals.tsx');
  const ui = `${page}\n${modals}\n${whatsappModals}`;

  for (const label of ['Enviar etiqueta', 'Reenviar etiqueta', 'Tentar novamente', 'Confirmar PIX', 'Retomar fluxo']) {
    assert.match(ui, new RegExp(`['"]${label}['"]`));
  }
  for (const oldLabel of [
    'Enviar etiqueta por WhatsApp',
    'Reenviar etiqueta por WhatsApp',
    'Tentar novamente por WhatsApp',
    'Confirmar PIX do fornecedor',
    'Retomar fluxo DSLite',
    'Enviar etiqueta genérica por WhatsApp',
    'Enviando Etiqueta por WhatsApp',
  ]) {
    assert.doesNotMatch(ui, new RegExp(oldLabel));
  }
});
