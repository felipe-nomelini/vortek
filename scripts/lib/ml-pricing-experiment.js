const canonical = require('../../src/services/pricing.ts');
const { resolvePreferredOfferForProduct } = require('../../src/lib/preferred-offer.ts');
const PRICE_BANDS = canonical.PRICING_POLICY.bands;
const EXCLUDED_REAL_LOSS_SKUS = new Set(['VTK012010', 'VTK012021', 'VTK012583', 'VTK012825', 'VTK022568']);
const CLEARANCE_SKUS = new Set(['VTK001008', 'VTK012762']);

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

const priceBand = canonical.priceBand;
function priceForMargin({cost,shippingAmount,feeRate,fixedFee=0,taxRate,marginRate}) {
  try{return canonical.calculateExactMarginPrice({cost,shipping:shippingAmount,mlFee:feeRate,fixedFee,taxRate,margin:marginRate});}catch{return null;}
}
function stableTargetPrice(input){
  if(!priceBand(input.currentPrice))return {ok:false,reason:'PRECO_ATUAL_INVALIDO'};
  try{const result=canonical.calculateSuggestedPrice({cost:input.cost,shipping:input.shippingAmount,mlFee:input.feeRate,fixedFee:input.fixedFee??0,taxRate:input.taxRate});const band=priceBand(result.suggestedPrice);return{ok:true,price:result.suggestedPrice,band:band.id,targetMargin:band.target};}catch(error){return{ok:false,reason:error.message};}
}
function unitEconomics({price,cost,feeRate,fixedFee=0,shippingAmount,taxRate}){
 const feeAmount=canonical.money(price*feeRate+fixedFee),taxAmount=canonical.ceilMoney(price*taxRate);
 const result=canonical.unitResult({revenue:price,cost,fee:feeAmount,shipping:shippingAmount,tax:taxAmount,variableCosts:0});
 return result===null?null:{price:canonical.money(price),feeAmount,taxAmount,result,marginPct:round(result/price*100,4)};
}
function resolvePreferredOffer(product,offers){const offer=resolvePreferredOfferForProduct(offers,product?.oferta_preferencial_id,product?.fornecedor_preferencial_manual===true);return{offer,source:product?.fornecedor_preferencial_manual&&offer?.id===product.oferta_preferencial_id?'manual':'automatic'};}

function evaluateEligibility(row) {
  const reasons = [];
  const sku = String(row.sku || '').trim().toUpperCase();
  if (EXCLUDED_REAL_LOSS_SKUS.has(sku)) reasons.push('EXCLUIDO_PREJUIZO_MANUAL');
  if (CLEARANCE_SKUS.has(sku) || row.internalStockClearance) reasons.push('EXCLUIDO_LIQUIDACAO');
  if (row.currentMarginClassification !== 'MARGEM_SUPERIOR_AO_LIMITE_DE_BUSCA') reasons.push('SEM_MARGEM_PREMIUM_ATUAL');
  if (Number(row.visits150) > 5) reasons.push('EXCLUIDO_TRAFEGO_ACIMA_LIMITE');
  if (Number(row.orders150) > 0) reasons.push('MARGEM_PREMIUM_PRESERVADA');
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
