export const EVOLUSOM_DSLITE_SUPPLIER_ID = "133";

type ProductRow = {
  id: string;
  sku: string;
  nome: string;
  gtin: string | null;
  ml_item_id: string | null;
  ml_status: string;
  oferta_preferencial_id: string | null;
  ativo: boolean;
};

type OfferRow = {
  id: string;
  produto_id: string;
  sku_fornecedor: string | null;
  sku_oferta: string;
  product: ProductRow | null;
};

type ListingRow = {
  produto_id: string | null;
  ml_item_id: string;
};

export type PublicEvolusomGtinRow = {
  productId: string;
  sku: string;
  supplierSku: string;
  name: string;
};

async function fetchAll<T>(
  loader: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 500,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loader(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export async function loadPublicEvolusomMissingGtinRows(client: any) {
  const offers = await fetchAll<OfferRow>((from, to) =>
    client
      .from("produto_fornecedor_ofertas")
      .select(
        "id,produto_id,sku_fornecedor,sku_oferta,product:produtos!produto_fornecedor_ofertas_produto_id_fkey!inner(id,sku,nome,gtin,ml_item_id,ml_status,oferta_preferencial_id,ativo)",
      )
      .eq("dslite_fornecedor_id", EVOLUSOM_DSLITE_SUPPLIER_ID)
      .eq("ativo", true)
      .gt("estoque", 0)
      .eq("product.ativo", true)
      .eq("product.ml_status", "sem_anuncio")
      .is("product.ml_item_id", null)
      .eq("product.gtin", "")
      .order("produto_id", { ascending: true })
      .range(from, to),
  );

  const preferredOffers = offers.filter(
    (offer) =>
      offer.product &&
      String(offer.product.oferta_preferencial_id || "") === String(offer.id),
  );
  const linkedProductIds = new Set<string>();

  for (const productIds of chunk(
    preferredOffers.map((offer) => String(offer.produto_id)),
    100,
  )) {
    const { data, error } = await client
      .from("anuncios_ml")
      .select("produto_id,ml_item_id")
      .in("produto_id", productIds)
      .not("ml_item_id", "is", null);
    if (error) throw new Error(error.message);
    for (const listing of (data || []) as ListingRow[]) {
      if (listing.produto_id && String(listing.ml_item_id || "").trim()) {
        linkedProductIds.add(String(listing.produto_id));
      }
    }
  }

  return preferredOffers
    .filter(
      (offer) =>
        offer.product && !linkedProductIds.has(String(offer.produto_id)),
    )
    .map(
      (offer): PublicEvolusomGtinRow => ({
        productId: String(offer.produto_id),
        sku: String(offer.product?.sku || ""),
        supplierSku: String(
          offer.sku_fornecedor || offer.sku_oferta || "",
        ),
        name: String(offer.product?.nome || ""),
      }),
    )
    .sort((left, right) => left.sku.localeCompare(right.sku, "pt-BR"));
}
