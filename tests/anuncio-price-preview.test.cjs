const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/(app)/anuncios/page.tsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let previewEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[1]?.getText(ast).includes('previewReady')) previewEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(previewEffect, 'A tela deve consultar o servidor ao editar o preço');
const effectCode = ts.transpileModule(`const effect = ${previewEffect}; effect();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const state = { preview: null, timers: new Map(), requests: [], sequence: 0 };
  const run = (price, overrides = {}) => vm.runInNewContext(effectCode, {
    previewReady: true, previewItemId: 'MLB1', previewProductId: 'p1', newPrice: price,
    setPricePreview: value => { state.preview = value; },
    AbortController,
    setTimeout: callback => { const id = ++state.sequence; state.timers.set(id, callback); return id; },
    clearTimeout: id => state.timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => state.requests.push({ url, options, resolve, reject })),
    ...overrides,
  });
  const fire = () => {
    const [id, callback] = [...state.timers][0];
    state.timers.delete(id);
    return callback();
  };
  const respond = (index, price, result, ok = true) => state.requests[index].resolve({
    ok, json: async () => ({ memory: { price, result, margin: result === null ? null : result / price, reasons: [] } }),
  });
  return { state, run, fire, respond };
}

test('prévia usa o preço digitado e o lucro retornado pelo servidor, inclusive zero e prejuízo', async () => {
  for (const result of [4.10, 0, -3]) {
    const f = fixture();
    const cleanup = f.run(45);
    const pending = f.fire();
    assert.equal(f.state.requests[0].url, '/api/pricing/simulate');
    assert.deepEqual(JSON.parse(f.state.requests[0].options.body), { productId: 'p1', itemId: 'MLB1', price: 45 });
    f.respond(0, 45, result);
    await pending;
    assert.equal(f.state.preview.memory.result, result);
    cleanup();
  }
});

test('digitação rápida cancela a cotação anterior antes de enviá-la', () => {
  const f = fixture();
  f.run(4)();
  const cleanup = f.run(45);
  assert.equal(f.state.timers.size, 1);
  assert.equal(f.state.requests.length, 0);
  cleanup();
});

test('resposta atrasada não substitui o lucro do preço mais recente', async () => {
  const f = fixture();
  const oldCleanup = f.run(45);
  const oldPending = f.fire();
  oldCleanup();
  const cleanup = f.run(50);
  const pending = f.fire();
  f.respond(1, 50, 6);
  await pending;
  f.respond(0, 45, 4.1);
  await oldPending;
  assert.equal(f.state.preview.price, 50);
  assert.equal(f.state.preview.memory.result, 6);
  assert.equal(f.state.requests[0].options.signal.aborted, true);
  cleanup();
});

test('fechar a janela impede resposta pendente de preencher outra abertura', async () => {
  const f = fixture();
  const cleanup = f.run(45);
  const pending = f.fire();
  cleanup();
  f.run(45, { previewReady: false });
  f.respond(0, 45, 4.1);
  await pending;
  assert.equal(f.state.preview, null);
});

test('preço vazio ou inválido não consulta o servidor', () => {
  for (const value of [null, 0, -1, NaN]) {
    const f = fixture();
    f.run(value);
    assert.equal(f.state.timers.size, 0);
    assert.equal(f.state.preview, null);
  }
});

test('falha ou cálculo inconclusivo apresenta erro em vez de lucro antigo', async () => {
  for (const scenario of ['http', 'null', 'wrong-price', 'network']) {
    const f = fixture();
    const cleanup = f.run(45);
    const pending = f.fire();
    if (scenario === 'network') f.state.requests[0].reject(new Error('network'));
    else f.respond(0, scenario === 'wrong-price' ? 50 : 45, scenario === 'null' ? null : 4.1, scenario !== 'http');
    await pending;
    assert.equal(f.state.preview.memory, null);
    assert.match(f.state.preview.error, /Não foi possível calcular o lucro/);
    cleanup();
  }
});
