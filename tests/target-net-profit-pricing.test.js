const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/services/pricing.ts');
test('lucro nominal não é interface de pricing operacional', () => {
  assert.equal(pricing.calculateTargetNetProfitPrice, undefined);
});
test('preço novo depende do alvo da faixa final, nunca de lucro nominal', () => {
  const params = {cost:20,shipping:5,mlFee:.15,taxRate:.05};
  const normal=pricing.calculateSuggestedPrice(params);
  const legacy=pricing.calculateSuggestedPrice({...params,minProfit:150,margem_lucro:.3});
  assert.deepEqual(legacy,normal);
  assert.ok(normal.netProfit<20);
  assert.ok(normal.netProfit/normal.suggestedPrice>=pricing.priceBand(normal.suggestedPrice).target);
});
