export const DSLITE_LABEL_FORM_FIELD = 'etiqueta';

export function isDsliteCarrierAlreadyConfigured(
  currentCarrierId: unknown,
  expectedCarrierId: string | number,
): boolean {
  const current = String(currentCarrierId ?? '').trim();
  const expected = String(expectedCarrierId).trim();
  return current.length > 0 && current === expected;
}
