import type {
  EconomicComponent, EconomicEstimateReason, EconomicInput, EconomicIssue, EconomicMemory, EconomicProjectionInput,
  EconomicProjectionResult, EconomicResult,
} from '@/types/pricing';
import { FINAL_PRICE_POLICY, getFinalPriceBand, isFinalPricePolicy, resolveFinalPrice } from './pricing-policy';
import { SIMPLES_COMMERCE_MIN_RATE } from './pricing';
import { calculateEconomicTotalsCents } from './pricing-core.js';

const VERSION: EconomicMemory['version'] = 'VORTEK-CANON-1.0-ECON-2';
export const ECONOMIC_MAX_REFINEMENTS = 12;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const instant = (v: unknown): v is string => text(v)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const rate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;
const issue = (field: EconomicIssue['field'], code: EconomicIssue['code']): EconomicIssue => ({ field, code });
const inconclusive = (reasons: EconomicIssue[]): EconomicResult => ({ status: 'inconclusive', memory: null, reasons });

// A representação decimal da taxa é usada exatamente, sem erro binário no meio centavo.
function fraction(value: number): [bigint, bigint] {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, decimals = ''] = mantissa.split('.');
  const scale = decimals.length - Number(exponent);
  const numerator = BigInt(whole + decimals);
  return scale >= 0 ? [numerator, BigInt(10) ** BigInt(scale)]
    : [numerator * BigInt(10) ** BigInt(-scale), ONE];
}

function roundedRate(amount: number, value: number): number {
  const [n, d] = fraction(value);
  const rounded = (BigInt(amount) * n * TWO + d) / (d * TWO);
  return rounded <= MAX_CENTS ? Number(rounded) : NaN;
}

/** Tarifa percentual + fixa em centavos, usada pela projeção e pelos adaptadores. */
export function calculateEconomicFeeCents(priceCents: number, feeRate: number, fixedFeeCents: number): number {
  if (!cents(priceCents) || !rate(feeRate) || !cents(fixedFeeCents)) return NaN;
  const total = roundedRate(priceCents, feeRate) + fixedFeeCents;
  return cents(total) ? total : NaN;
}

/** Tributo calculado: fração positiva sobe ao centavo; valor exato não muda. */
function ceilRate(amount: number, value: number): number {
  const [n, d] = fraction(value);
  const rounded = (BigInt(amount) * n + d - ONE) / d;
  return rounded <= MAX_CENTS ? Number(rounded) : NaN;
}

/** Mesma regra tributária para a base unitária e a base total explícita. */
export function calculateEconomicTaxCents(amount: number, value: number): number | null {
  return cents(amount) && rate(value) && value >= SIMPLES_COMMERCE_MIN_RATE ? ceilRate(amount, value) : null;
}

function reachesMargin(resultCents: number, priceCents: number, margin: number): boolean {
  const [n, d] = fraction(margin);
  return BigInt(resultCents) * d >= BigInt(priceCents) * n;
}

/** Chaves ordenadas: identidade determinística dos dados, sem hash/relógio/estado externo. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function snapshotComponent(c: EconomicComponent): EconomicComponent {
  return { amountCents: c.amountCents, condition: c.condition, source: c.source,
    sourceId: c.sourceId, observedAt: c.observedAt, expiresAt: c.expiresAt, basis: c.basis,
    quantity: c.quantity, marketContextKey: c.marketContextKey, quotedPriceCents: c.quotedPriceCents,
    ...(c.composition ? { composition: { productId: c.composition.productId, offerId: c.composition.offerId,
      supplierId: c.composition.supplierId, quantity: c.composition.quantity, unitCostCents: c.composition.unitCostCents } } : {}) };
}

/** Avalia somente dados fornecidos. Suficiência econômica nunca autoriza uma escrita. */
export function evaluateEconomicMemory(input: EconomicInput): EconomicResult {
  if (!input || !cents(input.priceCents) || input.priceCents === 0 || !instant(input.evaluatedAt)
    || !['projected', 'realized', 'simulation'].includes(input.scenario) || typeof input.offerEligible !== 'boolean') {
    return inconclusive([issue('input', 'DADO_INVALIDO')]);
  }
  const policy = input.policy === undefined ? FINAL_PRICE_POLICY : input.policy;
  if (!isFinalPricePolicy(policy)) return inconclusive([issue('policy', 'POLITICA_PRICING_INVALIDA')]);
  const c = input.context;
  if (!c || c.currency !== 'BRL' || c.unit !== 'sale_unit' || !cents(c.quantity) || c.quantity === 0
    || (input.scenario === 'simulation' ? c.productId !== null : !text(c.productId)) || !text(c.marketContextKey) || !month(c.referenceMonth)
    || [c.offerId, c.supplierId, c.mlItemId, c.pricingGroupId].some(v => v !== null && !text(v))) {
    return inconclusive([issue('context', 'BASE_INCOMPATIVEL')]);
  }
  const errors: EconomicIssue[] = [];
  const composition = input.cost?.composition;
  if (composition && (input.scenario !== 'projected' || !text(composition.productId)
    || composition.productId === c.productId || !text(composition.offerId) || !text(composition.supplierId)
    || !cents(composition.quantity) || composition.quantity === 0 || !cents(composition.unitCostCents)
    || composition.unitCostCents === 0 || !Number.isSafeInteger(composition.unitCostCents * composition.quantity)
    || input.cost.amountCents !== composition.unitCostCents * composition.quantity
    || c.offerId !== null || c.supplierId !== null || input.cost.sourceId !== composition.offerId)) {
    errors.push(issue('cost', 'BASE_INCOMPATIVEL'));
  }
  if (input.scenario === 'simulation' && (c.offerId !== null || c.supplierId !== null
    || c.mlItemId !== null || c.pricingGroupId !== null || input.offerEligible)) errors.push(issue('context', 'BASE_INCOMPATIVEL'));
  if (input.scenario === 'projected' && (!input.offerEligible || (!composition && (!c.offerId || !c.supplierId)))) {
    errors.push(issue('cost', 'OFERTA_INELEGIVEL'));
  }
  const estimated: EconomicEstimateReason[] = [];
  for (const field of ['cost', 'fee', 'shipping'] as const) {
    const component = input[field];
    if (!component || component.amountCents === null || component.condition === 'missing') {
      errors.push(issue(field, 'DADO_AUSENTE')); continue;
    }
    if (!cents(component.amountCents) || !['known', 'estimated', 'stale'].includes(component.condition)
      || !['offer', 'historical', 'ml_live', 'ml_observed', 'fallback', 'simulation'].includes(component.source)
      || !text(component.sourceId) || !instant(component.observedAt)
      || Date.parse(component.observedAt) > Date.parse(input.evaluatedAt)
      || (component.expiresAt !== null && (!instant(component.expiresAt)
        || Date.parse(component.expiresAt) < Date.parse(component.observedAt)))
      || (component.quotedPriceCents !== null && (!cents(component.quotedPriceCents) || component.quotedPriceCents === 0))) {
      errors.push(issue(field, 'DADO_INVALIDO')); continue;
    }
    if (component.condition === 'stale' || (component.expiresAt !== null
      && Date.parse(component.expiresAt) <= Date.parse(input.evaluatedAt))) errors.push(issue(field, 'DADO_VENCIDO'));
    if (field !== 'cost' && component.composition) errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (input.scenario === 'simulation' && !['simulation', 'fallback'].includes(component.source)) errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (component.basis !== 'unit' || component.quantity !== c.quantity) errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (component.marketContextKey !== c.marketContextKey
      || (component.quotedPriceCents !== null && component.quotedPriceCents !== input.priceCents)
      || (input.scenario === 'projected' && field !== 'cost'
        && ['ml_live', 'ml_observed'].includes(component.source) && component.quotedPriceCents === null)) {
      errors.push(issue(field, 'COTACAO_INCOMPATIVEL'));
    }
    if (input.scenario === 'projected' && field === 'cost' && component.source !== 'offer') errors.push(issue(field, 'OFERTA_INELEGIVEL'));
    if (component.source === 'simulation' && input.scenario !== 'simulation') errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (input.scenario === 'simulation' && field === 'cost' && component.source !== 'simulation') errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (field === 'cost' && component.source === 'offer' && component.sourceId !== (composition?.offerId ?? c.offerId)) errors.push(issue(field, 'OFERTA_INELEGIVEL'));
    if (input.scenario === 'realized' && field === 'cost' && component.source !== 'historical') errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (field !== 'cost' && (component.source === 'offer'
      || (input.scenario === 'projected' && component.source === 'historical'))) errors.push(issue(field, 'BASE_INCOMPATIVEL'));
    if (component.condition === 'estimated' || ['fallback', 'simulation'].includes(component.source)) estimated.push(`${field}:estimated`);
  }
  const tax = input.tax;
  const tc = tax?.context;
  if (!tc || !instant(tax.observedAt) || Date.parse(tax.observedAt) > Date.parse(input.evaluatedAt)
    || !text(tax.sourceId) || !['complete', 'incomplete', 'unknown'].includes(tax.coverage)
    || !['estimated', 'protected', 'confirmed', 'unavailable'].includes(tc.source)
    || typeof tc.manualRequired !== 'boolean'
    || [tc.estimatedRate, tc.confirmedRate].some(v => v !== null && (!rate(v) || v < SIMPLES_COMMERCE_MIN_RATE))
    || (tc.rbt12 !== null && (typeof tc.rbt12 !== 'number' || !Number.isFinite(tc.rbt12) || tc.rbt12 < 0))
    || (tc.bracket !== null && (!Number.isSafeInteger(tc.bracket) || tc.bracket < 1 || tc.bracket > 5))) {
    return inconclusive([...errors, issue('tax', 'DADO_INVALIDO')]);
  }
  if (tc.referenceMonth !== c.referenceMonth) errors.push(issue('tax', 'COMPETENCIA_INCOMPATIVEL'));
  if (tc.appliedRate == null) errors.push(issue('tax', 'DADO_AUSENTE'));
  else if (!rate(tc.appliedRate) || tc.appliedRate < SIMPLES_COMMERCE_MIN_RATE) errors.push(issue('tax', 'DADO_INVALIDO'));
  if (['estimated', 'protected'].includes(tc.source)
    && (tc.estimatedRate === null || tc.appliedRate !== Math.max(tc.estimatedRate, tc.confirmedRate ?? SIMPLES_COMMERCE_MIN_RATE))) {
    errors.push(issue('tax', 'DADO_INVALIDO'));
  }
  const proof = tax.confirmation;
  if (proof !== null && (!proof || !month(proof.referenceMonth) || !text(proof.evidenceId)
    || !instant(proof.confirmedAt) || Date.parse(proof.confirmedAt) > Date.parse(input.evaluatedAt))) {
    return inconclusive([...errors, issue('tax', 'DADO_INVALIDO')]);
  }
  if (proof && proof.referenceMonth !== c.referenceMonth) errors.push(issue('tax', 'COMPETENCIA_INCOMPATIVEL'));
  const proven = !!proof && proof.referenceMonth === c.referenceMonth && text(proof.evidenceId)
    && instant(proof.confirmedAt) && Date.parse(proof.confirmedAt) <= Date.parse(input.evaluatedAt)
    && rate(tc.confirmedRate) && tc.confirmedRate >= SIMPLES_COMMERCE_MIN_RATE
    && tc.appliedRate === tc.confirmedRate;
  const taxConfirmed = tc.source === 'confirmed' && proven && tax.coverage === 'complete';
  if (tc.source === 'unavailable' || (tc.manualRequired && !taxConfirmed)) errors.push(issue('tax', 'PGDAS_NAO_COMPROVADO'));
  // Alíquota comprovada não transforma tributo calculado em montante realizado confirmado.
  const taxStatusConfirmed = taxConfirmed && (input.scenario === 'projected' || tax.realizedAmountCents !== null);
  if (!taxStatusConfirmed) estimated.push('tax:estimated');
  if (tax.coverage !== 'complete') estimated.push('tax:coverage_unconfirmed');
  if (tax.realizedAmountCents !== null && (input.scenario !== 'realized' || !cents(tax.realizedAmountCents))) {
    errors.push(issue('tax', 'DADO_INVALIDO'));
  }
  if (errors.length) return inconclusive(errors);
  const taxAmount = tax.realizedAmountCents ?? ceilRate(input.priceCents, tc.appliedRate!);
  const result = calculateEconomicTotalsCents({ basis: 'sale_unit', revenueCents: input.priceCents,
    costCents: input.cost.amountCents!, feeCents: input.fee.amountCents!, shippingCents: input.shipping.amountCents!, taxCents: taxAmount });
  if (result === null) return inconclusive([issue('input', 'PRECISAO_INSEGURA')]);
  const memory: Omit<EconomicMemory, 'fingerprint'> = {
    version: VERSION, scenario: input.scenario, evaluatedAt: input.evaluatedAt,
    context: { productId: c.productId, offerId: c.offerId, supplierId: c.supplierId, mlItemId: c.mlItemId,
      pricingGroupId: c.pricingGroupId, currency: c.currency, unit: c.unit, quantity: c.quantity,
      referenceMonth: c.referenceMonth, marketContextKey: c.marketContextKey },
    offerEligible: input.offerEligible, revenueCents: input.priceCents,
    cost: snapshotComponent(input.cost), fee: snapshotComponent(input.fee), shipping: snapshotComponent(input.shipping),
    tax: { context: { appliedRate: tc.appliedRate, estimatedRate: tc.estimatedRate, confirmedRate: tc.confirmedRate,
      rbt12: tc.rbt12, bracket: tc.bracket, source: tc.source, referenceMonth: tc.referenceMonth,
      manualRequired: tc.manualRequired, warning: null }, observedAt: tax.observedAt, sourceId: tax.sourceId,
      coverage: tax.coverage, confirmation: proof ? { referenceMonth: proof.referenceMonth,
        evidenceId: proof.evidenceId, confirmedAt: proof.confirmedAt } : null,
      realizedAmountCents: tax.realizedAmountCents, amountCents: taxAmount, status: taxStatusConfirmed ? 'confirmed' : 'estimated' },
    resultCents: Number(result), margin: Number(result) / input.priceCents,
    policyVersion: policy.version, band: { ...getFinalPriceBand(input.priceCents, policy)! },
  };
  return { status: estimated.length ? 'estimated' : 'available', reasons: estimated,
    memory: { ...memory, fingerprint: canonical(memory) } };
}

/** Só projeta modelo percentual/fixo declarado; aquisição/recotação ML pertence à PRC-04. */
export function projectEconomicPrice(input: EconomicProjectionInput): EconomicProjectionResult {
  const fail = (code: EconomicIssue['code']): EconomicProjectionResult => ({ ok: false, reasons: [issue('projection', code)] });
  const fm = input?.feeModel;
  if (!input?.base || !fm || fm.source !== 'fallback' || !rate(fm.rate) || !cents(fm.fixedFeeCents)) return fail('DADO_INVALIDO');
  if (!['floor', 'target', 'limit', 'break_even'].includes(input.objective)) return fail('OBJETIVO_PRICING_INVALIDO');
  const base = input.base;
  const evaluate = (priceCents: number): EconomicResult => evaluateEconomicMemory({ ...base, priceCents,
    scenario: base.scenario ?? 'projected', fee: { amountCents: calculateEconomicFeeCents(priceCents, fm.rate, fm.fixedFeeCents),
      condition: 'estimated', source: 'fallback', sourceId: fm.sourceId, observedAt: fm.observedAt,
      expiresAt: fm.expiresAt, basis: 'unit', quantity: base.context?.quantity,
      marketContextKey: base.context?.marketContextKey, quotedPriceCents: null } });
  // O preço inicial serve somente ao preflight; uma cotação vinculada não é extrapolável.
  if (base.shipping?.quotedPriceCents !== null || ['ml_live', 'ml_observed'].includes(base.shipping?.source)
    || base.cost?.quotedPriceCents !== null) return fail('COTACAO_INCOMPATIVEL');
  const preflight = evaluate(1);
  if (preflight.status === 'inconclusive') return { ok: false, reasons: preflight.reasons };
  const fixed = BigInt(base.cost.amountCents!) + BigInt(base.shipping.amountCents!) + BigInt(fm.fixedFeeCents);
  let failure: readonly EconomicIssue[] | null = null;
  const resolution = resolveFinalPrice({ policy: base.policy, objective: input.objective, calculateCandidate: ({ margin }) => {
    const fractions = [fm.rate, base.tax.context.appliedRate!, margin].map(fraction);
    const denominator = fractions.reduce((largest, [, d]) => d > largest ? d : largest, ONE);
    const remaining = denominator - fractions.reduce((sum, [n, d]) => sum + n * (denominator / d), ZERO);
    if (remaining <= ZERO) { failure = [issue('projection', 'DENOMINADOR_INVIAVEL')]; throw new Error('invalid'); }
    let candidate = (fixed * denominator + remaining - ONE) / remaining;
    if (candidate === ZERO) candidate = ONE;
    for (let step = 0; step < ECONOMIC_MAX_REFINEMENTS; step++) {
      if (candidate > MAX_CENTS) { failure = [issue('projection', 'PRECISAO_INSEGURA')]; throw new Error('invalid'); }
      const result = evaluate(Number(candidate));
      if (result.status === 'inconclusive') { failure = result.reasons; throw new Error('invalid'); }
      if (reachesMargin(result.memory.resultCents, Number(candidate), margin)) return Number(candidate);
      candidate += ONE;
    }
    failure = [issue('projection', 'PRECIFICACAO_NAO_CONVERGIU')]; throw new Error('invalid');
  } });
  if (!resolution.ok) return { ok: false, reasons: failure ?? [issue('projection',
    resolution.error === 'POLITICA_PRICING_INVALIDA' ? resolution.error : 'PRECIFICACAO_NAO_CONVERGIU')] };
  const evaluation = evaluate(resolution.priceCents);
  if (evaluation.status === 'inconclusive') return { ok: false, reasons: evaluation.reasons };
  return { ok: true, priceCents: resolution.priceCents, objective: input.objective, iterations: resolution.iterations, evaluation };
}
