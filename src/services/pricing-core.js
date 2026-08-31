/**
 * @param {{ price: number; cost: number; shipping: number; mlFee: number; taxRate: number }} params
 */
export function calculateNetProfitAtPrice(params) {
  if (!Number.isFinite(params.taxRate) || params.taxRate < 0 || params.taxRate >= 1) {
    throw new Error('Alíquota de imposto deve estar entre 0% e menos de 100%');
  }
  const tax = params.price * params.taxRate;
  const mlFeeAmount = params.price * params.mlFee;
  return Math.round((params.price - params.cost - params.shipping - tax - mlFeeAmount) * 100) / 100;
}
