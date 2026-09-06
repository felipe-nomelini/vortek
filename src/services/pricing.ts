import type { PricingParams, PricingResult } from '@/types/pricing';
import type { PricingCostTier } from '@/lib/commercial-pricing';

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

export function getPricingStrategy(cost: number, costTiers?: PricingCostTier[]): PricingStrategy {
  throw new Error('Política comercial legada aposentada; use pricing-economy');
}

export function calculateBreakEvenPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  taxRate: number;
}): number {
  throw new Error('Política comercial legada aposentada; use pricing-economy');
}

/** @deprecated Entrada histórica bloqueada; projeções pertencem a pricing-economy. */
export function calculateExactMarginPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  margin: number;
  fixedFee?: number;
  taxRate: number;
}): number {
  throw new Error('Política comercial legada aposentada; use pricing-economy');
}

/** @deprecated Lucro nominal não governa novas decisões comerciais. */
export function calculateTargetNetProfitPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
  targetNetProfit: number;
  fixedFee?: number;
  taxRate: number;
}): number {
  throw new Error('Política comercial legada aposentada; use pricing-economy');
}

/**
 * @deprecated Assinatura histórica preservada somente para falhar explicitamente.
 * A política atual usa preço final e a memória econômica de pricing-economy.
 */
export function calculateSuggestedPrice(params: PricingParams): PricingResult {
  throw new Error('Política comercial legada aposentada; use pricing-economy');
}
