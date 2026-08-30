import { calcularSaldoEstoqueInterno } from '@/lib/estoque-interno-saldo';
import { isBlockedDropshippingDsliteSupplier } from '@/lib/dslite/supplier-policy';
import {
  calculateInternalFulfillmentCapacity,
  calculateSafeFulfillmentQuantity,
  calculateSupplierFulfillmentCapacity,
  type FulfillmentCapacityItem,
  type ProductFulfillmentCapacity,
  type SupplierCapacityOffer,
} from '@/lib/orders/fulfillment-capacity';

type ServiceClientLike = { from: (table: string) => any };

const EMPTY_CAPACITY: ProductFulfillmentCapacity = {
  internal: 0,
  supplier: 0,
  safe: 0,
};

async function selectInChunks(
  client: ServiceClientLike,
  table: string,
  columns: string,
  filterColumn: string,
  values: string[],
): Promise<any[]> {
  const uniqueValues = Array.from(new Set(values.map(String).filter(Boolean)));
  const rows: any[] = [];
  for (let index = 0; index < uniqueValues.length; index += 200) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .in(filterColumn, uniqueValues.slice(index, index + 200));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

/** Carrega, em lote, o saldo interno já comprometido por reservas. */
export async function loadInternalStockBalances(
  client: ServiceClientLike,
  productIds: string[],
): Promise<Map<string, number>> {
  const movements = await selectInChunks(
    client,
    'estoque_interno_movimentacoes',
    'produto_id,tipo,quantidade,situacao_estoque,estornada_em',
    'produto_id',
    productIds,
  );
  const movementsByProduct = new Map<string, any[]>();
  for (const movement of movements) {
    const productId = String(movement.produto_id || '');
    const current = movementsByProduct.get(productId) || [];
    current.push(movement);
    movementsByProduct.set(productId, current);
  }

  return new Map(Array.from(new Set(productIds.map(String).filter(Boolean))).map(
    (productId) => [
      productId,
      Math.max(0, calcularSaldoEstoqueInterno(movementsByProduct.get(productId) || [])),
    ],
  ));
}

/**
 * Fonte central de capacidade operacional por produto.
 * Kits usam componentes; fornecedor de kit composto permanece indisponível
 * porque o fluxo DSLite atual aceita somente kit de um único componente.
 */
export async function loadProductFulfillmentCapacities(
  client: ServiceClientLike,
  productIds: string[],
): Promise<Map<string, ProductFulfillmentCapacity>> {
  const uniqueProductIds = Array.from(new Set(productIds.map(String).filter(Boolean)));
  const result = new Map<string, ProductFulfillmentCapacity>(
    uniqueProductIds.map((productId) => [productId, { ...EMPTY_CAPACITY }]),
  );
  if (uniqueProductIds.length === 0) return result;

  const [products, kits] = await Promise.all([
    selectInChunks(client, 'produtos', 'id,ativo', 'id', uniqueProductIds),
    selectInChunks(client, 'produto_kits', 'produto_id,ativo', 'produto_id', uniqueProductIds),
  ]);
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const kitByProductId = new Map(kits.map((kit) => [String(kit.produto_id), kit]));
  const kitIds = Array.from(kitByProductId.keys());
  const components = kitIds.length > 0
    ? await selectInChunks(
        client,
        'produto_kit_componentes',
        'kit_produto_id,componente_produto_id,quantidade',
        'kit_produto_id',
        kitIds,
      )
    : [];
  const componentIds = Array.from(new Set(
    components.map((component) => String(component.componente_produto_id || '')).filter(Boolean),
  ));
  const componentProducts = componentIds.length > 0
    ? await selectInChunks(client, 'produtos', 'id,ativo', 'id', componentIds)
    : [];
  for (const product of componentProducts) productById.set(String(product.id), product);

  const sourceProductIds = Array.from(new Set([...uniqueProductIds, ...componentIds]));
  const [balances, offerRows] = await Promise.all([
    loadInternalStockBalances(client, sourceProductIds),
    selectInChunks(
      client,
      'produto_fornecedor_ofertas',
      'id,produto_id,dslite_fornecedor_id,dslite_produto_id,ativo,estoque,custo',
      'produto_id',
      sourceProductIds,
    ),
  ]);
  const offers: SupplierCapacityOffer[] = offerRows.map((offer) => ({
    id: String(offer.id || ''),
    produtoId: String(offer.produto_id || ''),
    supplierId: String(offer.dslite_fornecedor_id || ''),
    supplierProductId: String(offer.dslite_produto_id || ''),
    ativo: offer.ativo,
    allowed: !isBlockedDropshippingDsliteSupplier(offer.dslite_fornecedor_id),
    estoque: offer.estoque,
    custo: offer.custo,
  }));
  const componentsByKit = new Map<string, any[]>();
  for (const component of components) {
    const kitId = String(component.kit_produto_id || '');
    const current = componentsByKit.get(kitId) || [];
    current.push(component);
    componentsByKit.set(kitId, current);
  }

  for (const productId of uniqueProductIds) {
    const product = productById.get(productId);
    if (!product || product.ativo === false) continue;

    const kit = kitByProductId.get(productId);
    let internalItems: FulfillmentCapacityItem[] = [{ produtoId: productId, quantidade: 1 }];
    let supplierItems: FulfillmentCapacityItem[] = internalItems;
    if (kit) {
      const kitComponents = componentsByKit.get(productId) || [];
      const validComponents = kit.ativo !== false
        && kitComponents.length > 0
        && kitComponents.every((component) => {
          const componentId = String(component.componente_produto_id || '');
          const quantity = Number(component.quantidade);
          const componentProduct = productById.get(componentId);
          return componentId
            && Number.isInteger(quantity)
            && quantity > 0
            && Boolean(componentProduct)
            && componentProduct.ativo !== false;
        });
      if (!validComponents) continue;
      internalItems = kitComponents.map((component) => ({
        produtoId: String(component.componente_produto_id),
        quantidade: Number(component.quantidade),
      }));
      supplierItems = internalItems.length === 1 ? internalItems : [];
    }

    const internal = calculateInternalFulfillmentCapacity(internalItems, balances);
    const supplier = calculateSupplierFulfillmentCapacity(supplierItems, offers);
    result.set(productId, {
      internal,
      supplier,
      safe: calculateSafeFulfillmentQuantity(internal, supplier),
    });
  }

  return result;
}

export async function loadProductFulfillmentCapacity(
  client: ServiceClientLike,
  productId: string,
): Promise<ProductFulfillmentCapacity> {
  const capacities = await loadProductFulfillmentCapacities(client, [productId]);
  return capacities.get(String(productId)) || { ...EMPTY_CAPACITY };
}
