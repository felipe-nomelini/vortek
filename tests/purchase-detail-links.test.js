const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const drawer = fs.readFileSync(path.join(root, 'src/components/compras/CompraDetailsDrawer.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/app/api/compras/route.ts'), 'utf8');

function loadProductUrl() {
  const start = drawer.indexOf('export function getPurchaseDsliteProductUrl');
  const end = drawer.indexOf('export default function', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(drawer.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  Function('module', 'exports', code)(loaded, loaded.exports);
  return loaded.exports.getPurchaseDsliteProductUrl;
}

test('link DSLite usa fornecedor e produto distintos nos exemplos confirmados', () => {
  const getUrl = loadProductUrl();
  for (const [supplier, product] of [['133', '391377'], ['108', '4360'], ['115', '1581']]) {
    assert.equal(
      getUrl({ fornecedor_id: supplier, produto_dslite_id: product }),
      `https://app.dslite.com.br/modules/admin/Produto/visualizar/${supplier}/7945/${product}`,
    );
  }
  assert.equal(getUrl({ fornecedor_id: '133', produto_dslite_id: null }), null);
  assert.equal(getUrl({ fornecedor_id: '133', produto_dslite_id: 'bad/path' }), null);
});

test('cliente e produto Bentevi são ligados por IDs próprios, sem inferência por nome ou SKU', () => {
  assert.match(route, /\.select\('id,nome,ml_id'\)/);
  assert.match(route, /clientePorMlId\.get\(String\(pedido\?\.buyer_ml_id \|\| ''\)\)/);
  assert.match(route, /cliente_id: cliente\?\.id \|\| null/);
  assert.match(route, /produto_bentevi_id: produto\?\.id \?\? null/);
  assert.match(drawer, /href=\{customerUrl\}/);
  assert.match(drawer, /href=\{benteviProductUrl\}/);
});
