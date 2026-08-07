const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMobileSalesFilteredSummary,
  hasMobileSalesAdvancedFilters,
  matchesMobileSalesAdvancedFilters,
} = require("../src/lib/mobile-sales-filters.ts");

const baseOrder = {
  fornecedor_nome: "Evolusom Comercial Ltda",
  dslite_label_operational_status: "real_sent",
  whatsapp_label_status: "sent",
  situacao: "preparando",
  operational_total: 100,
  operational_lucro: 20,
};

test("detecta filtros avançados preenchidos", () => {
  assert.equal(hasMobileSalesAdvancedFilters({}), false);
  assert.equal(hasMobileSalesAdvancedFilters({ supplier: "  " }), false);
  assert.equal(hasMobileSalesAdvancedFilters({ supplier: "Evolusom" }), true);
  assert.equal(hasMobileSalesAdvancedFilters({ whatsappLabel: "failed" }), true);
});

test("filtra fornecedor sem diferenciar acento ou caixa", () => {
  assert.equal(matchesMobileSalesAdvancedFilters(baseOrder, { supplier: "evolusóm" }), true);
  assert.equal(matchesMobileSalesAdvancedFilters(baseOrder, { supplier: "BKR1" }), false);
});

test("filtra estados exatos das etiquetas", () => {
  assert.equal(matchesMobileSalesAdvancedFilters(baseOrder, {
    dsliteLabel: "real_sent",
    whatsappLabel: "sent",
  }), true);
  assert.equal(matchesMobileSalesAdvancedFilters(baseOrder, { dsliteLabel: "pending" }), false);
  assert.equal(matchesMobileSalesAdvancedFilters(baseOrder, { whatsappLabel: "on_hold" }), false);
});

test("resumo exclui cancelada dos valores, mas mantém contagem", () => {
  const summary = buildMobileSalesFilteredSummary(
    [
      baseOrder,
      { ...baseOrder, situacao: "cancelado", operational_total: 500, operational_lucro: 100 },
    ],
    (row) => row.situacao === "preparando",
  );
  assert.equal(summary.count, 2);
  assert.equal(summary.total, 100);
  assert.equal(summary.lucroSum, 20);
  assert.equal(summary.ticket, 100);
  assert.equal(summary.margem, 20);
  assert.equal(summary.urgentCount, 1);
});
