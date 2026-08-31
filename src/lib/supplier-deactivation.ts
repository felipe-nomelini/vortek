export type SupplierDeactivationProduct = {
  id: string;
  ativo?: boolean | null;
};

export function classifySupplierDeactivationProducts<T extends SupplierDeactivationProduct>(
  products: T[],
  alternativeProductIds: Set<string>,
  internalStockProductIds: Set<string>,
) {
  const withAlternative = products.filter((product) => alternativeProductIds.has(product.id));
  const withInternalStock = products.filter((product) => internalStockProductIds.has(product.id));
  const withAvailableSourceIds = new Set([
    ...withAlternative.map((product) => product.id),
    ...withInternalStock.map((product) => product.id),
  ]);
  const withoutAvailableSource = products.filter((product) => !withAvailableSourceIds.has(product.id));
  const activeWithoutAvailableSource = withoutAvailableSource.filter((product) => product.ativo !== false);

  return {
    withAlternative,
    withInternalStock,
    withAvailableSourceIds,
    withoutAvailableSource,
    activeWithoutAvailableSource,
  };
}

export function isActiveSupplierListingStatus(status: unknown): boolean {
  return String(status || '').trim().toLowerCase() === 'active';
}

export function supplierPauseOperationKey(productId: unknown, mlItemId: unknown): string {
  return `${String(productId || '').trim()}::${String(mlItemId || '').trim()}`;
}

export function shouldSkipExistingSupplierPause(status: unknown, reprocess: boolean): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  if (['pending', 'retry', 'processing'].includes(normalized)) return true;
  return reprocess && normalized === 'done';
}

export function isSafeInactiveSupplierPause(input: {
  source: unknown;
  desiredStatus: unknown;
  desiredQuantity: unknown;
  appliesPrice: boolean;
  appliesQuantity: boolean;
  appliesStatus: boolean;
}): boolean {
  return String(input.source || '').trim().toLowerCase() === 'fornecedor_inativo_pause'
    && String(input.desiredStatus || '').trim().toLowerCase() === 'pausado'
    && Number(input.desiredQuantity) === 0
    && !input.appliesPrice
    && input.appliesQuantity
    && input.appliesStatus;
}
