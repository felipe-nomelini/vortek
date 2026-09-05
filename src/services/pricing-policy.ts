import type {
  FinalPriceBand,
  FinalPriceCandidateCalculator,
  FinalPriceObjective,
  FinalPricePolicy,
  FinalPriceResolution,
} from '@/types/pricing';

/** Contrato M2M; não contém agenda, fallback, autonomia ou configuração de runtime. */
export const FINAL_PRICE_POLICY: FinalPricePolicy = Object.freeze({
  version: 'M2M-PRC-01-v1',
  bands: Object.freeze([
    Object.freeze({ id: 'UP_TO_200', maxCents: 20_000, floor: 0.05, target: 0.07, limit: 0.10 }),
    Object.freeze({ id: 'FROM_200_TO_1000', maxCents: 100_000, floor: 0.07, target: 0.10, limit: 0.15 }),
    Object.freeze({ id: 'ABOVE_1000', maxCents: null, floor: 0.10, target: 0.15, limit: 0.20 }),
  ] satisfies FinalPriceBand[]),
});

/** Limite técnico, não parâmetro comercial ou número de tentativas de API. */
export const FINAL_PRICE_MAX_ITERATIONS = 12;

export function isFinalPricePolicy(value: unknown): value is FinalPricePolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Partial<FinalPricePolicy>;
  if (typeof policy.version !== 'string' || !policy.version.trim()
    || !Array.isArray(policy.bands) || policy.bands.length !== 3) return false;

  // Fronteiras canônicas fixas. Assim não há lacunas, sobreposição ou faixa aberta intermediária.
  return Array.from(policy.bands).every((band: FinalPriceBand | null, index) => {
    const canonical = FINAL_PRICE_POLICY.bands[index];
    return band !== null && typeof band === 'object'
      && band.id === canonical.id && band.maxCents === canonical.maxCents
      && [band.floor, band.target, band.limit].every(rate => (
        typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1
      ))
      && band.floor <= band.target && band.target <= band.limit;
  });
}

function isPriceCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function getFinalPriceBand(
  priceCents: number,
  policy: FinalPricePolicy = FINAL_PRICE_POLICY,
): FinalPriceBand | null {
  if (!isPriceCents(priceCents) || !isFinalPricePolicy(policy)) return null;
  return policy.bands.find(band => band.maxCents === null || priceCents <= band.maxCents) ?? null;
}

/**
 * Resolve apenas o ponto fixo da faixa. O cálculo injetado deve ser puro, síncrono,
 * determinístico e retornar centavos já arredondados que cumpram a margem pedida.
 * Economia/fonte viva pertencem às ações seguintes; sucesso aqui NÃO autoriza publicação.
 * Não recebe preço vigente/performance: não pode transformar limite em comando de redução.
 */
export function resolveFinalPrice(input: {
  policy?: FinalPricePolicy;
  objective: FinalPriceObjective;
  calculateCandidate: FinalPriceCandidateCalculator;
}): FinalPriceResolution {
  const policy = input.policy === undefined ? FINAL_PRICE_POLICY : input.policy;
  if (!isFinalPricePolicy(policy)) return { ok: false, error: 'POLITICA_PRICING_INVALIDA', iterations: 0 };
  const objective = input.objective;
  if (!['floor', 'target', 'limit', 'break_even'].includes(objective)) {
    return { ok: false, error: 'OBJETIVO_PRICING_INVALIDO', iterations: 0 };
  }
  if (typeof input.calculateCandidate !== 'function') {
    return { ok: false, error: 'CALCULO_CANDIDATO_FALHOU', iterations: 0 };
  }

  // Snapshot privado: uma função chamadora não pode modificar a política durante a solução.
  const snapshot: FinalPricePolicy = Object.freeze({
    version: policy.version,
    bands: Object.freeze(policy.bands.map(band => Object.freeze({ ...band }))),
  });
  let iterations = 0;
  let best: { priceCents: number; band: FinalPriceBand } | null = null;

  for (const candidate of snapshot.bands) {
    let band = candidate;
    const visited = new Set<FinalPriceBand['id']>();
    for (let step = 0; step < FINAL_PRICE_MAX_ITERATIONS; step++) {
      if (visited.has(band.id)) break;
      visited.add(band.id);
      iterations++;
      let priceCents: number;
      try {
        priceCents = input.calculateCandidate(Object.freeze({
          band,
          objective,
          margin: objective === 'break_even' ? 0 : band[objective],
        }));
      } catch {
        // Não reproduzir mensagem arbitrária de callback nem inventar preço substituto.
        return { ok: false, error: 'CALCULO_CANDIDATO_FALHOU', iterations };
      }
      if (!isPriceCents(priceCents)) {
        return { ok: false, error: 'PRECO_CANDIDATO_INVALIDO', iterations };
      }
      const next = getFinalPriceBand(priceCents, snapshot)!;
      if (next.id === band.id) {
        if (best === null || priceCents < best.priceCents) best = { priceCents, band };
        break;
      }
      band = next;
    }
  }

  return best
    ? { ok: true, policyVersion: snapshot.version, objective, ...best, iterations }
    : { ok: false, error: 'PRECIFICACAO_NAO_CONVERGIU', iterations };
}
