type ServiceClientLike = { from: (table: string) => any };

export type OperationalSupplierState = {
  dslite_id?: string | number | null;
  ativo?: boolean | null;
  status_dslite?: string | null;
  dropshipping?: string | null;
  dropshipping_retired_at?: string | null;
};

export const RETIRED_DROPSHIPPING_SUPPLIER_IDS = new Set(['2']);

function isActiveState(value: unknown): boolean {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'ativo';
}

export function isOperationalDropshippingSupplier(
  supplier: OperationalSupplierState | null | undefined,
): boolean {
  const dsliteId = String(supplier?.dslite_id ?? '').trim();
  return supplier?.ativo === true
    && Boolean(dsliteId)
    && !RETIRED_DROPSHIPPING_SUPPLIER_IDS.has(dsliteId)
    && !supplier.dropshipping_retired_at
    && isActiveState(supplier.status_dslite)
    && isActiveState(supplier.dropshipping);
}

export function isRetiredDropshippingSupplier(
  supplier: Pick<OperationalSupplierState, 'dropshipping_retired_at'> | null | undefined,
): boolean {
  return Boolean(supplier?.dropshipping_retired_at);
}

export async function loadOperationalDropshippingSupplierIds(
  client: ServiceClientLike,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('fornecedores')
    .select('dslite_id,ativo,status_dslite,dropshipping,dropshipping_retired_at')
    .eq('ativo', true)
    .is('dropshipping_retired_at', null)
    .not('dslite_id', 'is', null);
  if (error) throw new Error(error.message);
  return new Set(
    (data || [])
      .filter((supplier: OperationalSupplierState) => isOperationalDropshippingSupplier(supplier))
      .map((supplier: any) => String(supplier.dslite_id || '').trim())
      .filter(Boolean),
  );
}

export function filterOperationalDropshippingDsliteSupplierIds(
  supplierIds: Array<string | number>,
  operationalSupplierIds: ReadonlySet<string>,
): string[] {
  return supplierIds
    .map((supplierId) => String(supplierId).trim())
    .filter((supplierId) => Boolean(supplierId) && operationalSupplierIds.has(supplierId));
}

type DropshippingSupplierOffer = { dslite_fornecedor_id?: unknown };

export function filterOperationalDropshippingSupplierOffers<
  T extends DropshippingSupplierOffer,
>(offers: T[], operationalSupplierIds: ReadonlySet<string>): T[] {
  return offers.filter((offer) => (
    operationalSupplierIds.has(String(offer.dslite_fornecedor_id ?? '').trim())
  ));
}

type SupplierOfferMatch = {
  produto_id?: string | null;
  dslite_fornecedor_id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
};

type SupplierProductCandidate = { id?: string | null; ativo?: boolean | null };

/** Resolve colisões de SKU apenas entre fornecedores operacionais. */
export function selectOperationalSupplierProductCandidate<
  T extends SupplierProductCandidate,
>(
  products: T[],
  offers: SupplierOfferMatch[],
  operationalSupplierIds: ReadonlySet<string>,
): T | null {
  const allowedOffers = filterOperationalDropshippingSupplierOffers(
    offers,
    operationalSupplierIds,
  );
  const offersByProduct = new Map<string, SupplierOfferMatch[]>();

  for (const offer of allowedOffers) {
    const productId = String(offer.produto_id || '').trim();
    if (!productId) continue;
    const current = offersByProduct.get(productId) || [];
    current.push(offer);
    offersByProduct.set(productId, current);
  }

  const candidates = products.filter((product) => (
    offersByProduct.has(String(product.id || '').trim())
  ));

  return [...candidates].sort((left, right) => {
    const leftOffers = offersByProduct.get(String(left.id || '').trim()) || [];
    const rightOffers = offersByProduct.get(String(right.id || '').trim()) || [];
    const leftActiveOffer = leftOffers.some((offer) => offer.ativo !== false);
    const rightActiveOffer = rightOffers.some((offer) => offer.ativo !== false);
    const leftStock = Math.max(0, ...leftOffers.map((offer) => Number(offer.estoque || 0)));
    const rightStock = Math.max(0, ...rightOffers.map((offer) => Number(offer.estoque || 0)));
    if ((left.ativo !== false) !== (right.ativo !== false)) return left.ativo !== false ? -1 : 1;
    if (leftActiveOffer !== rightActiveOffer) return leftActiveOffer ? -1 : 1;
    if (leftStock !== rightStock) return rightStock - leftStock;
    return String(left.id || '').localeCompare(String(right.id || ''));
  })[0] || null;
}
