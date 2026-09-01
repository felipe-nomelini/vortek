const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  hasPermission,
  permissionsForRole,
} = require("../src/lib/permissions.ts");

test("administrador e gerente podem confirmar pagamento", () => {
  assert.equal(hasPermission("admin", "purchases.payment.confirm"), true);
  assert.equal(hasPermission("gerente", "purchases.payment.confirm"), true);
});

test("gestão executa eventos fiscais e os demais perfis ficam em leitura", () => {
  for (const role of ["admin", "gerente"]) {
    assert.equal(hasPermission(role, "fiscal.read"), true);
    assert.equal(hasPermission(role, "fiscal.manage"), true);
  }
  for (const role of ["operador", "visualizador"]) {
    assert.equal(hasPermission(role, "fiscal.read"), true);
    assert.equal(hasPermission(role, "fiscal.manage"), false);
  }
});

test("operador executa fluxo, mas não confirma pagamento", () => {
  assert.equal(hasPermission("operador", "sales.dslite.resume"), true);
  assert.equal(hasPermission("operador", "sales.whatsapp_label.send"), true);
  assert.equal(hasPermission("operador", "purchases.payment.confirm"), false);
  for (const permission of [
    "sales.dslite.create",
    "sales.dslite.label.complete",
    "sales.dslite.shipping.select",
    "sales.internal_shipping.process",
  ]) {
    assert.equal(hasPermission("operador", permission), true);
  }
  assert.equal(hasPermission("operador", "sales.dslite.unlink"), false);
});

test("desvínculo corretivo fica restrito à gestão", () => {
  assert.equal(hasPermission("admin", "sales.dslite.unlink"), true);
  assert.equal(hasPermission("gerente", "sales.dslite.unlink"), true);
  assert.equal(hasPermission("visualizador", "sales.dslite.unlink"), false);
});

test("visualizador permanece somente leitura", () => {
  assert.deepEqual(permissionsForRole("visualizador"), [
    "tv.read",
    "sales.read",
    "purchases.read",
    "fiscal.read",
    "sales.track",
  ]);
});

test("todos os cargos internos podem consultar vendas", () => {
  for (const role of ["admin", "gerente", "operador", "visualizador"]) {
    assert.equal(hasPermission(role, "sales.read"), true);
  }
});

test("cookie web e Bearer convergem na mesma checagem de permissão", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/lib/api-request-auth.ts"),
    "utf8",
  );
  const profileLookupIndex = source.indexOf('.from("profiles")');
  const mobileRoleIndex = source.indexOf("role: auth.user.role");
  const webRoleIndex = source.indexOf("role: profile.cargo");
  const permissionCheckIndex = source.indexOf(
    "hasPermission(principal.role, permission)",
  );
  const successIndex = source.indexOf("source: principal.source");

  assert.ok(profileLookupIndex >= 0, "web precisa carregar profiles.cargo");
  assert.ok(mobileRoleIndex >= 0, "Bearer precisa fornecer o cargo validado");
  assert.ok(webRoleIndex >= 0, "cookie precisa fornecer o cargo do profile");
  assert.ok(permissionCheckIndex > mobileRoleIndex);
  assert.ok(permissionCheckIndex > webRoleIndex);
  assert.ok(successIndex > permissionCheckIndex);
  assert.equal(
    source.match(/hasPermission\(principal\.role, permission\)/g)?.length,
    1,
  );
});
