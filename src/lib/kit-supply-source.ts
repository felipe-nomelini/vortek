import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';

type ServiceClientLike = { from: (table: string) => any };

type KitRow = {
  produto_id?: string | null;
  fornecedor_dslite_id?: string | null;
  sku_origem?: string | null;
  ativo?: boolean | null;
};

type KitComponentRow = {
  kit_produto_id?: string | null;
  componente_produto_id?: string | null;
  quantidade?: number | null;
};

type ComponentProductRow = {
  id?: string | null;
  sku?: string | null;
  nome?: string | null;
  descricao?: string | null;
  ncm?: string | null;
  gtin?: string | null;
  ativo?: boolean | null;
};

export type KitSupplierOffer = {
  id?: string | null;
  produto_id?: string | null;
  dslite_fornecedor_id?: string | null;
  dslite_produto_id?: string | null;
  fornecedor_nome?: string | null;
  sku_oferta?: string | null;
  sku_fornecedor?: string | null;
  custo?: number | null;
  estoque?: number | null;
  ativo?: boolean | null;
  prioridade?: number | null;
  payment_mode?: string | null;
  updated_at?: string | null;
  last_sync_at?: string | null;
  [key: string]: unknown;
};

export type ReadyKitSupplySource = {
  kitProductId: string;
  supplierId: string;
  supplierName: string;
  sourceSku: string;
  componentProductId: string;
  componentSku: string;
  componentTitle: string;
  componentUnit: 'M' | 'UN';
  componentNcm: string | null;
  componentGtin: string | null;
  componentQuantity: number;
  offer: KitSupplierOffer;
  stock: number;
  cost: number;
  observedAt: string | null;
};

export type KitSupplySourceResolution =
  | { kind: 'not_kit' }
  | { kind: 'inactive'; supplierId: string; sourceSku: string }
  | { kind: 'unsupported_composite'; supplierId: string; sourceSku: string; componentCount: number }
  | {
      kind: 'incomplete';
      supplierId: string;
      sourceSku: string;
      reason: 'missing_supplier' | 'missing_component' | 'inactive_component' | 'nested_component' | 'missing_supplier_offer';
    }
  | { kind: 'ready'; source: ReadyKitSupplySource };

function normalizeMoney(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? Math.round(amount * 100) / 100
    : null;
}

function normalizeStock(value: unknown): number {
  const stock = Number(value);
  return Number.isFinite(stock) && stock > 0 ? Math.trunc(stock) : 0;
}

function selectKitSupplierOffer(
  offers: KitSupplierOffer[],
  componentProductId: string,
  supplierId: string,
  operationalSupplierIds: ReadonlySet<string>,
): KitSupplierOffer | null {
  if (!operationalSupplierIds.has(supplierId)) return null;
  return offers
    .filter((offer) => (
      String(offer.produto_id || '').trim() === componentProductId
      && String(offer.dslite_fornecedor_id || '').trim() === supplierId
      && offer.ativo === true
      && Boolean(String(offer.id || '').trim())
      && Boolean(String(offer.dslite_produto_id || '').trim())
      && normalizeMoney(offer.custo) !== null
    ))
    .sort((left, right) => (
      Number(left.prioridade || 0) - Number(right.prioridade || 0)
      || Number(left.custo || 0) - Number(right.custo || 0)
      || String(left.id || '').localeCompare(String(right.id || ''))
    ))[0] || null;
}

export function resolveKitSupplySourceFromRows(params: {
  kitProductId: string;
  kit: KitRow | null | undefined;
  components: KitComponentRow[];
  componentProducts: ComponentProductRow[];
  nestedKitProductIds?: ReadonlySet<string>;
  offers: KitSupplierOffer[];
  operationalSupplierIds: ReadonlySet<string>;
}): KitSupplySourceResolution {
  const { kit, kitProductId } = params;
  if (!kit?.produto_id) return { kind: 'not_kit' };

  const supplierId = String(kit.fornecedor_dslite_id || '').trim();
  const sourceSku = String(kit.sku_origem || '').trim();
  if (kit.ativo === false) return { kind: 'inactive', supplierId, sourceSku };
  if (!supplierId) return { kind: 'incomplete', supplierId, sourceSku, reason: 'missing_supplier' };

  const components = params.components.filter((row) => (
    String(row.kit_produto_id || '').trim() === kitProductId
  ));
  if (components.length !== 1) {
    return {
      kind: 'unsupported_composite',
      supplierId,
      sourceSku,
      componentCount: components.length,
    };
  }

  const component = components[0];
  const componentProductId = String(component.componente_produto_id || '').trim();
  const componentQuantity = Number(component.quantidade || 0);
  const componentProduct = params.componentProducts.find((row) => (
    String(row.id || '').trim() === componentProductId
  ));
  if (!componentProductId || !Number.isSafeInteger(componentQuantity) || componentQuantity <= 0 || !componentProduct) {
    return { kind: 'incomplete', supplierId, sourceSku, reason: 'missing_component' };
  }
  if (componentProduct.ativo === false) {
    return { kind: 'incomplete', supplierId, sourceSku, reason: 'inactive_component' };
  }
  if (params.nestedKitProductIds?.has(componentProductId)) {
    return { kind: 'incomplete', supplierId, sourceSku, reason: 'nested_component' };
  }

  const offer = selectKitSupplierOffer(
    params.offers,
    componentProductId,
    supplierId,
    params.operationalSupplierIds,
  );
  if (!offer) {
    return { kind: 'incomplete', supplierId, sourceSku, reason: 'missing_supplier_offer' };
  }

  const unitCost = normalizeMoney(offer.custo)!;
  const componentStock = normalizeStock(offer.estoque);
  return {
    kind: 'ready',
    source: {
      kitProductId,
      supplierId,
      supplierName: String(offer.fornecedor_nome || `Fornecedor DSLite ${supplierId}`).trim(),
      sourceSku,
      componentProductId,
      componentSku: String(componentProduct.sku || '').trim(),
      componentTitle: String(componentProduct.nome || componentProduct.sku || '').trim(),
      componentUnit: /\bunidade de medida\s*:\s*metro\b/i.test(String(componentProduct.descricao || '')) ? 'M' : 'UN',
      componentNcm: String(componentProduct.ncm || '').trim() || null,
      componentGtin: String(componentProduct.gtin || '').trim() || null,
      componentQuantity,
      offer,
      stock: Math.floor(componentStock / componentQuantity),
      cost: Math.round(unitCost * componentQuantity * 100) / 100,
      observedAt: String(offer.updated_at || offer.last_sync_at || '').trim() || null,
    },
  };
}

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

export async function loadKitSupplySources(
  client: ServiceClientLike,
  productIds: string[],
  options: { operationalSupplierIds?: ReadonlySet<string> } = {},
): Promise<Map<string, KitSupplySourceResolution>> {
  const uniqueProductIds = Array.from(new Set(productIds.map(String).filter(Boolean)));
  const result = new Map<string, KitSupplySourceResolution>(
    uniqueProductIds.map((productId) => [productId, { kind: 'not_kit' }]),
  );
  if (uniqueProductIds.length === 0) return result;

  const kits = await selectInChunks(
    client,
    'produto_kits',
    'produto_id,fornecedor_dslite_id,sku_origem,ativo',
    'produto_id',
    uniqueProductIds,
  );
  if (kits.length === 0) return result;

  const kitIds = kits.map((kit) => String(kit.produto_id || '')).filter(Boolean);
  const components = await selectInChunks(
    client,
    'produto_kit_componentes',
    'kit_produto_id,componente_produto_id,quantidade',
    'kit_produto_id',
    kitIds,
  );
  const componentIds = Array.from(new Set(
    components.map((component) => String(component.componente_produto_id || '')).filter(Boolean),
  ));
  const [componentProducts, nestedKits, offers, operationalSupplierIds] = await Promise.all([
    selectInChunks(client, 'produtos', 'id,sku,nome,descricao,ncm,gtin,ativo', 'id', componentIds),
    selectInChunks(client, 'produto_kits', 'produto_id', 'produto_id', componentIds),
    selectInChunks(
      client,
      'produto_fornecedor_ofertas',
      'id,produto_id,dslite_fornecedor_id,dslite_produto_id,fornecedor_nome,sku_oferta,sku_fornecedor,custo,estoque,ativo,prioridade,payment_mode,updated_at,last_sync_at',
      'produto_id',
      componentIds,
    ),
    options.operationalSupplierIds
      ? Promise.resolve(options.operationalSupplierIds)
      : loadOperationalDropshippingSupplierIds(client),
  ]);
  const nestedKitProductIds = new Set(nestedKits.map((kit) => String(kit.produto_id || '')).filter(Boolean));

  for (const kit of kits) {
    const kitProductId = String(kit.produto_id || '').trim();
    if (!kitProductId) continue;
    result.set(kitProductId, resolveKitSupplySourceFromRows({
      kitProductId,
      kit,
      components,
      componentProducts,
      nestedKitProductIds,
      offers,
      operationalSupplierIds,
    }));
  }
  return result;
}
