export const BLOCKED_DROPSHIPPING_DSLITE_SUPPLIER_IDS = ['134'] as const;

const blockedSupplierIds = new Set<string>(
  BLOCKED_DROPSHIPPING_DSLITE_SUPPLIER_IDS,
);

export function isBlockedDropshippingDsliteSupplier(
  supplierId: unknown,
): boolean {
  return blockedSupplierIds.has(String(supplierId ?? '').trim());
}

export function filterAllowedDropshippingDsliteSupplierIds(
  supplierIds: Array<string | number>,
): string[] {
  return supplierIds
    .map((supplierId) => String(supplierId).trim())
    .filter(
      (supplierId) =>
        Boolean(supplierId) &&
        !isBlockedDropshippingDsliteSupplier(supplierId),
    );
}

type SupplierOfferMatch = {
  produto_id?: string | null;
  dslite_fornecedor_id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
};

type SupplierProductCandidate = {
  id?: string | null;
  ativo?: boolean | null;
};

/**
 * Resolve colisões de SKU entre filiais priorizando produto e oferta ativos.
 * Fornecedores sem dropshipping nunca participam da seleção.
 */
export function selectAllowedSupplierProductCandidate<
  T extends SupplierProductCandidate,
>(products: T[], offers: SupplierOfferMatch[]): T | null {
  const allowedOffers = offers.filter(
    (offer) =>
      !isBlockedDropshippingDsliteSupplier(offer.dslite_fornecedor_id),
  );
  const offersByProduct = new Map<string, SupplierOfferMatch[]>();

  for (const offer of allowedOffers) {
    const productId = String(offer.produto_id || '').trim();
    if (!productId) continue;
    const current = offersByProduct.get(productId) || [];
    current.push(offer);
    offersByProduct.set(productId, current);
  }

  const candidates = products.filter((product) =>
    offersByProduct.has(String(product.id || '').trim()),
  );

  return (
    [...candidates].sort((left, right) => {
      const leftOffers =
        offersByProduct.get(String(left.id || '').trim()) || [];
      const rightOffers =
        offersByProduct.get(String(right.id || '').trim()) || [];
      const leftActiveOffer = leftOffers.some((offer) => offer.ativo !== false);
      const rightActiveOffer = rightOffers.some(
        (offer) => offer.ativo !== false,
      );
      const leftStock = Math.max(
        0,
        ...leftOffers.map((offer) => Number(offer.estoque || 0)),
      );
      const rightStock = Math.max(
        0,
        ...rightOffers.map((offer) => Number(offer.estoque || 0)),
      );

      if ((left.ativo !== false) !== (right.ativo !== false)) {
        return left.ativo !== false ? -1 : 1;
      }
      if (leftActiveOffer !== rightActiveOffer) {
        return leftActiveOffer ? -1 : 1;
      }
      if (leftStock !== rightStock) return rightStock - leftStock;
      return String(left.id || '').localeCompare(String(right.id || ''));
    })[0] || null
  );
}
