const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const page = fs.readFileSync(path.join(__dirname, '../src/app/(app)/pedidos/page.tsx'), 'utf8');
const start = page.indexOf('function getPrimaryOrderAction(');
const end = page.indexOf('export default function PedidosPage()', start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(page.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const choosePrimary = new Function(
  'isDsliteRejected',
  'needsRealLabelWhatsapp',
  `${compiled}\nreturn getPrimaryOrderAction;`,
)(() => false, () => true);

const actions = [
  { key: 'view' },
  { key: 'supplier_payment', label: 'Confirmar PIX' },
  { key: 'send_whatsapp_label', label: 'Enviar etiqueta' },
];
const order = {
  evolusom_order_id: 63012095,
  supplier_payment_mode: 'prepaid_pix',
  supplier_payment_status: 'pending',
  supplier_payment_deferred: true,
  dslite_next_action: 'confirm_supplier_payment',
  whatsapp_label_status: 'not_sent',
  dslite_label_operational_status: 'generic_sent',
};

test('PIX pendente da Evolusom tem prioridade sobre etiqueta real', () => {
  assert.equal(choosePrimary(actions, order, Date.now())?.key, 'supplier_payment');
});

test('após confirmar PIX, etiqueta real volta a ser ação principal', () => {
  assert.equal(choosePrimary(actions, { ...order, supplier_payment_status: 'paid' }, Date.now())?.key, 'send_whatsapp_label');
});

test('prioridade anterior da etiqueta permanece para outros fornecedores', () => {
  assert.equal(choosePrimary(actions, { ...order, evolusom_order_id: null }, Date.now())?.key, 'send_whatsapp_label');
});

test('pedido Evolusom sem número remoto prioriza Criar pedido em vez de Rastrear envio', () => {
  const retryActions = [
    { key: 'view', label: 'Ver detalhes' },
    { key: 'dslite', label: 'Criar pedido' },
    { key: 'track', label: 'Rastrear envio' },
  ];
  assert.equal(choosePrimary(retryActions, {
    evolusom_order_id: null,
    supplier_payment_mode: null,
    supplier_payment_status: null,
    supplier_payment_deferred: false,
    dslite_next_action: 'create_dslite_order',
    whatsapp_label_status: 'not_sent',
    dslite_label_operational_status: 'generic_sent',
  }, Date.now())?.key, 'dslite');
});
