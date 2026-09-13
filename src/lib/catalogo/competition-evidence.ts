export type CompetitionEvidence = {
  itemId: string;
  catalogProductId: string | null;
  observedAt: string;
  condition: 'valid' | 'unavailable' | 'inconsistent' | 'stale';
  priceCents: number | null;
  currentPriceCents: number | null;
  status: string | null;
};

/** Apenas price_to_win documentado é referência; toda a identidade da resposta é confrontada. */
export function competitionEvidence(payload: any, expected: {
  itemId: string; catalogProductId: string | null; currentPriceCents: number;
}, observedAt: string, ok = true): CompetitionEvidence {
  const cents = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
    && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null;
  const valid = ok && payload?.item_id === expected.itemId && payload?.currency_id === 'BRL'
    && payload?.catalog_product_id === expected.catalogProductId && payload?.consistent === true
    && cents(payload?.current_price) === expected.currentPriceCents
    && ['winning', 'sharing_first_place', 'competing', 'listed'].includes(payload?.status);
  return { itemId: expected.itemId, catalogProductId: expected.catalogProductId, observedAt,
    condition: !ok ? 'unavailable' : valid ? 'valid' : 'inconsistent',
    priceCents: valid ? cents(payload?.price_to_win) : null,
    currentPriceCents: valid ? cents(payload?.current_price) : null,
    status: typeof payload?.status === 'string' ? payload.status : null };
}

export function validatedCatalogCompetition(payload: any, item: any, observedAt: string, ok = true): {
  evidence: CompetitionEvidence;
  payload: { status: string | null; price_to_win: number | null } | null;
} {
  const currentPrice = typeof item?.price === 'number' && Number.isFinite(item.price) && item.price > 0
    ? Math.round(item.price * 100) : null;
  const itemId = String(item?.id || '');
  const catalogProductId = /^MLB\d+$/.test(String(item?.catalog_product_id || ''))
    ? String(item.catalog_product_id) : null;
  const evidence = currentPrice === null || !/^MLB\d+$/.test(itemId)
    ? { itemId, catalogProductId, observedAt, condition: ok ? 'inconsistent' as const : 'unavailable' as const,
      priceCents: null, currentPriceCents: null, status: typeof payload?.status === 'string' ? payload.status : null }
    : competitionEvidence(payload, { itemId, catalogProductId, currentPriceCents: currentPrice }, observedAt, ok);
  return { evidence, payload: evidence.condition === 'valid'
    ? { status: evidence.status, price_to_win: evidence.priceCents === null ? null : evidence.priceCents / 100 }
    : null };
}
