const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/services/order-read-projection.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const projection = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({}), projection, projection.exports);

async function projectPurchase(requestState, orderId = null) {
  const client = {
    from(table) {
      return {
        select() { return this; },
        in() {
          if (table === 'pedidos') return Promise.resolve({ data: [{ id: 'sale-1', fulfillment_source: 'supplier' }], error: null });
          if (table === 'compras') return Promise.resolve({ data: [{
            id: 'purchase-1', pedido_id: 'sale-1', fornecedor_id: '133',
            evolusom_order_id: orderId, evolusom_request_state: requestState,
            supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending',
          }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
  const rows = await projection.exports.enrichPedidosWithCompras([{
    id: 'sale-1', numero: 123, situacao: 'pendente', dslite_id: null,
    envio_interno_at: null, evolusom_order_id: null,
  }], client);
  return rows[0];
}

test('compra Evolusom rejeitada volta a oferecer criação no pedido de venda', async () => {
  const row = await projectPurchase('rejected');
  assert.equal(row.compra_id, null);
  assert.equal(row.evolusom_order_id, null);
  assert.equal(row.dslite_next_action, 'create_dslite_order');
});

test('reserva incerta permanece bloqueada e compra criada segue para pagamento', async () => {
  const uncertain = await projectPurchase('uncertain');
  assert.equal(uncertain.compra_id, 'purchase-1');
  assert.equal(uncertain.dslite_next_action, 'blocked');

  const created = await projectPurchase('created', 456);
  assert.equal(created.compra_id, 'purchase-1');
  assert.equal(created.evolusom_order_id, 456);
  assert.equal(created.dslite_next_action, 'confirm_supplier_payment');
});
