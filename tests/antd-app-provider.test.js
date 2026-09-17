const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { App } = require('antd');
const ts = require('typescript');

test('provider raiz entrega confirmação e mensagens às páginas sem alterar o layout', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/Providers.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const load = (id) => id === '@/theme/bentevi'
    ? { benteviColors: {
      background: '#000', surface: '#111', surfaceElevated: '#222', border: '#333',
      primary: '#ffb900', text: '#fff', textSecondary: '#aaa', textOnPrimary: '#000',
    } }
    : require(id);
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);

  let context;
  function Probe() {
    context = App.useApp();
    return React.createElement('span', null, 'conteúdo');
  }
  const html = renderToString(React.createElement(module.exports.default, null, React.createElement(Probe)));

  assert.equal(typeof context.modal?.confirm, 'function');
  assert.equal(typeof context.message?.success, 'function');
  assert.equal(typeof context.message?.error, 'function');
  assert.match(html, /conteúdo/);
  assert.doesNotMatch(html, /class="ant-app/);
});
