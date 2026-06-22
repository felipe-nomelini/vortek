import type { Database } from '@/types/database';
import { isBalanceAccountSupplier } from '@/lib/supplier-balance';

export type ProdutoFornecedorOfertaRow = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'];
export type SupplierPaymentMode = 'postpaid' | 'prepaid_pix' | 'balance_account';
export type SupplierPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export function inferSupplierPaymentMode(fornecedorId: string | number | null | undefined): SupplierPaymentMode {
  if (isBalanceAccountSupplier(fornecedorId)) return 'balance_account';
  return 'prepaid_pix';
}

export function normalizeOfferPriority(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

export function normalizeProductMatchText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeGtin(value: unknown): string {
  return String(value || '').replace(/\D+/g, '').trim();
}

export function choosePreferredOffer<T extends {
  id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
  custo?: number | null;
  prioridade?: number | null;
}>(offers: T[]): T | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;

  const activeOffers = offers.filter((offer) => offer.ativo !== false);
  const source = activeOffers.length > 0 ? activeOffers : offers;
  const withStock = source.filter((offer) => Number(offer.estoque || 0) > 0);
  const eligible = withStock.length > 0 ? withStock : source;

  const sorted = [...eligible].sort((left, right) => {
    const costDiff = Number(left.custo || 0) - Number(right.custo || 0);
    if (costDiff !== 0) return costDiff;

    const priorityDiff = normalizeOfferPriority(left.prioridade) - normalizeOfferPriority(right.prioridade);
    if (priorityDiff !== 0) return priorityDiff;

    return Number(right.estoque || 0) - Number(left.estoque || 0);
  });

  return sorted[0] || null;
}

export function resolvePreferredOfferForProduct<T extends {
  id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
  custo?: number | null;
  prioridade?: number | null;
}>(
  offers: T[],
  preferredOfferId?: string | null,
): T | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;

  const explicitPreferredId = String(preferredOfferId || '').trim();
  if (explicitPreferredId) {
    const explicitPreferred = offers.find((offer) => String(offer.id || '').trim() === explicitPreferredId) || null;
    const hasActiveStockAlternative = offers.some((offer) => (
      String(offer.id || '').trim() !== explicitPreferredId
      && offer.ativo !== false
      && Number(offer.estoque || 0) > 0
    ));
    if (
      explicitPreferred
      && explicitPreferred.ativo !== false
      && (Number(explicitPreferred.estoque || 0) > 0 || !hasActiveStockAlternative)
    ) {
      return explicitPreferred;
    }
  }

  return choosePreferredOffer(offers);
}

export function resolveCompraStatus(params: {
  baseStatus: string | null | undefined;
  supplierPaymentMode: string | null | undefined;
  supplierPaymentStatus: string | null | undefined;
}) {
  const baseStatus = String(params.baseStatus || '').trim() || 'Iniciado';
  const paymentMode = String(params.supplierPaymentMode || '').trim().toLowerCase();
  const paymentStatus = String(params.supplierPaymentStatus || '').trim().toLowerCase();

  if (paymentMode === 'prepaid_pix' && paymentStatus === 'pending') {
    return 'Aguardando Pagamento Fornecedor';
  }

  return baseStatus;
}

export async function syncPreferredProductSnapshot(
  client: any,
  productIds: string[],
): Promise<Array<{
  productId: string;
  previous: {
    id: string;
    sku: string;
    ml_item_id: string | null;
    ml_status: string | null;
    oferta_preferencial_id: string | null;
    custo: number;
    estoque: number;
    fornecedor: string | null;
    dslite_fornecedor_id: string | null;
    dslite_produto_id: string | null;
    dslite_ultima_sync: string | null;
  };
  next: {
    oferta_preferencial_id: string | null;
    custo: number;
    estoque: number;
    fornecedor: string | null;
    dslite_fornecedor_id: string | null;
    dslite_produto_id: string | null;
    dslite_ultima_sync: string | null;
  };
  changed: boolean;
}>> {
  const ids = Array.from(new Set(productIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return [];

  const [{ data: products, error: productError }, { data: offers, error: offerError }] = await Promise.all([
    client
      .from('produtos')
      .select('id,sku,ml_item_id,ml_status,oferta_preferencial_id,custo,estoque,fornecedor,dslite_fornecedor_id,dslite_produto_id,dslite_ultima_sync')
      .in('id', ids),
    client
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,dslite_fornecedor_id,dslite_produto_id,fornecedor_nome,custo,estoque,ativo,prioridade,last_sync_at')
      .in('produto_id', ids),
  ]);

  if (productError) {
    throw new Error(`Falha ao consultar produtos para snapshot preferencial: ${productError.message}`);
  }
  if (offerError) {
    throw new Error(`Falha ao consultar ofertas para snapshot preferencial: ${offerError.message}`);
  }

  const offersByProductId = new Map<string, ProdutoFornecedorOfertaRow[]>();
  for (const offer of (offers || []) as ProdutoFornecedorOfertaRow[]) {
    const key = String(offer.produto_id || '').trim();
    if (!key) continue;
    const list = offersByProductId.get(key) || [];
    list.push(offer);
    offersByProductId.set(key, list);
  }

  const results: Array<{
    productId: string;
    previous: {
      id: string;
      sku: string;
      ml_item_id: string | null;
      ml_status: string | null;
      oferta_preferencial_id: string | null;
      custo: number;
      estoque: number;
      fornecedor: string | null;
      dslite_fornecedor_id: string | null;
      dslite_produto_id: string | null;
      dslite_ultima_sync: string | null;
    };
    next: {
      oferta_preferencial_id: string | null;
      custo: number;
      estoque: number;
      fornecedor: string | null;
      dslite_fornecedor_id: string | null;
      dslite_produto_id: string | null;
      dslite_ultima_sync: string | null;
    };
    changed: boolean;
  }> = [];

  for (const product of products || []) {
    const productId = String((product as any).id || '').trim();
    if (!productId) continue;
    const preferred = resolvePreferredOfferForProduct(
      offersByProductId.get(productId) || [],
      (product as any).oferta_preferencial_id,
    );
    if (!preferred) continue;

    const previous = {
      id: String((product as any).id),
      sku: String((product as any).sku || ''),
      ml_item_id: (product as any).ml_item_id ? String((product as any).ml_item_id) : null,
      ml_status: (product as any).ml_status ? String((product as any).ml_status) : null,
      oferta_preferencial_id: (product as any).oferta_preferencial_id ? String((product as any).oferta_preferencial_id) : null,
      custo: Number((product as any).custo || 0),
      estoque: Number((product as any).estoque || 0),
      fornecedor: (product as any).fornecedor ? String((product as any).fornecedor) : null,
      dslite_fornecedor_id: (product as any).dslite_fornecedor_id ? String((product as any).dslite_fornecedor_id) : null,
      dslite_produto_id: (product as any).dslite_produto_id ? String((product as any).dslite_produto_id) : null,
      dslite_ultima_sync: (product as any).dslite_ultima_sync ? String((product as any).dslite_ultima_sync) : null,
    };

    const next = {
      oferta_preferencial_id: String((preferred as any).id || '').trim() || null,
      custo: Number(preferred.custo || 0),
      estoque: Number(preferred.estoque || 0),
      fornecedor: preferred.fornecedor_nome ? String(preferred.fornecedor_nome) : previous.fornecedor,
      dslite_fornecedor_id: String(preferred.dslite_fornecedor_id || ''),
      dslite_produto_id: String(preferred.dslite_produto_id || ''),
      dslite_ultima_sync: preferred.last_sync_at || previous.dslite_ultima_sync,
    };

    const changed =
      (previous.oferta_preferencial_id || '') !== (next.oferta_preferencial_id || '') ||
      previous.custo !== next.custo ||
      previous.estoque !== next.estoque ||
      (previous.fornecedor || '') !== (next.fornecedor || '') ||
      (previous.dslite_fornecedor_id || '') !== (next.dslite_fornecedor_id || '') ||
      (previous.dslite_produto_id || '') !== (next.dslite_produto_id || '') ||
      (previous.dslite_ultima_sync || '') !== (next.dslite_ultima_sync || '');

    if (changed) {
      const { error: updateError } = await client
        .from('produtos')
        .update(next as any)
        .eq('id', productId);

      if (updateError) {
        throw new Error(`Falha ao atualizar snapshot preferencial do produto ${productId}: ${updateError.message}`);
      }
    }

    results.push({ productId, previous, next, changed });
  }

  return results;
}
