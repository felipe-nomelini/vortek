const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractStrictVoltage,
  normalizeVoltageValue,
} = require("../src/lib/ml-voltage.ts");
const {
  assessMlListingIdentity: assessCanonicalIdentity,
  extractStrictProductDiameter,
  mergeMlAttributePrefill,
} = require("../src/lib/ml-listing-identity.ts");
const {
  applyProductFactsToMlAttribute,
  extractMlProductFacts,
} = require("../src/lib/ml-product-facts.ts");

function assessMlListingIdentity(item, expected) {
  const keys = { sellerSku: 'SELLER_SKU', gtin: 'GTIN', brand: 'BRAND', diameter: 'DIAMETER', voltage: 'VOLTAGE', packagesNumber: 'PACKAGES_NUMBER' };
  const proof = { source: 'product', reference: 'fixture', collectedAt: '2026-09-07T00:00:00.000Z', condition: 'valid' };
  const facts = Object.fromEntries(Object.entries(expected).map(([key, value]) => [keys[key], { value: String(value), evidence: [proof] }]));
  return assessCanonicalIdentity(item, facts, { categoryAttributes: Object.values(keys).map(id => ({ id })), remoteEvidence: { ...proof, source: 'mercado_livre' } });
}
function findMlListingIdentityConflicts(item, expected) {
  return assessMlListingIdentity(item, expected).comparisons.filter(row => row.status === 'CONFLITO_CONFIRMADO')
    .map(row => ({ field: row.field, expected: row.local, remote: row.remote }));
}

test("aceita tensão DC explícita como evidência crítica", () => {
  assert.equal(extractStrictVoltage("Alimentação 3 Vdc, bateria CR2450"), "3 Vdc");
  assert.equal(extractStrictVoltage("Fonte DC 12 V, 1 A"), "12 Vdc");
  assert.equal(extractStrictVoltage("Alimentação 5 Vdc via micro-USB"), "5 Vdc");
});

test("normaliza tensão DC sem convertê-la em tensão de rede", () => {
  assert.equal(normalizeVoltageValue("3 VDC"), "3 Vdc");
  assert.equal(normalizeVoltageValue("DC 12 V"), "12 Vdc");
});

test("preserva 120V sem declarar equivalência a 127V", () => {
  assert.equal(extractStrictVoltage("Alimentação: 120v"), "120V");
  assert.equal(extractStrictVoltage("Voltagem 120 V"), "120V");
  assert.equal(normalizeVoltageValue("120V"), "120V");
});

test("não deduz tensão DC a partir de uma bateria sem rótulo elétrico", () => {
  assert.equal(
    extractStrictVoltage("Bateria interna 3,7 V; dimensões 80 x 34 mm"),
    null,
  );
});

test("extrai 30 cm do nome sem confundir descrição logística ou hélice", () => {
  const product = {
    nome: "Ventilador de Coluna Ventisol Turbo 6 30cm Preto 127v",
    descricao: "Produto montado 40 x 40 x 116 cm. Medida da hélice 33 cm.",
  };
  const facts = extractMlProductFacts(product);
  assert.equal(extractStrictProductDiameter(product.nome), "30 cm");
  assert.equal(facts.diameter, "30 cm");
  assert.deepEqual(
    applyProductFactsToMlAttribute({ id: "DIAMETER", name: "Diâmetro" }, facts),
    { value_name: "30 cm" },
  );
});

test("bloqueia anúncio 50 cm quando produto comprovado é 30 cm", () => {
  const conflicts = findMlListingIdentityConflicts(
    {
      seller_custom_field: "VTK000456",
      attributes: [
        { id: "GTIN", value_name: "7898461967658" },
        { id: "BRAND", value_name: "Ventisol" },
        { id: "DIAMETER", value_name: "50 cm" },
        { id: "VOLTAGE", value_name: "127V" },
      ],
    },
    {
      sellerSku: "VTK000456",
      gtin: "7898461967658",
      brand: "VENTISOL",
      diameter: "30 cm",
      voltage: "127V",
    },
  );
  assert.deepEqual(conflicts, [
    { field: "DIAMETER", expected: "30 cm", remote: "50 cm" },
  ]);
});

test("aceita anúncio com identidade crítica equivalente", () => {
  const conflicts = findMlListingIdentityConflicts(
    {
      seller_custom_field: "VTK000456",
      attributes: [
        { id: "GTIN", value_name: "7898461967658" },
        { id: "BRAND", value_name: "Ventisol" },
        { id: "DIAMETER", value_name: "30 cm" },
        { id: "VOLTAGE", value_name: "127 V" },
      ],
    },
    {
      sellerSku: "VTK000456",
      gtin: "7898461967658",
      brand: "VENTISOL",
      diameter: "30cm",
      voltage: "127V",
    },
  );
  assert.deepEqual(conflicts, []);
});

test("marca contraditória não é reconciliada por SKU/GTIN coincidentes", () => {
  const assessment = assessMlListingIdentity(
    {
      seller_custom_field: "VTK009696",
      attributes: [
        { id: "GTIN", value_name: "7898705602659" },
        { id: "BRAND", value_name: "New York" },
      ],
    },
    {
      sellerSku: "VTK009696",
      gtin: "7898705602659",
      brand: "NY-F1RST",
    },
  );

  assert.equal(assessment.identity.status, 'CONFLITO_CONFIRMADO');
  assert.equal('canonicalBrand' in assessment, false);
});

test("não reconcilia marca quando o GTIN diverge", () => {
  const assessment = assessMlListingIdentity(
    {
      seller_custom_field: "VTK009696",
      attributes: [
        { id: "GTIN", value_name: "7898705600000" },
        { id: "BRAND", value_name: "New York" },
      ],
    },
    {
      sellerSku: "VTK009696",
      gtin: "7898705602659",
      brand: "NY-F1RST",
    },
  );

  assert.equal('canonicalBrand' in assessment, false);
  assert.deepEqual(
    assessment.comparisons.filter(row => row.status === 'CONFLITO_CONFIRMADO').map(row => row.field),
    ["GTIN", "BRAND"],
  );
});

test("não reconcilia marca sem SKU e GTIN remotos comprovados", () => {
  const assessment = assessMlListingIdentity(
    {
      attributes: [{ id: "BRAND", value_name: "New York" }],
    },
    {
      sellerSku: "VTK009696",
      gtin: "7898705602659",
      brand: "NY-F1RST",
    },
  );

  assert.equal('canonicalBrand' in assessment, false);
  assert.deepEqual(
    assessment.comparisons.filter(row => row.status === 'CONFLITO_CONFIRMADO').map(row => row.field),
    ["BRAND"],
  );
});

test("predição ML de 50 cm não sobrescreve evidência local de 30 cm", () => {
  assert.deepEqual(
    mergeMlAttributePrefill({
      prediction: { value_id: "124616", value_name: "50 cm" },
      ruleBased: { value_id: "124571", value_name: "30 cm" },
    }),
    { value_id: "124571", value_name: "30 cm" },
  );
});
