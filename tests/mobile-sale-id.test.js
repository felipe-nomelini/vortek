const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getMobileSaleSearchReference,
  isMobileSaleDatabaseId,
} = require("../src/lib/mobile-sale-id.ts");

test("identifica UUID interno da venda", () => {
  assert.equal(isMobileSaleDatabaseId("4527a8bf-04a5-4b5d-8d94-adf48c5d8043"), true);
  assert.equal(isMobileSaleDatabaseId("2000017800080064"), false);
});

test("traduz UUID interno para o número pesquisável da venda", () => {
  assert.equal(
    getMobileSaleSearchReference("4527a8bf-04a5-4b5d-8d94-adf48c5d8043", {
      numero: "2000017800080064",
      ml_order_id: "2000017800080064",
    }),
    "2000017800080064",
  );
});

test("preserva identificador quando não há referência operacional", () => {
  assert.equal(getMobileSaleSearchReference("2000017800080064", null), "2000017800080064");
});
