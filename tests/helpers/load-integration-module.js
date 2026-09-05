const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Isolated module loader for integration routes: dependencies must be explicitly injected.
module.exports = function load(relativePath, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.resolve(relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
};
