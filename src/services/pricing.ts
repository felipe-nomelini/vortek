import { PRICING_POLICY, priceBand, type PricingPolicy, type PriceBand } from './pricing-policy.ts';
import type { PricingTaxContext } from './pricing-tax.ts';
export { PRICING_POLICY, priceBand } from './pricing-policy.ts';

export const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const ceilMoney = (n: number): number => Math.ceil((n - 1e-9) * 100) / 100;
export type EconomicSource = 'ml_live' | 'ml_observed' | 'local' | 'fallback' | 'confirmed' | 'unknown';
export interface EconomicAmount {
  amount: number | null;
  source: EconomicSource;
  observedAt: string | null;
  evidence: string | null;
  contextKey?: string;
}
export interface EconomicInputs {
  price: number;
  cost: number | null;
  offerId: string | null;
  supplierId: string | null;
  costObservedAt: string | null;
  fee: EconomicAmount;
  shipping: EconomicAmount;
  variableCosts: EconomicAmount;
  tax: PricingTaxContext;
  evaluatedAt: string;
}
export interface EconomicMemory extends EconomicInputs {
  policyVersion: string;
  band: PriceBand | null;
  taxAmount: number | null;
  result: number | null;
  margin: number | null;
  status: 'available' | 'estimated' | 'inconclusive';
  reasons: string[];
  diagnostics: string[];
}

/** Aritmética compartilhada também pelo resultado realizado. Nenhuma fonte implícita. */
export function unitResult(input: {
  revenue: number; cost: number; fee: number; shipping: number; variableCosts: number; tax: number;
}): number | null {
  if (!Object.values(input).every(n => Number.isFinite(n) && n >= 0) || input.revenue <= 0) return null;
  return money(input.revenue - input.cost - input.fee - input.shipping - input.variableCosts - input.tax);
}

export function evaluateEconomics(input: EconomicInputs, policy: PricingPolicy = PRICING_POLICY): EconomicMemory {
  const band = priceBand(input.price, policy);
  const reasons: string[] = [];
  const required: Array<[string, number | null]> = [
    ['CUSTO', input.cost], ['TARIFA_ML', input.fee.amount], ['FRETE', input.shipping.amount], ['TRIBUTO', input.tax.rate],
  ];
  for (const [key, value] of required) {
    if (value === null || !Number.isFinite(value) || value < 0) reasons.push(`${key}_INDISPONIVEL`);
  }
  if (input.cost === 0) reasons.push('CUSTO_INVALIDO');
  if (!band || Math.abs(input.price*100-Math.round(input.price*100))>1e-6) reasons.push('PRECO_INVALIDO');
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) reasons.push('TIMESTAMP_AVALIACAO_INVALIDO');
  if (input.tax.rate !== null && input.tax.rate >= 1) reasons.push('TRIBUTO_INVALIDO');
  if (input.variableCosts.amount !== null && (!Number.isFinite(input.variableCosts.amount) || input.variableCosts.amount < 0)) reasons.push('CUSTOS_VARIAVEIS_INVALIDOS');
  const base = { ...input, policyVersion: policy.version, band, reasons, diagnostics: [] as string[] };
  if (reasons.length) return { ...base, taxAmount: null, result: null, margin: null, status: 'inconclusive' };
  if (input.variableCosts.amount === null) reasons.push('CUSTOS_VARIAVEIS_NAO_INFORMADOS');
  else if (input.variableCosts.source !== 'confirmed') reasons.push('CUSTOS_VARIAVEIS_ESTIMADOS');
  if (!input.costObservedAt || Date.parse(input.evaluatedAt)-Date.parse(input.costObservedAt)>policy.evidenceMaxAgeHours*3600000) reasons.push('CUSTO_DESATUALIZADO');
  if (input.tax.status !== 'confirmed') reasons.push('TRIBUTO_ESTIMADO');
  for (const [label, value] of [['TARIFA', input.fee], ['FRETE', input.shipping]] as const) {
    if (!['ml_live', 'ml_observed', 'confirmed'].includes(value.source)) reasons.push(`${label}_ESTIMADO`);
    if (!value.observedAt || !Number.isFinite(Date.parse(value.observedAt))
      || Date.parse(input.evaluatedAt) - Date.parse(value.observedAt) > policy.evidenceMaxAgeHours * 3600000) reasons.push(`${label}_DESATUALIZADO`);
  }
  const taxAmount = ceilMoney(input.price * input.tax.rate!);
  const result = unitResult({ revenue: input.price, cost: input.cost!, fee: input.fee.amount!, shipping: input.shipping.amount!, variableCosts: input.variableCosts.amount ?? 0, tax: taxAmount })!;
  const margin = result / input.price;
  if (result < 0) base.diagnostics.push(reasons.length ? 'PREJUIZO_ESTIMADO' : 'PREJUIZO_REAL');
  if (margin < band!.floor) base.diagnostics.push('MARGEM_ABAIXO_DO_PISO');
  if (margin > band!.limit) base.diagnostics.push('MARGEM_SUPERIOR_AO_LIMITE');
  return { ...base, taxAmount, result, margin, status: reasons.length ? 'estimated' : 'available' };
}

export interface PricingParams {
  cost: number; shipping: number; mlFee: number; taxRate: number;
  fixedFee?: number; variableCosts?: number; margin?: number;
}
export interface PricingResult {
  suggestedPrice: number; tax: number; mlFeeAmount: number; marginAmount: number; netProfit: number;
}

/** Inversão algébrica para proposta; confirmar pelo motor e pela cotação no preço final. */
export function calculateExactMarginPrice(params: PricingParams & { margin: number }): number {
  const values = [params.cost, params.shipping, params.mlFee, params.taxRate, params.margin, params.fixedFee ?? 0, params.variableCosts ?? 0];
  if (!values.every(n => Number.isFinite(n) && n >= 0) || params.cost <= 0) throw new Error('DADOS_ECONOMICOS_INVALIDOS');
  const denominator = 1 - params.mlFee - params.taxRate - params.margin;
  if (denominator <= 0) throw new Error('DENOMINADOR_ECONOMICO_INVALIDO');
  let price = ceilMoney((params.cost + params.shipping + (params.fixedFee ?? 0) + (params.variableCosts ?? 0)) / denominator);
  for (let i = 0; i < 3; i++) {
    if (calculateNetProfitAtPrice({ ...params, price }) / price + 1e-10 >= params.margin) return price;
    price = ceilMoney(price + 0.01 / denominator);
  }
  throw new Error('PRECIFICACAO_NAO_CONVERGIU');
}

export function calculateNetProfitAtPrice(params: PricingParams & { price: number }): number {
  if (!Number.isFinite(params.taxRate) || params.taxRate < 0 || params.taxRate >= 1) throw new Error('TRIBUTO_INDISPONIVEL');
  const result = unitResult({ revenue: params.price, cost: params.cost, fee: money(params.price * params.mlFee + (params.fixedFee ?? 0)), shipping: params.shipping, variableCosts: params.variableCosts ?? 0, tax: ceilMoney(params.price * params.taxRate) });
  if (result === null) throw new Error('DADOS_ECONOMICOS_INVALIDOS');
  return result;
}

export function calculateBreakEvenPrice(params: PricingParams): number {
  return calculateExactMarginPrice({ ...params, margin: 0 });
}

export function calculateSuggestedPrice(params: PricingParams, policy: PricingPolicy = PRICING_POLICY): PricingResult {
  const candidates = policy.bands.flatMap(candidate => {
    let band = candidate;
    const visited = new Set<string>();
    for (let i = 0; i < policy.maxIterations; i++) {
      if (visited.has(band.id)) return [];
      visited.add(band.id);
      const price = calculateExactMarginPrice({ ...params, margin: band.target });
      const next = priceBand(price, policy);
      if (!next) return [];
      if (next.id === band.id) return [price];
      band = next;
    }
    return [];
  });
  if (!candidates.length) throw new Error('PRECIFICACAO_NAO_CONVERGIU');
  const suggestedPrice = Math.min(...candidates);
  const netProfit = calculateNetProfitAtPrice({ ...params, price: suggestedPrice });
  return { suggestedPrice, netProfit, marginAmount: netProfit, tax: ceilMoney(suggestedPrice * params.taxRate), mlFeeAmount: money(suggestedPrice * params.mlFee + (params.fixedFee ?? 0)) };
}

/** Parâmetro nominal somente para estratégia explicitamente autorizada; não é piso. */
export function calculateTargetNetProfitPrice(params: PricingParams & { targetNetProfit: number }): number {
  if (!Number.isFinite(params.cost) || params.cost <= 0) throw new Error('DADOS_ECONOMICOS_INVALIDOS');
  if (!Number.isFinite(params.targetNetProfit) || params.targetNetProfit < 0) throw new Error('LUCRO_ALVO_INVALIDO');
  return calculateExactMarginPrice({ ...params, cost: params.cost + params.targetNetProfit, margin: 0 });
}

export type PriceObjective = 'floor' | 'target' | 'limit' | 'break_even';
export type QuotedPricingResult = { ok: true; memory: EconomicMemory; iterations: number }
  | { ok: false; reason: string; memories: EconomicMemory[] };

/** Reavalia tarifa e frete do preço efetivamente proposto, sem percentual inferido. */
export async function solveQuotedPrice(input: {
  cost: number; taxRate: number; initialPrice: number; objective: PriceObjective;
  quote: (price: number) => Promise<EconomicMemory>;
  policy?: PricingPolicy;
}): Promise<QuotedPricingResult> {
  const policy = input.policy ?? PRICING_POLICY;
  const memories: EconomicMemory[] = [];
  const stable: Array<{ memory: EconomicMemory; iterations: number }> = [];
  if (!Number.isFinite(input.cost) || input.cost <= 0 || !Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate >= 1) return { ok: false, reason: 'DADOS_ECONOMICOS_INVALIDOS', memories };
  const quotes = new Map<number, EconomicMemory>();
  for (const candidate of policy.bands) {
    let price = input.initialPrice > 0 ? input.initialPrice : input.cost;
    let band = candidate;
    const visited = new Set<string>();
    for (let iteration = 1; iteration <= policy.maxIterations; iteration++) {
      const memory = quotes.get(price) ?? await input.quote(price);
      quotes.set(price, memory);
      memories.push(memory);
      if (memory.result === null || !memory.band) return { ok: false, reason: memory.reasons[0] ?? 'ECONOMIA_INCONCLUSIVA', memories };
      const rate = input.objective === 'break_even' ? 0 : band[input.objective];
      const denominator = 1 - input.taxRate - rate;
      if (denominator <= 0) break;
      let next = ceilMoney((input.cost + memory.fee.amount! + memory.shipping.amount! + (memory.variableCosts.amount ?? 0)) / denominator);
      if (next === price && memory.margin! + 1e-10 < rate) next = money(price + 0.01);
      if (memory.band.id === band.id && memory.margin! + 1e-10 >= rate && Math.abs(next - price) < 0.011) {
        stable.push({ memory, iterations: iteration }); break;
      }
      const key = `${price}:${band.id}`;
      if (visited.has(key)) break;
      visited.add(key);
      price = Math.max(0.01, next);
      band = priceBand(price, policy)!;
    }
  }
  stable.sort((a, b) => a.memory.price - b.memory.price);
  return stable[0] ? { ok: true, ...stable[0] } : { ok: false, reason: 'PRECIFICACAO_NAO_CONVERGIU', memories };
}

export function commercialDiagnosis(memory: EconomicMemory, context: {
  sales: number | null; visits: number | null; completeWindow: boolean;
  strategy?: { kind: 'functional' | 'clearance'; author: string; reason: string; validUntil: string } | null;
}): string {
  if (memory.result === null || !memory.band) return 'INCONCLUSIVO';
  const strategy = context.strategy;
  const authorized = strategy && strategy.author && strategy.reason && Date.parse(strategy.validUntil) > Date.parse(memory.evaluatedAt);
  if (authorized && strategy.kind === 'clearance') return 'LIQUIDACAO_AUTORIZADA';
  if (memory.result < 0) return memory.status === 'available' ? 'PREJUIZO_REAL' : 'PREJUIZO_ESTIMADO';
  if (memory.margin! > memory.band.limit && context.sales !== null && context.sales > 0) return 'MARGEM_PREMIUM_VALIDADA_PELO_MERCADO';
  if (memory.margin! < memory.band.floor) {
    if (authorized && strategy.kind === 'functional') return 'MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL';
    if (context.completeWindow && context.sales === 0 && context.visits !== null && context.visits > 0) return 'MARGEM_BAIXA_SEM_RETORNO_COMERCIAL';
    return 'MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL';
  }
  return 'MARGEM_SUSTENTAVEL';
}
