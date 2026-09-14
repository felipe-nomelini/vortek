export type ProtectiveZeroStockPauseInput = {
  desiredStatus: unknown;
  desiredQuantity: unknown;
  appliesPrice: boolean;
  appliesQuantityPricing?: boolean;
  appliesQuantity: boolean;
  appliesStatus: boolean;
};

/**
 * A pausa por capacidade segura zerada e uma operacao conservadora: ela nunca
 * pode ser impedida por bloqueios comerciais ou pelo estado ativo do produto.
 */
export function isProtectiveZeroStockPause(
  input: ProtectiveZeroStockPauseInput,
): boolean {
  const hasExplicitZeroQuantity = (typeof input.desiredQuantity === 'number'
    || typeof input.desiredQuantity === 'string')
    && String(input.desiredQuantity).trim() !== ''
    && Number(input.desiredQuantity) === 0;

  return String(input.desiredStatus || '').trim().toLowerCase() === 'pausado'
    && hasExplicitZeroQuantity
    && !input.appliesPrice
    && !input.appliesQuantityPricing
    && input.appliesQuantity
    && input.appliesStatus;
}

export function shouldSkipManuallyBlockedStockUpdate(input: {
  manuallyBlocked: boolean;
  desiredStatus: unknown;
  desiredQuantity: unknown;
}): boolean {
  return input.manuallyBlocked && !isProtectiveZeroStockPause({
    desiredStatus: input.desiredStatus,
    desiredQuantity: input.desiredQuantity,
    appliesPrice: false,
    appliesQuantityPricing: false,
    appliesQuantity: true,
    appliesStatus: true,
  });
}
