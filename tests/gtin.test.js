const assert = require("node:assert/strict");
const test = require("node:test");

const { isValidGtin, normalizeGtin } = require("../src/lib/gtin.ts");

test("normaliza espaços e hífens do GTIN", () => {
  assert.equal(normalizeGtin("7897 6438-4856 3"), "7897643848563");
});

test("aceita GTIN GS1 com dígito verificador válido", () => {
  assert.equal(isValidGtin("7897643848563"), true);
});

test("rejeita GTIN com dígito verificador inválido", () => {
  assert.equal(isValidGtin("7897643848564"), false);
});

test("rejeita tamanho que não corresponde a GTIN GS1", () => {
  assert.equal(isValidGtin("1234567890"), false);
});
