const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const page = fs.readFileSync(path.join(__dirname, '../src/app/(app)/pedidos/page.tsx'), 'utf8');
const start = page.indexOf('function getOrderPurchaseDisplay(');
const end = page.indexOf('function getOrderActions(', start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(page.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const display = new Function('isValidDsliteId', `${compiled}\nreturn getOrderPurchaseDisplay;`)(
  (value) => value && value !== 'undefined' && value !== 'null' ? value : null,
);

test('pedido antigo da Evolusom feito na DSLite conserva link e status DSLite', () => {
  assert.deepEqual(display({
    dslite_id: '411652', fornecedor_id: '133', compra_id: 'historical-purchase',
    compra_status_dslite: 'Em processamento', evolusom_order_id: null,
  }), {
    kind: 'dslite', number: '411652', status: 'Em processamento',
    href: 'https://app.dslite.com.br/modules/admin/Pedido/exibir/411652',
  });
});

test('compra direta usa número da Evolusom e abre seu registro no Bentevi', () => {
  assert.deepEqual(display({
    dslite_id: null, fornecedor_id: '133', compra_id: 'direct-purchase',
    evolusom_order_id: 63012095, evolusom_request_code: '80255102', compra_status: 'Bloqueado',
  }), {
    kind: 'evolusom', number: '63012095', status: 'Bloqueado', href: '/compras?search=80255102',
  });
});

test('reserva incerta mantém aviso e venda sem compra mantém estado original', () => {
  assert.deepEqual(display({ dslite_id: null, compra_id: 'uncertain', fornecedor_id: '133' }), { kind: 'pending' });
  assert.deepEqual(display({ dslite_id: null, compra_id: null, fornecedor_id: '133' }), { kind: 'not_created' });
});
