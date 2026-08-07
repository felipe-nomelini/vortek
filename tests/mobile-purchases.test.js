const assert = require("node:assert/strict");
const test = require("node:test");

const { mapMobilePurchase, mapMobilePurchasesSummary } = require("../src/lib/mobile-purchases.ts");

test("mapeia compra sem expor caminho interno do comprovante", () => {
  const purchase = mapMobilePurchase({
    id: "11111111-1111-4111-8111-111111111111",
    dsid: "392559",
    produto_descricao: "Produto teste",
    quantidade: 2,
    valor_total: 234,
    supplier_payment_mode: "prepaid_pix",
    supplier_payment_status: "pending",
    supplier_payment_receipt_path: "private/receipt.pdf",
    bkr1_pix_deferred: false,
  });
  assert.equal(purchase.hasPaymentReceipt, true);
  assert.equal(purchase.canConfirmPayment, true);
  assert.equal(Object.hasOwn(purchase, "supplier_payment_receipt_path"), false);
});

test("bloqueia PIX BKR1 adiado no contrato móvel", () => {
  const purchase = mapMobilePurchase({
    id: "11111111-1111-4111-8111-111111111111",
    dsid: "1",
    supplier_payment_mode: "prepaid_pix",
    supplier_payment_status: "pending",
    bkr1_pix_deferred: true,
  });
  assert.equal(purchase.paymentDeferred, true);
  assert.equal(purchase.canConfirmPayment, false);
});

test("normaliza resumo de compras", () => {
  assert.deepEqual(mapMobilePurchasesSummary({ total: 10, pendentes: 3, faturado: 5, valor_total: 1200 }), {
    total: 10,
    pending: 3,
    invoiced: 5,
    waitingInformation: 0,
    cancelled: 0,
    review: 0,
    totalValue: 1200,
  });
});
