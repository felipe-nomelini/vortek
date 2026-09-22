type ProductMatch = { id: string; ativo?: boolean | null };
type ExistingOfferMatch = { produto_id: string; product?: { ativo?: boolean | null } | null };

export function resolveEvolusomOfferProduct(input: {
  existingOffer?: ExistingOfferMatch | null;
  supplierProduct?: ProductMatch | null;
  gtinProducts: ProductMatch[];
}): { productId: string | null; productActive: boolean; gtinConflict: boolean } {
  if (input.existingOffer?.produto_id) {
    return {
      productId: input.existingOffer.produto_id,
      productActive: input.existingOffer.product?.ativo !== false,
      gtinConflict: false,
    };
  }
  if (input.supplierProduct?.id) {
    return {
      productId: input.supplierProduct.id,
      productActive: input.supplierProduct.ativo !== false,
      gtinConflict: false,
    };
  }
  if (input.gtinProducts.length > 1) {
    return { productId: null, productActive: false, gtinConflict: true };
  }
  const product = input.gtinProducts[0];
  return {
    productId: product?.id || null,
    productActive: product?.ativo !== false,
    gtinConflict: false,
  };
}
