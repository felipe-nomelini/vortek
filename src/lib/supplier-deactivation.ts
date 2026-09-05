export type SupplierDeactivationProduct = {
  id: string;
  ativo?: boolean | null;
};

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
