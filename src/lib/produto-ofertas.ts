import type { Database } from '@/types/database';

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];
type OfertaRow = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'];
type OfertaWithProductRow = OfertaRow & {
  product: ProdutoRow | null;
};

export type ProdutoOfertaListRow = {
  offerId: string;
  productId: string;
  preferred: boolean;
  skuOferta: string;
  skuFornecedor: string | null;
  nome: string;
  descricao: string;
  marca: string | null;
  imagens: string[];
  gtin: string | null;
  ncm: string | null;
  cest: string | null;
  fornecedor: string | null;
  custo: number;
  estoque: number;
  ativo: boolean;
  prioridade: number;
  paymentMode: string;
  dsliteFornecedorId: string;
  dsliteProdutoId: string;
  leadTimeDias: number | null;
  lastSyncAt: string | null;
  product: ProdutoRow;
};

function coerceImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function toOfferRow(item: OfertaRow, product: ProdutoRow): ProdutoOfertaListRow {
  const preferred = String((product as any).oferta_preferencial_id || '').trim()
    ? String((product as any).oferta_preferencial_id || '').trim() === String(item.id || '').trim()
    : (
      String(product.dslite_fornecedor_id || '').trim() === String(item.dslite_fornecedor_id || '').trim()
      && String(product.dslite_produto_id || '').trim() === String(item.dslite_produto_id || '').trim()
    );
  const supplierSku = String(item.sku_oferta || item.sku_fornecedor || item.dslite_produto_id || '').trim();

  return {
    offerId: String(item.id),
    productId: String(item.produto_id),
    preferred,
    skuOferta: supplierSku,
    skuFornecedor: item.sku_fornecedor ? String(item.sku_fornecedor) : supplierSku || null,
    nome: String(item.nome || product.nome || '').trim(),
    descricao: String(item.descricao || product.descricao || '').trim(),
    marca: item.marca ? String(item.marca) : (product.marca || null),
    imagens: coerceImageList(item.imagens),
    gtin: item.gtin ? String(item.gtin) : (product.gtin || null),
    ncm: item.ncm ? String(item.ncm) : (product.ncm || null),
    cest: item.cest ? String(item.cest) : (product.cest || null),
    fornecedor: item.fornecedor_nome ? String(item.fornecedor_nome) : (product.fornecedor || null),
    custo: Number(item.custo || 0),
    estoque: Number(item.estoque || 0),
    ativo: Boolean(item.ativo),
    prioridade: Number(item.prioridade || 0),
    paymentMode: String(item.payment_mode || 'postpaid'),
    dsliteFornecedorId: String(item.dslite_fornecedor_id || ''),
    dsliteProdutoId: String(item.dslite_produto_id || ''),
    leadTimeDias: item.lead_time_dias == null ? null : Number(item.lead_time_dias),
    lastSyncAt: item.last_sync_at ? String(item.last_sync_at) : null,
    product,
  };
}

async function fetchRowsInChunks<T>(
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

export async function loadProdutoOfertaRows(client: any): Promise<ProdutoOfertaListRow[]> {
  const offers = await fetchRowsInChunks<OfertaWithProductRow>((from, to) => (
    client
      .from('produto_fornecedor_ofertas')
      .select('*, product:produtos!produto_fornecedor_ofertas_produto_id_fkey(*)')
      .order('fornecedor_nome', { ascending: true })
      .order('nome', { ascending: true })
      .range(from, to)
  ));

  return offers
    .map((offer) => {
      const product = offer.product;
      if (!product) return null;
      return toOfferRow(offer, product);
    })
    .filter((item): item is ProdutoOfertaListRow => item !== null);
}
