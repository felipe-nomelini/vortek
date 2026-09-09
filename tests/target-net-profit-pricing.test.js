const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateTargetNetProfitPrice,
} = require('../src/services/pricing.ts');

test('lucro nominal não é mais um caminho comercial executável', () => {
  for (const targetNetProfit of [0, 20, 60, 150]) {
    assert.throws(() => calculateTargetNetProfitPrice({ cost: 50, shipping: 10, mlFee: .15,
      fixedFee: 6, targetNetProfit, taxRate: .04 }), /legada aposentada/);
  }
});
