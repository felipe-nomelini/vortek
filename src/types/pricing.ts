import type { PricingCostTier } from '@/lib/commercial-pricing';

export interface PricingParams {
  cost: number;
  shipping: number;
  mlFee: number;
  taxRate: number;
  costTiers?: PricingCostTier[];
  margin?: number;
}

export interface PricingResult {
  suggestedPrice: number;
  tax: number;
  mlFeeAmount: number;
  marginAmount: number;
  netProfit: number;
}

/** M2M-PRC-01: centavos BRL e margens sobre receita, nunca markup sobre custo. */
export type FinalPriceBandId = 'UP_TO_200' | 'FROM_200_TO_1000' | 'ABOVE_1000';
export type FinalPriceObjective = 'floor' | 'target' | 'limit' | 'break_even';

export type FinalPriceBand = Readonly<{
  id: FinalPriceBandId;
  maxCents: number | null;
  floor: number;
  target: number;
  limit: number;
}>;

export type FinalPricePolicy = Readonly<{
  version: string;
  bands: readonly FinalPriceBand[];
}>;

export type FinalPriceCandidateCalculator = (input: Readonly<{
  band: FinalPriceBand;
  objective: FinalPriceObjective;
  margin: number;
}>) => number;

export type FinalPriceResolution =
  | {
    ok: true;
    policyVersion: string;
    objective: FinalPriceObjective;
    priceCents: number;
    band: FinalPriceBand;
    /** Total de cálculos executados, considerando todas as faixas candidatas. */
    iterations: number;
  }
  | {
    ok: false;
    error: 'POLITICA_PRICING_INVALIDA' | 'OBJETIVO_PRICING_INVALIDO'
      | 'PRECO_CANDIDATO_INVALIDO' | 'CALCULO_CANDIDATO_FALHOU'
      | 'PRECIFICACAO_NAO_CONVERGIU';
    iterations: number;
  };

/** PRC-02: todos os montantes são por unidade vendida, nunca totais do pedido. */
export type EconomicContext = Readonly<{
  productId: string | null;
  offerId: string | null;
  supplierId: string | null;
  mlItemId: string | null;
  pricingGroupId: string | null;
  currency: 'BRL';
  unit: 'sale_unit';
  /** Quantidade do cenário de cotação; NÃO multiplica os montantes unitários. */
  quantity: number;
  referenceMonth: string;
  /** Identidade do cenário ML (conta/categoria/tipo/logística), resolvida pelo chamador. */
  marketContextKey: string;
}>;

export type EconomicComponent = Readonly<{
  amountCents: number | null;
  condition: 'known' | 'estimated' | 'missing' | 'invalid' | 'stale';
  source: 'offer' | 'historical' | 'ml_live' | 'ml_observed' | 'fallback' | 'simulation';
  sourceId: string;
  observedAt: string;
  expiresAt: string | null;
  basis: 'unit';
  quantity: number;
  marketContextKey: string;
  /** Obrigatório para cotação ML projetada; não inferir percentual a partir do total. */
  quotedPriceCents: number | null;
  /** CMV do kit simples: oferta real do componente, sem oferta fictícia do pai. */
  composition?: Readonly<{ productId: string; offerId: string; supplierId: string;
    quantity: number; unitCostCents: number }>;
}>;

export type EconomicTax = Readonly<{
  context: import('@/services/pricing').PricingTaxContext;
  observedAt: string;
  sourceId: string;
  coverage: 'complete' | 'incomplete' | 'unknown';
  confirmation: Readonly<{ referenceMonth: string; evidenceId: string; confirmedAt: string }> | null;
  /** Somente cenário realizado; nunca reescrever documento fiscal com uma projeção. */
  realizedAmountCents: number | null;
}>;

export type EconomicInput = Readonly<{
  priceCents: number;
  scenario: 'projected' | 'realized' | 'simulation';
  evaluatedAt: string;
  context: EconomicContext;
  offerEligible: boolean;
  cost: EconomicComponent;
  fee: EconomicComponent;
  shipping: EconomicComponent;
  tax: EconomicTax;
  policy?: FinalPricePolicy;
}>;

export type EconomicIssue = Readonly<{
  field: 'input' | 'context' | 'cost' | 'fee' | 'shipping' | 'tax' | 'policy' | 'projection';
  code: 'DADO_INVALIDO' | 'DADO_AUSENTE' | 'DADO_VENCIDO' | 'BASE_INCOMPATIVEL'
    | 'COTACAO_INCOMPATIVEL' | 'OFERTA_INELEGIVEL' | 'COMPETENCIA_INCOMPATIVEL'
    | 'PGDAS_NAO_COMPROVADO' | 'PRECISAO_INSEGURA' | 'DENOMINADOR_INVIAVEL'
    | 'POLITICA_PRICING_INVALIDA' | 'OBJETIVO_PRICING_INVALIDO' | 'PRECIFICACAO_NAO_CONVERGIU';
}>;

export type EconomicMemory = Readonly<{
  version: 'VORTEK-CANON-1.0-ECON-2';
  scenario: EconomicInput['scenario'];
  evaluatedAt: string;
  context: EconomicContext;
  offerEligible: boolean;
  revenueCents: number;
  cost: EconomicComponent;
  fee: EconomicComponent;
  shipping: EconomicComponent;
  tax: EconomicTax & Readonly<{ amountCents: number; status: 'estimated' | 'confirmed' }>;
  resultCents: number;
  /** Fração sobre receita; apresentação não deve ser usada para decidir fronteiras. */
  margin: number;
  policyVersion: string;
  band: FinalPriceBand;
  /** Serialização canônica, não assinatura de segurança/autorização. */
  fingerprint: string;
}>;

export type EconomicEstimateReason = 'cost:estimated' | 'fee:estimated' | 'shipping:estimated'
  | 'tax:estimated' | 'tax:coverage_unconfirmed';

export type EconomicResult =
  | { status: 'available' | 'estimated'; memory: EconomicMemory; reasons: readonly EconomicEstimateReason[] }
  | { status: 'inconclusive'; memory: null; reasons: readonly EconomicIssue[] };

/** Modelo explícito de fallback; não aceita tarifa observada como percentual presumido. */
export type EconomicProjectionInput = Readonly<{
  base: Omit<EconomicInput, 'priceCents' | 'scenario' | 'fee'> & { scenario?: 'projected' | 'simulation' };
  feeModel: Readonly<{
    source: 'fallback';
    sourceId: string;
    observedAt: string;
    expiresAt: string | null;
    rate: number;
    fixedFeeCents: number;
  }>;
  objective: FinalPriceObjective;
}>;

export type EconomicProjectionResult =
  | { ok: true; priceCents: number; objective: FinalPriceObjective;
    iterations: number; evaluation: Exclude<EconomicResult, { status: 'inconclusive' }> }
  | { ok: false; reasons: readonly EconomicIssue[] };
