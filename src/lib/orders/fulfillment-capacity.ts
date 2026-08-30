export type FulfillmentCapacityItem = {
  produtoId: string;
  quantidade: number;
};

export type SupplierCapacityOffer = {
  id?: string | null;
  produtoId: string;
  supplierId?: string | null;
  supplierProductId?: string | null;
  ativo?: boolean | null;
  allowed?: boolean;
  estoque?: number | string | null;
  custo?: number | string | null;
};

export type SupplierFulfillmentOption = {
  supplierId: string;
  capacity: number;
};

export type ProductFulfillmentCapacity = {
  internal: number;
  supplier: number;
  safe: number;
};

function normalizeQuantity(value: unknown): number {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0
    ? Math.trunc(quantity)
    : 0;
}

function aggregateRequirements(
  items: FulfillmentCapacityItem[],
): Map<string, number> | null {
  if (items.length === 0) return null;

  const requirements = new Map<string, number>();
  for (const item of items) {
    const productId = String(item.produtoId || '').trim();
    const quantity = normalizeQuantity(item.quantidade);
    if (!productId || quantity <= 0) return null;
    requirements.set(productId, (requirements.get(productId) || 0) + quantity);
  }
  return requirements;
}

/** Quantidade de conjuntos completos atendidos por uma única origem de estoque. */
export function calculateStockFulfillmentCapacity(
  items: FulfillmentCapacityItem[],
  stockByProductId: ReadonlyMap<string, number>,
): number {
  const requirements = aggregateRequirements(items);
  if (!requirements) return 0;

  let capacity = Number.MAX_SAFE_INTEGER;
  for (const [productId, requiredQuantity] of requirements) {
    const available = normalizeQuantity(stockByProductId.get(productId));
    capacity = Math.min(capacity, Math.floor(available / requiredQuantity));
  }

  return Number.isFinite(capacity) && capacity !== Number.MAX_SAFE_INTEGER
    ? Math.max(0, capacity)
    : 0;
}

export const calculateInternalFulfillmentCapacity =
  calculateStockFulfillmentCapacity;

export function isOperationalSupplierCapacityOffer(
  offer: SupplierCapacityOffer,
): boolean {
  return offer.ativo !== false
    && offer.allowed !== false
    && Boolean(String(offer.id || '').trim())
    && Boolean(String(offer.produtoId || '').trim())
    && Boolean(String(offer.supplierId || '').trim())
    && Boolean(String(offer.supplierProductId || '').trim())
    && normalizeQuantity(offer.estoque) > 0
    && Number(offer.custo) > 0;
}

/**
 * Calcula capacidade por fornecedor. Estoques de ofertas ou fornecedores
 * diferentes nunca são somados; uma cesta precisa caber inteira em uma origem.
 */
export function calculateSupplierFulfillmentOptions(
  items: FulfillmentCapacityItem[],
  offers: SupplierCapacityOffer[],
): SupplierFulfillmentOption[] {
  const requirements = aggregateRequirements(items);
  if (!requirements) return [];

  const stockBySupplierAndProduct = new Map<string, Map<string, number>>();
  for (const offer of offers) {
    if (!isOperationalSupplierCapacityOffer(offer)) continue;
    const supplierId = String(offer.supplierId).trim();
    const productId = String(offer.produtoId).trim();
    if (!requirements.has(productId)) continue;

    const stockByProduct = stockBySupplierAndProduct.get(supplierId)
      || new Map<string, number>();
    stockByProduct.set(
      productId,
      Math.max(
        stockByProduct.get(productId) || 0,
        normalizeQuantity(offer.estoque),
      ),
    );
    stockBySupplierAndProduct.set(supplierId, stockByProduct);
  }

  const options: SupplierFulfillmentOption[] = [];
  for (const [supplierId, stockByProduct] of stockBySupplierAndProduct) {
    const capacity = calculateStockFulfillmentCapacity(items, stockByProduct);
    if (capacity > 0) options.push({ supplierId, capacity });
  }

  return options.sort((left, right) => (
    right.capacity - left.capacity
    || left.supplierId.localeCompare(right.supplierId)
  ));
}

export function calculateSupplierFulfillmentCapacity(
  items: FulfillmentCapacityItem[],
  offers: SupplierCapacityOffer[],
): number {
  return calculateSupplierFulfillmentOptions(items, offers)[0]?.capacity || 0;
}

/** Q segura escolhe a melhor origem completa; capacidades incompatíveis não somam. */
export function calculateSafeFulfillmentQuantity(
  internalCapacity: number,
  supplierCapacity: number,
): number {
  return Math.max(
    normalizeQuantity(internalCapacity),
    normalizeQuantity(supplierCapacity),
  );
}
