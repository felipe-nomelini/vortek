const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(relativePath, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)(
    (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Dependência não simulada: ${name}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

const eligibility = load('src/lib/supplier-oracle-eligibility.ts');
const labelState = load('src/lib/dslite/label-state.ts');
const supplierLabelState = load('src/lib/dslite/supplier-label-state.ts', { './label-state': labelState });

function readyInput() {
  return {
    selectedSupplierDsliteId: '108',
    accountValid: true,
    hasActiveAllocation: false,
    purchase: {
      fornecedor_id: '108', supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending',
      supplier_payment_amount: 100.25, status: 'Aguardando Pagamento Fornecedor',
      status_dslite: 'Confirmado', supply_status: 'ready', supplier_settlement_id: null,
    },
    sales: [{
      situacao: 'pendente', ml_claim_id: null, snapshot_incompleto: false, snapshot_pendencias: [],
      label_type: 'real', label_delivery_channel: 'dslite', label_delivered_at: '2026-09-16T12:00:00Z',
    }],
  };
}

test('compra PIX pendente com venda vinculada não recebe exclusões', () => {
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(readyInput()), []);
});

test('abastecimento, revisão, etiqueta e pendências operacionais não bloqueiam', () => {
  const input = readyInput();
  input.purchase.supply_status = 'unknown';
  input.purchase.status_dslite = 'Aguardando Informações';
  input.sales[0].situacao = 'encerrado';
  input.sales[0].snapshot_incompleto = true;
  input.sales[0].ml_claim_id = 'claim';
  input.sales[0].label_type = 'provisional';
  input.sales[0].label_delivered_at = null;
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(input), []);
});

test('motivos independentes são retornados juntos e de modo determinístico', () => {
  const input = readyInput();
  input.accountValid = false;
  input.purchase.supplier_payment_amount = null;
  input.sales[0].situacao = 'cancelado';
  input.hasActiveAllocation = true;
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(input), [
    'invalid_account', 'amount_invalid', 'sale_cancelled', 'allocated',
  ]);
});

test('venda ausente ou múltipla e compra cancelada continuam fora', () => {
  const missing = readyInput();
  missing.sales = [];
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(missing), ['sale_missing']);
  const ambiguous = readyInput();
  ambiguous.sales.push({ ...ambiguous.sales[0] });
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(ambiguous), ['sale_ambiguous']);
  const cancelled = readyInput();
  cancelled.purchase.status = 'Cancelado';
  cancelled.purchase.status_dslite = 'Revisão';
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(cancelled), ['purchase_cancelled']);
});

test('pagamento não pendente, fornecedor diferente e crédito já alocado não passam', () => {
  const input = readyInput();
  input.purchase.fornecedor_id = '2';
  input.purchase.supplier_payment_status = 'paid';
  input.purchase.supplier_settlement_id = 'settlement';
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(input), [
    'supplier_mismatch', 'payment_not_pending', 'allocated',
  ]);
});

test('valor com mais de duas casas não aparece como fechável', () => {
  const input = readyInput();
  input.purchase.supplier_payment_amount = 10.001;
  assert.deepEqual(eligibility.evaluateSupplierOracleEligibility(input), ['amount_invalid']);
});

test('somente sucesso de etiqueta real define data de entrega', () => {
  const date = '2026-09-16T12:00:00Z';
  assert.deepEqual(supplierLabelState.supplierDsliteLabelState('mercado_livre', date), {
    label_type: 'real', label_delivery_channel: 'dslite', label_delivered_at: date,
  });
  assert.deepEqual(supplierLabelState.supplierDsliteLabelState('placeholder_release_window_bkr1', date), {
    label_type: 'provisional', label_delivery_channel: 'dslite', label_delivered_at: null,
  });
  assert.deepEqual(supplierLabelState.supplierDsliteLabelState('dslite_paid_shipping', date), {
    label_type: null, label_delivery_channel: null, label_delivered_at: null,
  });
  assert.deepEqual(supplierLabelState.supplierWhatsappLabelState(date), {
    label_type: 'real', label_delivery_channel: 'whatsapp', label_delivered_at: date,
  });
});
