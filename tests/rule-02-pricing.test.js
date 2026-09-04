const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateNetProfitAtPrice,
  buildPricingTaxContext,
  calculateExactMarginPrice,
  calculatePricingRbt12,
  calculateSimplesCommerceEffectiveTaxRate,
  calculateSuggestedPrice,
} = require('../src/services/pricing.ts');

const COST_TIERS = [
  { position: 1, maxCost: 400, margin: 0.15, minProfit: 20 },
  { position: 2, maxCost: 1000, margin: 0.20, minProfit: 60 },
  { position: 3, maxCost: null, margin: 0.25, minProfit: 150 },
];

test('calcula as faixas efetivas do Anexo I até o limite automático', () => {
  assert.deepEqual(calculateSimplesCommerceEffectiveTaxRate(0), {
    rate: 0.04,
    bracket: 1,
    manualRequired: false,
  });
  assert.equal(calculateSimplesCommerceEffectiveTaxRate(180_000).rate, 0.04);
  assert.equal(calculateSimplesCommerceEffectiveTaxRate(240_000).rate, 0.04825);
  assert.equal(calculateSimplesCommerceEffectiveTaxRate(360_000).rate, 0.0565);
  assert.equal(calculateSimplesCommerceEffectiveTaxRate(720_000).rate, 0.07575);
  assert.equal(calculateSimplesCommerceEffectiveTaxRate(1_800_000).rate, 0.0945);
  assert.ok(Math.abs(calculateSimplesCommerceEffectiveTaxRate(3_600_000).rate - 0.11875) < 1e-12);
  assert.deepEqual(calculateSimplesCommerceEffectiveTaxRate(3_600_000.01), {
    rate: null,
    bracket: null,
    manualRequired: true,
  });
});

test('proporcionaliza a RBT12 nos doze primeiros meses e usa janela móvel no décimo terceiro', () => {
  const monthlyRevenue = [
    { month: '2026-03-01', revenue: 9_000 },
    { month: '2026-04-01', revenue: 40_000 },
    { month: '2026-05-01', revenue: 6_000 },
  ];
  assert.equal(calculatePricingRbt12({
    activityStartDate: '2026-03-23',
    referenceDate: '2026-03-30T12:00:00Z',
    monthlyRevenue,
  }), 108_000);
  assert.equal(calculatePricingRbt12({
    activityStartDate: '2026-03-23',
    referenceDate: '2026-05-15T12:00:00Z',
    monthlyRevenue,
  }), 294_000);

  const rollingRevenue = Array.from({ length: 13 }, (_, index) => ({
    month: new Date(Date.UTC(2026, 2 + index, 1)).toISOString().slice(0, 10),
    revenue: 10_000 + index,
  }));
  assert.equal(calculatePricingRbt12({
    activityStartDate: '2026-03-23',
    referenceDate: '2027-03-15T12:00:00Z',
    monthlyRevenue: rollingRevenue,
  }), rollingRevenue.slice(0, 12).reduce((sum, row) => sum + row.revenue, 0));
});

test('protege a projeção com a maior alíquota entre estimativa e PGDAS', () => {
  const context = buildPricingTaxContext({
    activityStartDate: '2026-03-23',
    referenceDate: '2026-05-15T12:00:00Z',
    monthlyRevenue: [
      { month: '2026-03-01', revenue: 20_000 },
      { month: '2026-04-01', revenue: 20_000 },
    ],
    confirmedRate: 0.055,
  });
  assert.equal(context.estimatedRate, 0.04825);
  assert.equal(context.appliedRate, 0.055);
  assert.equal(context.source, 'protected');
});

test('exige PGDAS acima do sublimite de cálculo automático', () => {
  const unavailable = buildPricingTaxContext({
    activityStartDate: '2024-01-01',
    referenceDate: '2026-05-15T12:00:00Z',
    monthlyRevenue: Array.from({ length: 12 }, (_, index) => ({
      month: new Date(Date.UTC(2025, 4 + index, 1)).toISOString().slice(0, 10),
      revenue: 310_000,
    })),
  });
  assert.equal(unavailable.appliedRate, null);
  assert.equal(unavailable.manualRequired, true);

  const confirmed = buildPricingTaxContext({
    activityStartDate: '2024-01-01',
    referenceDate: '2026-05-15T12:00:00Z',
    monthlyRevenue: Array.from({ length: 12 }, (_, index) => ({
      month: new Date(Date.UTC(2025, 4 + index, 1)).toISOString().slice(0, 10),
      revenue: 310_000,
    })),
    confirmedRate: 0.12,
  });
  assert.equal(confirmed.appliedRate, 0.12);
  assert.equal(confirmed.source, 'confirmed');
});

test('uma única alíquota explícita governa preço e lucro projetados', () => {
  const pricing = calculateSuggestedPrice({
    cost: 215,
    shipping: 44.05,
    mlFee: 0.16,
    taxRate: 0.05,
    costTiers: COST_TIERS,
  });
  assert.equal(calculateNetProfitAtPrice({
    price: pricing.suggestedPrice,
    cost: 215,
    shipping: 44.05,
    mlFee: 0.16,
    taxRate: 0.05,
  }), pricing.netProfit);
  assert.throws(() => calculateSuggestedPrice({
    cost: 10,
    shipping: 0,
    mlFee: 0.15,
    costTiers: COST_TIERS,
  }), /Alíquota/);
});

test('seleciona as faixas comerciais configuradas nos limites exatos', () => {
  const calculate = (cost) => calculateSuggestedPrice({
    cost,
    shipping: 0,
    mlFee: 0.15,
    taxRate: 0.04,
    costTiers: COST_TIERS,
  });

  assert.equal(calculate(400).netProfit, 60);
  assert.equal(calculate(400.01).netProfit, 80);
  assert.equal(calculate(1000).netProfit, 200);
  assert.equal(calculate(1000.01).netProfit, 250);

  const changedPolicy = COST_TIERS.map((tier) => ({ ...tier, minProfit: tier.minProfit + 10 }));
  assert.notEqual(
    calculateSuggestedPrice({ cost: 50, shipping: 0, mlFee: 0.15, taxRate: 0.04, costTiers: changedPolicy }).suggestedPrice,
    calculate(50).suggestedPrice,
  );
});

test('margem exata inclui tarifa fixa sem criar fórmula paralela', () => {
  assert.equal(calculateExactMarginPrice({
    cost: 100,
    shipping: 10,
    fixedFee: 5,
    mlFee: 0.15,
    margin: 0.20,
    taxRate: 0.05,
  }), 191.67);
});
