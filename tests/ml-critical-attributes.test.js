const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractStrictVoltage,
  normalizeVoltageValue,
} = require("../src/lib/ml-voltage.ts");

test("aceita tensão DC explícita como evidência crítica", () => {
  assert.equal(extractStrictVoltage("Alimentação 3 Vdc, bateria CR2450"), "3 Vdc");
  assert.equal(extractStrictVoltage("Fonte DC 12 V, 1 A"), "12 Vdc");
  assert.equal(extractStrictVoltage("Alimentação 5 Vdc via micro-USB"), "5 Vdc");
});

test("normaliza tensão DC sem convertê-la em tensão de rede", () => {
  assert.equal(normalizeVoltageValue("3 VDC"), "3 Vdc");
  assert.equal(normalizeVoltageValue("DC 12 V"), "12 Vdc");
});

test("não deduz tensão DC a partir de uma bateria sem rótulo elétrico", () => {
  assert.equal(
    extractStrictVoltage("Bateria interna 3,7 V; dimensões 80 x 34 mm"),
    null,
  );
});
