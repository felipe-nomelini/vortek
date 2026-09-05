const PRICE_BANDS = Object.freeze([
  { id: 'BELOW_200', min: 0, max: 200, maxInclusive: true, target: 0.07, limit: 0.10 },
  { id: 'FROM_200_TO_1000', min: 200, max: 1000, maxInclusive: true, target: 0.10, limit: 0.15 },
  { id: 'ABOVE_1000', min: 1000, max: Infinity, maxInclusive: false, target: 0.15, limit: 0.20 },
]);

const EXCLUDED_REAL_LOSS_SKUS = new Set(['VTK012010', 'VTK012021', 'VTK012583', 'VTK012825', 'VTK022568']);
const CLEARANCE_SKUS = new Set(['VTK001008', 'VTK012762']);

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function priceBand(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 200) return PRICE_BANDS[0];
  if (value <= 1000) return PRICE_BANDS[1];
  return PRICE_BANDS[2];
}

function priceForMargin({ cost, shippingAmount, feeRate, fixedFee = 0, taxRate, marginRate }) {
  const denominator = 1 - Number(feeRate) - Number(taxRate) - Number(marginRate);
  if (!(denominator > 0)) return null;
  const value = (Number(cost) + Number(shippingAmount) + Number(fixedFee)) / denominator;
  return Number.isFinite(value) && value > 0 ? Math.ceil(value * 100) / 100 : null;
}

function stableTargetPrice(input) {
  let band = priceBand(input.currentPrice);
  if (!band) return { ok: false, reason: 'PRECO_ATUAL_INVALIDO' };
  let price = null;
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    price = priceForMargin({ ...input, marginRate: band.target });
    if (!price) return { ok: false, reason: 'CALCULO_FINANCEIRO_INVALIDO' };
    const nextBand = priceBand(price);
    if (!nextBand) return { ok: false, reason: 'FAIXA_FINAL_INVALIDA' };
    if (nextBand.id === band.id) {
      return { ok: true, price, band: band.id, targetMargin: band.target, iterations: iteration };
    }
    band = nextBand;
  }
  return { ok: false, reason: 'FAIXA_NAO_ESTABILIZADA' };
}

function unitEconomics({ price, cost, feeRate, fixedFee = 0, shippingAmount, taxRate }) {
  const feeAmount = (Number(price) * Number(feeRate)) + Number(fixedFee);
  const taxAmount = Number(price) * Number(taxRate);
  const result = Number(price) - Number(cost) - feeAmount - Number(shippingAmount) - taxAmount;
  if (![feeAmount, taxAmount, result].every(Number.isFinite)) return null;
  return {
    price: round(price),
    feeAmount: round(feeAmount),
    taxAmount: round(taxAmount),
    result: round(result),
    marginPct: round((result / Number(price)) * 100, 4),
  };
}

function resolvePreferredOffer(product, offers) {
  const valid = (offers || []).filter((offer) => offer?.ativo !== false && Number(offer?.custo || 0) > 0);
  if (product?.fornecedor_preferencial_manual === true) {
    const manual = valid.find((offer) => String(offer.id) === String(product.oferta_preferencial_id || ''));
    if (manual) return { offer: manual, source: 'manual' };
  }
  const withStock = valid.filter((offer) => Number(offer.estoque || 0) > 0);
  const candidates = withStock.length ? withStock : valid;
  const sorted = [...candidates].sort((left, right) => (
    Number(left.custo || 0) - Number(right.custo || 0)
    || Number(left.prioridade ?? 100) - Number(right.prioridade ?? 100)
    || Number(right.estoque || 0) - Number(left.estoque || 0)
    || String(left.id).localeCompare(String(right.id))
  ));
  return { offer: sorted[0] || null, source: 'automatic' };
}

function evaluateEligibility(row) {
  const reasons = [];
  const sku = String(row.sku || '').trim().toUpperCase();
  if (EXCLUDED_REAL_LOSS_SKUS.has(sku)) reasons.push('EXCLUIDO_PREJUIZO_MANUAL');
  if (CLEARANCE_SKUS.has(sku) || row.internalStockClearance) reasons.push('EXCLUIDO_LIQUIDACAO');
  if (row.currentMarginClassification !== 'MARGEM_SUPERIOR_AO_LIMITE_DE_BUSCA') reasons.push('SEM_MARGEM_PREMIUM_ATUAL');
  if (Number(row.visits150) > 5) reasons.push('EXCLUIDO_TRAFEGO_ACIMA_LIMITE');
  if (Number(row.orders150) >= 2) reasons.push('MARGEM_PREMIUM_PRESERVADA');
  if (row.productActive === false) reasons.push('EXCLUIDO_PRODUTO_INATIVO');
  if (!row.active || Number(row.stock) <= 0) reasons.push('EXCLUIDO_SEM_ESTOQUE_ATIVO');
  if (!row.currentData) reasons.push('EXCLUIDO_INCONCLUSIVO');
  if (row.hasPromotion) reasons.push('EXCLUIDO_PROMOCAO_ATIVA');
  if (row.hasQuantityPricing) reasons.push('EXCLUIDO_PRECO_QUANTIDADE');
  if (row.hasMlPriceAutomation) reasons.push('EXCLUIDO_AUTOMACAO_PRECO_ML');
  if (row.outboxProcessing) reasons.push('EXCLUIDO_OUTBOX_PROCESSANDO');
  if (!(Number(row.experimentalPrice) < Number(row.currentPrice))) reasons.push('SEM_REDUCAO_NECESSARIA');
  if (!(Number(row.experimentalResult) >= 0)) reasons.push('EXCLUIDO_PREJUIZO_CALCULADO');
  return { eligible: reasons.length === 0, reasons };
}

function checkpointClassification({ checkpoint, visits, orders }) {
  if (checkpoint === 'D7' && visits === 0) return 'OBSERVACAO_SEM_TRAFEGO';
  if (checkpoint === 'D15' && visits === 0) return 'ALERTA_AMARELO_SEM_TRAFEGO';
  if (checkpoint === 'D30') {
    if (visits === 0 || visits <= 5) return 'FALHA_DE_EXPOSICAO_PROVAVEL';
    if (orders === 0) return 'TRAFEGO_SEM_CONVERSAO';
    if (orders >= 2) return 'EXPERIMENTO_COM_SUCESSO_FORTE';
    return 'PRECO_RELEVANTE_PARA_PERFORMANCE';
  }
  return orders > 0 ? 'TRAFEGO_E_VENDA_OBSERVADOS' : 'MONITORAMENTO_NORMAL';
}

function groupWriteTargets(originMlItemId, mlItemIds) {
  const origin = String(originMlItemId || '');
  return [...new Set([origin, ...(mlItemIds || []).map(String)].filter(Boolean))];
}

module.exports = {
  CLEARANCE_SKUS,
  EXCLUDED_REAL_LOSS_SKUS,
  PRICE_BANDS,
  checkpointClassification,
  evaluateEligibility,
  groupWriteTargets,
  priceBand,
  priceForMargin,
  resolvePreferredOffer,
  round,
  stableTargetPrice,
  unitEconomics,
};
