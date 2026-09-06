/**
 * @param {{ price: number; cost: number; shipping: number; mlFee: number; taxRate: number }} params
 * @returns {never}
 */
export function calculateNetProfitAtPrice(params) {
  throw new Error('Cálculo legado aposentado; use a memória econômica canônica');
}

/** Aritmética única. A base deve ser explícita; não converte total de pedido em SKU.
 * @param {{basis:'sale_unit'|'order_total',revenueCents:number,costCents:number,feeCents:number,shippingCents:number,taxCents:number}} input
 * @returns {number|null}
 */
export function calculateEconomicTotalsCents(input) {
  if (!input || !['sale_unit', 'order_total'].includes(input.basis)) return null;
  const values = [input.revenueCents, input.costCents, input.feeCents, input.shippingCents, input.taxCents];
  if (!values.every(v => Number.isSafeInteger(v) && v >= 0)) return null;
  const total = values.slice(1).reduce((sum, v) => sum + BigInt(v), 0n);
  const result = BigInt(input.revenueCents) - total;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return total > max || result < -max || result > max ? null : Number(result);
}
