export type SupplierDeactivationProduct = {
  id: string;
  ativo?: boolean | null;
};

export function isActiveSupplierListingStatus(status: unknown): boolean {
  return String(status || '').trim().toLowerCase() === 'active';
}

export function isSafeInactiveSupplierPause(input: {
  source: unknown;
  desiredStatus: unknown;
  desiredQuantity: unknown;
  appliesPrice: boolean;
  appliesQuantityPricing: boolean;
  appliesQuantity: boolean;
  appliesStatus: boolean;
}): boolean {
  const hasExplicitZeroQuantity = (typeof input.desiredQuantity === 'number'
    || typeof input.desiredQuantity === 'string')
    && String(input.desiredQuantity).trim() !== ''
    && Number(input.desiredQuantity) === 0;

  return String(input.source || '').trim().toLowerCase() === 'fornecedor_inativo_pause'
    && String(input.desiredStatus || '').trim().toLowerCase() === 'pausado'
    && hasExplicitZeroQuantity
    && !input.appliesPrice
    && !input.appliesQuantityPricing
    && input.appliesQuantity
    && input.appliesStatus;
}

export function classifySupplierDeactivationProducts<T extends SupplierDeactivationProduct>(
  products: T[],
  alternativeProductIds: ReadonlySet<string>,
  internalStockProductIds: ReadonlySet<string>,
) {
  const withAlternative = products.filter((product) => alternativeProductIds.has(product.id));
  const withInternalStock = products.filter((product) => internalStockProductIds.has(product.id));
  const withAvailableSourceIds = new Set([
    ...withAlternative.map((product) => product.id),
    ...withInternalStock.map((product) => product.id),
  ]);
  const withoutAvailableSource = products.filter((product) => !withAvailableSourceIds.has(product.id));
  const keptOnlyByInternalStock = withInternalStock.filter((product) => (
    product.ativo !== false && !alternativeProductIds.has(product.id)
  ));

  return {
    withAlternative,
    withInternalStock,
    keptOnlyByInternalStock,
    withoutAvailableSource,
  };
}
