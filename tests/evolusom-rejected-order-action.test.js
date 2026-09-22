const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/services/order-read-projection.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const projection = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) => name === '@/lib/supplier-balance' ? { isBkr1Supplier: () => false } : {},
  projection, projection.exports,
);

async function projectPurchase(requestState, orderId = null, purchasePatch = {}, orderPatch = {}) {
  const client = {
    from(table) {
      return {
        select() { return this; },
        in() {
          if (table === 'pedidos') return Promise.resolve({ data: [{ id: 'sale-1', fulfillment_source: 'supplier' }], error: null });
          if (table === 'compras') return Promise.resolve({ data: [{
            id: 'purchase-1', pedido_id: 'sale-1', fornecedor_id: '133',
            evolusom_order_id: orderId, evolusom_request_state: requestState,
            evolusom_request_code: '80000123', status: 'Bloqueado',
            supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending',
            ...purchasePatch,
          }], error: null });
          if (table === 'fornecedores') return Promise.resolve({ data: [{
            dslite_id: '133', supplier_pix_key: 'pix@example.test', telefone: '11999999999',
          }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
  const rows = await projection.exports.enrichPedidosWithCompras([{
    id: 'sale-1', numero: 123, situacao: 'pendente', dslite_id: null,
    envio_interno_at: null, evolusom_order_id: null,
    ...orderPatch,
  }], client);
  return rows[0];
}

test('compra Evolusom rejeitada volta a oferecer criação no pedido de venda', async () => {
  const row = await projectPurchase('rejected');
  assert.equal(row.compra_id, null);
  assert.equal(row.evolusom_order_id, null);
  assert.equal(row.dslite_next_action, 'create_dslite_order');
});

test('compra Evolusom projeta chave PIX e pagamento sem perder a compra direta', async () => {
  const row = await projectPurchase('created', 63012097, {
    supplier_payment_status: 'paid',
    supplier_payment_receipt_path: 'compras/comprovante.jpg',
    supplier_payment_reference: 'PIX-REAL',
  }, { situacao: 'etiqueta_impressa', dslite_label_source: 'placeholder_release_window_evolusom' });
  assert.equal(row.evolusom_order_id, 63012097);
  assert.equal(row.supplier_pix_key, 'pix@example.test');
  assert.equal(row.supplier_payment_receipt_path, 'compras/comprovante.jpg');
  assert.equal(row.supplier_payment_reference, 'PIX-REAL');
  assert.equal(row.dslite_next_action, 'wait_ml_label');
});

test('reserva incerta volta a oferecer tentativa manual e compra criada segue para pagamento', async () => {
  const uncertain = await projectPurchase('uncertain');
  assert.equal(uncertain.compra_id, null);
  assert.equal(uncertain.dslite_next_action, 'create_dslite_order');
  assert.equal(uncertain.dslite_next_action_label, 'Criar pedido');

  const created = await projectPurchase('created', 456);
  assert.equal(created.compra_id, 'purchase-1');
  assert.equal(created.evolusom_order_id, 456);
  assert.equal(created.evolusom_request_code, '80000123');
  assert.equal(created.compra_status, 'Bloqueado');
  assert.equal(created.dslite_next_action, 'confirm_supplier_payment');
});

test('compra DSLite com pedido_id permanece no fluxo DSLite', async () => {
  const historical = {
    id: 'purchase-old', pedido_id: 'sale-old', dsid: '411652',
    fornecedor_id: '133', status_dslite: 'Em processamento', status: 'Em processamento',
    evolusom_order_id: null, evolusom_request_state: null,
  };
  const client = {
    from(table) {
      return {
        select() { return this; },
        in(field) {
          if (table === 'compras' && field === 'pedido_id') return Promise.resolve({ data: [historical], error: null });
          if (table === 'compras' && field === 'dsid') return Promise.resolve({ data: [historical], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
  const [row] = await projection.exports.enrichPedidosWithCompras([{
    id: 'sale-old', numero: 123, situacao: 'pendente', dslite_id: '411652', envio_interno_at: null,
  }], client);
  assert.equal(row.compra_id, 'purchase-old');
  assert.equal(row.compra_status_dslite, 'Em processamento');
  assert.equal(row.evolusom_order_id, undefined);
  assert.equal(row.dslite_next_action, 'complete_dslite_label');
});
