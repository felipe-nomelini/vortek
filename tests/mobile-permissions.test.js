const assert = require("node:assert/strict");
const test = require("node:test");

const {
  hasMobilePermission,
  mobilePermissionsForRole,
} = require("../src/lib/mobile-permissions.ts");

test("administrador e gerente podem confirmar pagamento", () => {
  assert.equal(hasMobilePermission("admin", "purchases.payment.confirm"), true);
  assert.equal(hasMobilePermission("gerente", "purchases.payment.confirm"), true);
});

test("operador executa fluxo, mas não confirma pagamento", () => {
  assert.equal(hasMobilePermission("operador", "sales.dslite.resume"), true);
  assert.equal(
    hasMobilePermission("operador", "sales.whatsapp_label.send"),
    true,
  );
  assert.equal(
    hasMobilePermission("operador", "purchases.payment.confirm"),
    false,
  );
});

test("visualizador permanece somente leitura", () => {
  assert.deepEqual(mobilePermissionsForRole("visualizador"), [
    "tv.read",
    "sales.read",
    "purchases.read",
    "sales.track",
  ]);
});

test("todos os cargos internos podem consultar vendas", () => {
  for (const role of ["admin", "gerente", "operador", "visualizador"]) {
    assert.equal(hasMobilePermission(role, "sales.read"), true);
  }
});
