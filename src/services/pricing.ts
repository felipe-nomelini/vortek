import type { PricingParams, PricingResult } from '@/types/pricing';
import { calculateNetProfitAtPrice } from './pricing-core.js';

export { calculateNetProfitAtPrice } from './pricing-core.js';

export const SIMPLES_COMMERCE_MIN_RATE = 0.04;
export const SIMPLES_COMMERCE_MANUAL_THRESHOLD = 3_600_000;

export type PricingMonthlyRevenue = {
  month: string;
  revenue: number;
};

export type PricingTaxContext = {
  appliedRate: number | null;
  estimatedRate: number | null;
  confirmedRate: number | null;
  rbt12: number | null;
  bracket: number | null;
  source: 'estimated' | 'confirmed' | 'protected' | 'unavailable';
  referenceMonth: string;
  manualRequired: boolean;
  warning: string | null;
};

const SIMPLES_COMMERCE_BRACKETS = [
  { ceiling: 180_000, nominalRate: 0.04, deduction: 0, number: 1 },
  { ceiling: 360_000, nominalRate: 0.073, deduction: 5_940, number: 2 },
  { ceiling: 720_000, nominalRate: 0.095, deduction: 13_860, number: 3 },
  { ceiling: 1_800_000, nominalRate: 0.107, deduction: 22_500, number: 4 },
  { ceiling: 3_600_000, nominalRate: 0.143, deduction: 87_300, number: 5 },
] as const;

export interface PricingStrategy {
  margin: number;
  minProfit: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthsBetween(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth();
}

function assertRate(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${label} deve estar entre 0% e menos de 100%`);
  }
}

export function calculateSimplesCommerceEffectiveTaxRate(rbt12: number): {
  rate: number | null;
  bracket: number | null;
  manualRequired: boolean;
} {
  if (!Number.isFinite(rbt12) || rbt12 < 0) {
    throw new Error('RBT12 inválida');
  }
  if (rbt12 > SIMPLES_COMMERCE_MANUAL_THRESHOLD) {
    return { rate: null, bracket: null, manualRequired: true };
  }

  const bracket = SIMPLES_COMMERCE_BRACKETS.find((candidate) => rbt12 <= candidate.ceiling)
    ?? SIMPLES_COMMERCE_BRACKETS[0];
  const rate = rbt12 === 0
    ? SIMPLES_COMMERCE_MIN_RATE
    : ((rbt12 * bracket.nominalRate) - bracket.deduction) / rbt12;
  return {
    rate: Math.max(SIMPLES_COMMERCE_MIN_RATE, rate),
    bracket: bracket.number,
    manualRequired: false,
  };
}

export function calculatePricingRbt12(input: {
  activityStartDate: string;
  referenceDate: string | Date;
  monthlyRevenue: PricingMonthlyRevenue[];
}): number {
  const activityStart = monthStart(new Date(`${input.activityStartDate}T00:00:00.000Z`));
  const reference = monthStart(new Date(input.referenceDate));
  const activityMonthIndex = monthsBetween(activityStart, reference);
  if (!Number.isFinite(activityMonthIndex) || activityMonthIndex < 0) {
    throw new Error('Data de referência anterior ao início da atividade');
  }

  const revenueByMonth = new Map(
    input.monthlyRevenue.map((row) => [String(row.month).slice(0, 7), Number(row.revenue || 0)]),
  );
  if (activityMonthIndex === 0) {
    return Math.max(0, revenueByMonth.get(monthKey(reference)) || 0) * 12;
  }
  if (activityMonthIndex <= 11) {
    let total = 0;
    for (let offset = 0; offset < activityMonthIndex; offset += 1) {
      total += Math.max(0, revenueByMonth.get(monthKey(addMonths(activityStart, offset))) || 0);
    }
    return (total / activityMonthIndex) * 12;
  }

  let total = 0;
  for (let offset = -12; offset < 0; offset += 1) {
    total += Math.max(0, revenueByMonth.get(monthKey(addMonths(reference, offset))) || 0);
  }
  return total;
}

export function buildPricingTaxContext(input: {
  activityStartDate: string;
  referenceDate: string | Date;
  monthlyRevenue: PricingMonthlyRevenue[];
  confirmedRate?: number | null;
}): PricingTaxContext {
  const reference = monthStart(new Date(input.referenceDate));
  const rbt12 = calculatePricingRbt12(input);
  const estimate = calculateSimplesCommerceEffectiveTaxRate(rbt12);
  const confirmedRate = input.confirmedRate == null ? null : Number(input.confirmedRate);
  if (confirmedRate !== null && (!Number.isFinite(confirmedRate) || confirmedRate < 0.04 || confirmedRate >= 1)) {
    throw new Error('Alíquota confirmada do PGDAS inválida');
  }

  if (estimate.manualRequired) {
    return {
      appliedRate: confirmedRate,
      estimatedRate: null,
      confirmedRate,
      rbt12,
      bracket: null,
      source: confirmedRate === null ? 'unavailable' : 'confirmed',
      referenceMonth: monthKey(reference),
      manualRequired: true,
      warning: confirmedRate === null
        ? 'RBT12 acima de R$ 3,6 milhões: informe a alíquota confirmada no PGDAS antes de calcular preços.'
        : 'RBT12 acima de R$ 3,6 milhões: usando exclusivamente a alíquota confirmada no PGDAS.',
    };
  }

  const estimatedRate = estimate.rate ?? SIMPLES_COMMERCE_MIN_RATE;
  const appliedRate = Math.max(estimatedRate, confirmedRate ?? SIMPLES_COMMERCE_MIN_RATE);
  return {
    appliedRate,
    estimatedRate,
    confirmedRate,
    rbt12,
    bracket: estimate.bracket,
    source: confirmedRate !== null && confirmedRate > estimatedRate ? 'protected' : 'estimated',
    referenceMonth: monthKey(reference),
    manualRequired: false,
    warning: confirmedRate === null
      ? 'Alíquota estimada para precificação; confirme o percentual apurado no PGDAS.'
      : null,
  };
}

export function getPricingStrategy(cost: number): PricingStrategy {
  if (cost <= 400) {
    return { margin: 0.15, minProfit: 20 };
  }
  if (cost <= 1000) {
    return { margin: 0.20, minProfit: 60 };
  }
  return { margin: 0.25, minProfit: 150 };
}

export function calculateBreakEvenPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  taxRate: number;
}): number {
  assertRate(params.taxRate, 'Alíquota de imposto');
  const denominator = 1 - (params.taxRate + params.mlFee);
  if (denominator <= 0) {
    throw new Error('A soma de imposto e taxa ML não pode ser igual ou superior a 100%');
  }
  return round2((params.cost + params.shipping) / denominator);
}

/** Calcula o preço pela margem líquida desejada sobre o preço final. */
export function calculateExactMarginPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  margin: number;
  fixedFee?: number;
  taxRate: number;
}): number {
  assertRate(params.taxRate, 'Alíquota de imposto');
  const fixedFee = params.fixedFee ?? 0;
  if (!Number.isFinite(fixedFee) || fixedFee < 0) {
    throw new Error('Tarifa fixa deve ser um valor não negativo');
  }
  const denominator = 1 - params.taxRate - params.mlFee - params.margin;
  if (denominator <= 0) {
    throw new Error('A soma de imposto, taxa ML e margem não pode ser igual ou superior a 100%');
  }
  return round2((params.cost + params.shipping + fixedFee) / denominator);
}

/** Calcula o preço necessário para preservar um lucro líquido nominal. */
export function calculateTargetNetProfitPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  targetNetProfit: number;
  fixedFee?: number;
  taxRate: number;
}): number {
  const taxRate = params.taxRate;
  const values = [
    params.cost,
    params.shipping,
    params.mlFee,
    params.targetNetProfit,
    params.fixedFee ?? 0,
    taxRate,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Dados inválidos para cálculo de lucro líquido alvo');
  }
  const denominator = 1 - taxRate - params.mlFee;
  if (denominator <= 0) {
    throw new Error('A soma de imposto e taxa ML deve ser inferior a 100%');
  }
  return round2(
    (params.cost + params.shipping + (params.fixedFee ?? 0) + params.targetNetProfit)
      / denominator,
  );
}

/**
 * Calcula preço sugerido usando estratégia Vortek atual.
 *
 * Regra padrão:
 * - até R$ 400 de custo: margem 15% + lucro mínimo R$ 20
 * - R$ 401 a R$ 1.000: margem 20% + lucro mínimo R$ 60
 * - R$ 1.001 a R$ 2.000+: margem 25% + lucro mínimo R$ 150
 *
 * Quando `margin` é informado explicitamente, ele sobrescreve margem da estratégia,
 * mas o piso de lucro mínimo por faixa continua valendo.
 */
export function calculateSuggestedPrice(params: PricingParams): PricingResult {
  const { cost, shipping, mlFee, taxRate } = params;
  assertRate(taxRate, 'Alíquota de imposto');
  const strategy = getPricingStrategy(cost);
  const margin = typeof params.margin === 'number' ? params.margin : strategy.margin;
  const denominator = 1 - (taxRate + mlFee);

  if (denominator <= 0) {
    throw new Error(
      'A soma de imposto e taxa ML não pode ser igual ou superior a 100%'
    );
  }

  const priceByMargin = (cost + shipping + (cost * margin)) / denominator;
  const priceByMinProfit = (cost + shipping + strategy.minProfit) / denominator;
  const suggestedPrice = Math.max(priceByMargin, priceByMinProfit);
  const tax = suggestedPrice * taxRate;
  const mlFeeAmount = suggestedPrice * mlFee;
  const netProfit = suggestedPrice - cost - shipping - tax - mlFeeAmount;

  return {
    suggestedPrice: round2(suggestedPrice),
    tax: round2(tax),
    mlFeeAmount: round2(mlFeeAmount),
    marginAmount: round2(netProfit),
    netProfit: round2(netProfit),
  };
}
