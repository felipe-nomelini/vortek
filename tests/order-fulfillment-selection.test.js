const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OrderFulfillmentSelectionError,
  canSelectOrderFulfillment,
  fulfillmentSelectionHttpStatus,
  parseOrderFulfillmentSelectionError,
} = require('../src/lib/orders/fulfillment-selection.ts');

test('venda sem origem escolhida oferece DSLite e estoque interno', () => {
  assert.equal(canSelectOrderFulfillment(null, 'supplier'), true);
  assert.equal(canSelectOrderFulfillment(null, 'internal'), true);
});

test('origem fornecedor bloqueia somente envio interno', () => {
  assert.equal(canSelectOrderFulfillment('supplier', 'supplier'), true);
  assert.equal(canSelectOrderFulfillment('supplier', 'internal'), false);
});

test('origem interna bloqueia somente criação DSLite', () => {
  assert.equal(canSelectOrderFulfillment('internal', 'supplier'), false);
  assert.equal(canSelectOrderFulfillment('internal', 'internal'), true);
});

test('conflito transacional preserva origem já selecionada', () => {
  const parsed = parseOrderFulfillmentSelectionError({
    code: 'P0001',
    message: 'fulfillment_conflict:supplier',
  });
  assert.equal(parsed instanceof OrderFulfillmentSelectionError, true);
  assert.equal(parsed.code, 'conflict');
  assert.equal(parsed.selectedSource, 'supplier');
  assert.equal(fulfillmentSelectionHttpStatus(parsed), 409);
});

test('ausência da migration retorna indisponibilidade temporária', () => {
  const parsed = parseOrderFulfillmentSelectionError({
    code: 'PGRST202',
    message: 'Could not find the function public.select_order_fulfillment',
  });
  assert.equal(parsed.code, 'migration_missing');
  assert.equal(fulfillmentSelectionHttpStatus(parsed), 503);
});
