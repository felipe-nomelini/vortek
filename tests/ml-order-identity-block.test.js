const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findMlOrderIdentityBlockMatches,
} = require("../src/lib/ml/order-identity-block.ts");

test("bloqueia pedido pelo ml_item_id mesmo com SKU local divergente", () => {
  assert.deepEqual(
    findMlOrderIdentityBlockMatches(
      [{ ml_item_id: "MLB1", seller_sku: "VTK2" }],
      [{ ml_item_id: "MLB1", sku: null }],
    ),
    [{ mlItemId: "MLB1", sellerSku: "VTK2", matchedBy: "ml_item_id" }],
  );
});

test("bloqueia pedido pelo SKU sem diferenciar maiúsculas e minúsculas", () => {
  assert.deepEqual(
    findMlOrderIdentityBlockMatches(
      [{ ml_item_id: "MLB2", seller_sku: "vtk3" }],
      [{ ml_item_id: null, sku: "VTK3" }],
    ),
    [{ mlItemId: "MLB2", sellerSku: "VTK3", matchedBy: "sku" }],
  );
});

test("libera pedido sem correspondência na blocklist", () => {
  assert.deepEqual(
    findMlOrderIdentityBlockMatches(
      [{ ml_item_id: "MLB4", seller_sku: "VTK4" }],
      [{ ml_item_id: "MLB5", sku: "VTK5" }],
    ),
    [],
  );
});
