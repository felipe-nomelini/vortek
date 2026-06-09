export type ProdutoFilterOfferRow = {
  id: string;
  produto_id: string;
  dslite_fornecedor_id: string | null;
  fornecedor_nome: string | null;
  sku_oferta: string | null;
  sku_fornecedor: string | null;
  nome: string | null;
};

export type SupplierFilterOption = {
  id: string;
  label: string;
  apelido: string;
  dsliteId: string;
};

type OrderOption = {
  column: string;
  ascending?: boolean;
};

export async function fetchAllRowsPaginated<T>(
  loader: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 1000,
) {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await loader(offset, offset + chunkSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;
    offset += chunkSize;
  }

  return rows;
}

export async function fetchAllTableRows<T>(
  client: any,
  table: string,
  select: string,
  orders: OrderOption[] = [{ column: 'created_at', ascending: false }],
  chunkSize = 1000,
) {
  return fetchAllRowsPaginated<T>((from, to) => {
    let query = client
      .from(table)
      .select(select)
      .range(from, to);

    for (const order of orders) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }

    return query;
  }, chunkSize);
}

export async function listActiveSupplierOptions(client: any): Promise<SupplierFilterOption[]> {
  const { data, error } = await client
    .from('fornecedores')
    .select('id,apelido,dslite_id')
    .eq('ativo', true)
    .order('apelido', { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar fornecedores ativos: ${error.message}`);
  }

  const entries: Array<readonly [string, SupplierFilterOption]> = (data || [])
    .map((row: any) => {
      const id = String(row?.id || '').trim();
      const apelido = String(row?.apelido || '').trim();
      const dsliteId = String(row?.dslite_id || '').trim();
      if (!id || !apelido || !dsliteId) return null;
      return [id, { id, label: apelido, apelido, dsliteId }] as const;
    })
    .filter((entry: (readonly [string, SupplierFilterOption]) | null): entry is readonly [string, SupplierFilterOption] => entry !== null);

  return Array.from(new Map<string, SupplierFilterOption>(entries).values());
}

export function buildOffersByProductId(offers: ProdutoFilterOfferRow[]) {
  const map = new Map<string, ProdutoFilterOfferRow[]>();

  for (const offer of offers) {
    const productId = String(offer.produto_id || '').trim();
    if (!productId) continue;
    const list = map.get(productId) || [];
    list.push(offer);
    map.set(productId, list);
  }

  return map;
}

export function mapSupplierFilterIdsToDsliteIds(
  supplierFilterIds: string[],
  supplierOptions: SupplierFilterOption[],
) {
  if (supplierFilterIds.length === 0) return [];
  const dsliteIds = supplierOptions
    .filter((option) => supplierFilterIds.includes(option.id))
    .map((option) => option.dsliteId)
    .filter(Boolean);

  return Array.from(new Set(dsliteIds));
}

export function matchesProductMasterFilters(params: {
  product: Record<string, any>;
  offers: ProdutoFilterOfferRow[];
  search: string;
  supplierFilterIds: string[];
  mlStatus: string;
  estoque: string;
}) {
  const { product, offers, search, supplierFilterIds, mlStatus, estoque } = params;

  if (search) {
    const term = search.toLowerCase();
    const haystack = [
      product.fornecedor,
      product.nome,
      product.sku,
      product.gtin,
      ...offers.flatMap((offer) => [
        offer.fornecedor_nome,
        offer.sku_oferta,
        offer.sku_fornecedor,
        offer.nome,
      ]),
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');

    if (!haystack.includes(term)) return false;
  }

  if (supplierFilterIds.length > 0) {
    const supplierIds = new Set([
      String(product.dslite_fornecedor_id || '').trim(),
      ...offers.map((offer) => String(offer.dslite_fornecedor_id || '').trim()),
    ].filter(Boolean));

    if (!supplierFilterIds.some((supplierId) => supplierIds.has(String(supplierId || '').trim()))) {
      return false;
    }
  }

  if (mlStatus && String(product.ml_status || '') !== mlStatus) {
    return false;
  }

  if (estoque === 'com_estoque' && Number(product.estoque || 0) <= 0) {
    return false;
  }

  if (estoque === 'sem_estoque' && Number(product.estoque || 0) !== 0) {
    return false;
  }

  return true;
}
