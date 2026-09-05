const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkpointClassification,
  evaluateEligibility,
  groupWriteTargets,
  priceBand,
  stableTargetPrice,
} = require('../scripts/lib/ml-pricing-experiment');

test('faixas não têm lacunas nas fronteiras comerciais', () => {
  assert.equal(priceBand(200).id, 'BELOW_200');
  assert.equal(priceBand(200.01).id, 'FROM_200_TO_1000');
  assert.equal(priceBand(1000).id, 'FROM_200_TO_1000');
  assert.equal(priceBand(1000.01).id, 'ABOVE_1000');
});

test('preço alvo estabiliza novamente quando cruza de faixa', () => {
  const result = stableTargetPrice({
    currentPrice: 250,
    cost: 100,
    shippingAmount: 20,
    feeRate: 0.12,
    fixedFee: 0,
    taxRate: 0.082799,
  });
  assert.equal(result.ok, true);
  assert.equal(result.band, 'BELOW_200');
  assert.ok(result.price <= 200);
});

test('até 5 visitas entra e 6 visitas é excluído', () => {
  const base = {
    sku: 'VTK999999', currentMarginClassification: 'MARGEM_SUPERIOR_AO_LIMITE_DE_BUSCA',
    visits150: 5, orders150: 0, active: true, stock: 1, currentData: true,
    hasPromotion: false, hasQuantityPricing: false, hasMlPriceAutomation: false,
    outboxProcessing: false, experimentalPrice: 90, currentPrice: 100, experimentalResult: 5,
  };
  assert.equal(evaluateEligibility(base).eligible, true);
  assert.deepEqual(evaluateEligibility({ ...base, visits150: 6 }).reasons, ['EXCLUIDO_TRAFEGO_ACIMA_LIMITE']);
  assert.deepEqual(evaluateEligibility({ ...base, orders150: 2 }).reasons, ['MARGEM_PREMIUM_PRESERVADA']);
  assert.deepEqual(evaluateEligibility({ ...base, productActive: false }).reasons, ['EXCLUIDO_PRODUTO_INATIVO']);
});

test('promoção, atacado e automação do ML são travas independentes', () => {
  const base = {
    sku: 'VTK999999', currentMarginClassification: 'MARGEM_SUPERIOR_AO_LIMITE_DE_BUSCA',
    visits150: 0, orders150: 0, active: true, stock: 1, currentData: true,
    hasPromotion: true, hasQuantityPricing: true, hasMlPriceAutomation: true,
    outboxProcessing: false, experimentalPrice: 90, currentPrice: 100, experimentalResult: 5,
  };
  assert.deepEqual(evaluateEligibility(base).reasons, [
    'EXCLUIDO_PROMOCAO_ATIVA', 'EXCLUIDO_PRECO_QUANTIDADE', 'EXCLUIDO_AUTOMACAO_PRECO_ML',
  ]);
});

test('classificações dos checkpoints seguem a ordem operacional', () => {
  assert.equal(checkpointClassification({ checkpoint: 'D7', visits: 0, orders: 0 }), 'OBSERVACAO_SEM_TRAFEGO');
  assert.equal(checkpointClassification({ checkpoint: 'D15', visits: 0, orders: 0 }), 'ALERTA_AMARELO_SEM_TRAFEGO');
  assert.equal(checkpointClassification({ checkpoint: 'D30', visits: 0, orders: 0 }), 'FALHA_DE_EXPOSICAO_PROVAVEL');
  assert.equal(checkpointClassification({ checkpoint: 'D30', visits: 30, orders: 0 }), 'TRAFEGO_SEM_CONVERSAO');
  assert.equal(checkpointClassification({ checkpoint: 'D30', visits: 30, orders: 2 }), 'EXPERIMENTO_COM_SUCESSO_FORTE');
});

test('escrita do pricing group cobre origem e todos os espelhos uma única vez', () => {
  assert.deepEqual(
    groupWriteTargets('MLB-REGULAR', ['MLB-CATALOGO', 'MLB-REGULAR', 'MLB-CATALOGO']),
    ['MLB-REGULAR', 'MLB-CATALOGO'],
  );
});
