const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const routeSource = read('src/app/api/dslite/pedido/route.ts');
const flowSource = read('src/components/pedidos/usePedidosDsliteFlow.ts');
const modalsSource = read('src/components/pedidos/PedidosDsliteModals.tsx');
const auditSource = read('src/services/nf-auditoria.ts');
const labelRouteSource = read('src/app/api/dslite/etiqueta-auto/route.ts');
const ordersPageSource = read('src/app/(app)/pedidos/page.tsx');

test('decisão de pagamento só aparece no bloqueio PIX criado pelo fluxo DSLite', () => {
  assert.match(
    flowSource,
    /payload\.stage === 'await_supplier_payment'[\s\S]*?fromCreationGate: true[\s\S]*?setPaymentDecisionModalOpen\(true\)/,
  );
  assert.match(
    flowSource,
    /const openSupplierPayment[\s\S]*?fromCreationGate: false[\s\S]*?setPaymentModalOpen\(true\)/,
  );
});

test('modal oferece somente pagar agora ou continuar com pagamento pendente', () => {
  assert.match(modalsSource, /title="Quando deseja confirmar o PIX\?"/);
  assert.match(modalsSource, /Pagar depois e continuar/);
  assert.match(modalsSource, /Pagar agora/);
  assert.match(modalsSource, /closable=\{false\}/);
  assert.match(modalsSource, /keyboard=\{false\}/);
  assert.match(modalsSource, /maskClosable=\{false\}/);
  assert.match(modalsSource, /onClick=\{flow\.continueWithPaymentPending\}/);
  assert.match(modalsSource, /onClick=\{flow\.choosePayNow\}/);
});

test('pagar agora preserva o formulário e pagar depois não envia comprovante', () => {
  assert.match(
    flowSource,
    /const choosePayNow[\s\S]*?setPaymentDecisionModalOpen\(false\)[\s\S]*?setPaymentModalOpen\(true\)/,
  );
  assert.match(
    flowSource,
    /const continueWithPaymentPending[\s\S]*?fetch\('\/api\/dslite\/pedido'[\s\S]*?continueWithSupplierPaymentPending: true/,
  );
  const deferredBlock = flowSource.slice(
    flowSource.indexOf('const continueWithPaymentPending'),
    flowSource.indexOf('const confirmSupplierPayment'),
  );
  assert.doesNotMatch(deferredBlock, /confirmar-pagamento/);
  assert.doesNotMatch(deferredBlock, /FormData|paymentReceiptFile|receipt/);
  assert.match(flowSource, /fetch\(`\/api\/compras\/\$\{paymentPrompt\.compraId\}\/confirmar-pagamento`/);
});

test('API aceita a continuação somente para compra PIX pendente já vinculada', () => {
  assert.match(routeSource, /typeof rawContinueWithSupplierPaymentPending !== "boolean"/);
  assert.match(
    routeSource,
    /continueWithSupplierPaymentPending && Boolean\(resumeAfterSupplierPayment\)/,
  );
  assert.match(routeSource, /\.select\('fulfillment_source,snapshot_source,situacao,dslite_id,evolusom_order_id,dslite_label_source,label_type,label_delivery_channel,label_delivered_at'\)/);
  assert.match(
    routeSource,
    /existingCompraRead\.data\.supplier_payment_mode !== "prepaid_pix"[\s\S]*?existingCompraRead\.data\.supplier_payment_status !== "pending"/,
  );
  assert.match(routeSource, /code: "supplier_payment_defer_not_available"/);
});

test('compra direta da Evolusom adia PIX sem reenviar o pedido', () => {
  const directBranch = routeSource.slice(
    routeSource.indexOf('const existingEvolusomId = Number(fulfillmentRead.data.evolusom_order_id'),
    routeSource.indexOf('if (!existingDsliteId) {', routeSource.indexOf('const existingEvolusomId = Number(fulfillmentRead.data.evolusom_order_id')),
  );
  assert.match(directBranch, /\.eq\('pedido_id', String\(pedidoId\)\)/);
  assert.match(directBranch, /\.eq\('evolusom_order_id', existingEvolusomId\)/);
  assert.match(directBranch, /supplier_payment_status !== 'pending'/);
  assert.match(directBranch, /evento: 'supplier_payment_deferred_by_user'/);
  assert.match(directBranch, /realLabelDeliveryChannel[\s\S]*?return NextResponse\.json\(\{[\s\S]*?deferred: true/);
  assert.match(directBranch, /placeholderLabel: isDslitePlaceholderLabelSource\(fulfillmentRead\.data\.dslite_label_source\)/);
  assert.doesNotMatch(directBranch, /createEvolusomPurchase|runDsliteCreateJob/);
  assert.match(flowSource, /if \(json\.deferred\) \{[\s\S]*?setProgressOpen\(false\)/);
  assert.match(flowSource, /json\.realLabelDeliveryChannel === 'dslite'[\s\S]*?etiqueta real já foi informada no pedido/);
  assert.match(flowSource, /json\.placeholderLabel[\s\S]*?Envie a etiqueta real por WhatsApp quando estiver disponível/);
});

test('leitura operacional reconhece o adiamento pelo número da Evolusom', () => {
  const ts = require('typescript');
  const source = read('src/lib/dslite/label-state.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', compiled)(module, module.exports);
  const { matchesDeferredSupplierPayment } = module.exports;
  const event = { evento: 'supplier_payment_deferred_by_user', status_resultante: 'continued_pending', resposta_ml: { compra_id: 'compra-1', evolusom_order_id: 63012091 } };
  assert.equal(matchesDeferredSupplierPayment(event, 'compra-1', 63012091), true);
  assert.equal(matchesDeferredSupplierPayment(event, 'compra-1', 63012092), false);
  assert.equal(matchesDeferredSupplierPayment(event, 'compra-2', 63012091), false);
  assert.equal(matchesDeferredSupplierPayment({ ...event, resposta_ml: { compra_id: 'compra-1', dslite_id: 123 } }, 'compra-1', 123), true);
});

test('continuação reutiliza o mesmo DSID e mantém o pagamento pendente', () => {
  assert.match(
    routeSource,
    /const resumeExistingDsliteOrder = Boolean\([\s\S]*?resumeAfterSupplierPayment \|\| continueWithSupplierPaymentPending/,
  );
  assert.match(
    routeSource,
    /const reusingExistingDsliteOrder = Boolean\([\s\S]*?resumeExistingDsliteOrder && existingDsliteId/,
  );
  assert.doesNotMatch(
    routeSource,
    /resumeExistingDsliteOrder && existingDsliteId && dsidAtual/,
  );
  assert.match(
    routeSource,
    /continueWithSupplierPaymentPending[\s\S]*?existingCompra\?\.supplier_payment_status \|\| "pending"/,
  );
  assert.match(routeSource, /supplier_payment_deferred: true, supplier_payment_status: "pending"/);
});

test('adiamento é auditado e não altera a exceção de etiqueta da BKR1', () => {
  assert.match(auditSource, /'supplier_payment_deferred_by_user'/);
  assert.match(
    routeSource,
    /evento: "supplier_payment_deferred_by_user"[\s\S]*?statusResultante: "continued_pending"/,
  );
  assert.match(
    routeSource,
    /const deferBkr1PaymentUntilRealLabel = Boolean\([\s\S]*?isBkr1Supplier\(fornecedorId, fornecedorNomeResolved\)/,
  );
  assert.match(
    routeSource,
    /!continueWithSupplierPaymentPending &&[\s\S]*?!deferBkr1PaymentUntilRealLabel/,
  );
});

test('repetição da etiqueta exige o mesmo pedido, compra e DSID e mantém a ação PIX', () => {
  assert.match(labelRouteSource, /String\(\(pedido as any\)\.dslite_id \|\| ''\)\.trim\(\) !== dsliteId/);
  assert.match(labelRouteSource, /bkr1PaymentPending[\s\S]*?supplier_payment_deferred_by_user[\s\S]*?matchesDeferredSupplierPayment\(/);
  assert.match(ordersPageSource, /const deferredLabelRetry = hasDsliteId[\s\S]*?order\.supplier_payment_deferred[\s\S]*?order\.dslite_label_operational_status === 'failed'/);
  assert.match(ordersPageSource, /nextAction === 'complete_dslite_label' \|\| deferredLabelRetry/);
  assert.match(ordersPageSource, /\['confirm_supplier_payment', 'send_supplier_receipt', 'resume_dslite_flow'\]\.includes\(nextAction/);
});

test('MKS usa etiqueta genérica somente após consulta válida indicar que a real não é imprimível', () => {
  assert.match(
    routeSource,
    /continueWithSupplierPaymentPending &&[\s\S]*?isMksSupplier\(fornecedorId, fornecedorNomeResolved\)[\s\S]*?consultarDisponibilidadeEtiquetaML\([\s\n]*existingShipmentId,[\s\n]*\)/,
  );
  assert.match(
    routeSource,
    /useMksDeferredPaymentPlaceholder =[\s\n]*availability\.checked && !availability\.printable/,
  );
  assert.match(
    routeSource,
    /\(isMlLabelReleasePending \|\| useMksDeferredPaymentPlaceholder\)/,
  );
  assert.match(routeSource, /reason: placeholderReason/);
});
