import type { Database } from '@/types/database';
import {
  choosePreferredOffer,
  normalizeOfferPriority,
  resolvePreferredOfferForProduct,
} from '@/lib/preferred-offer';
import { filterAllowedDropshippingSupplierOffers } from '@/lib/dslite/supplier-policy';

export {
  choosePreferredOffer,
  normalizeOfferPriority,
  resolvePreferredOfferForProduct,
} from '@/lib/preferred-offer';

export type ProdutoFornecedorOfertaRow = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'];
export type SupplierPaymentMode = 'postpaid' | 'prepaid_pix' | 'balance_account';
export type SupplierPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export function inferSupplierPaymentMode(_fornecedorId: string | number | null | undefined): SupplierPaymentMode {
  return 'prepaid_pix';
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
    fornecedor_preferencial_manual: boolean;
    custo: number;
    estoque: number;
    fornecedor: string | null;
    dslite_fornecedor_id: string | null;
    dslite_produto_id: string | null;
    dslite_ultima_sync: string | null;
  };
  next: {
    oferta_preferencial_id: string | null;
    fornecedor_preferencial_manual: boolean;
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
      .select('id,sku,ml_item_id,ml_status,oferta_preferencial_id,fornecedor_preferencial_manual,custo,estoque,fornecedor,dslite_fornecedor_id,dslite_produto_id,dslite_ultima_sync')
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
  for (const offer of filterAllowedDropshippingSupplierOffers(
    (offers || []) as ProdutoFornecedorOfertaRow[],
  )) {
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
      fornecedor_preferencial_manual: boolean;
      custo: number;
      estoque: number;
      fornecedor: string | null;
      dslite_fornecedor_id: string | null;
      dslite_produto_id: string | null;
      dslite_ultima_sync: string | null;
    };
    next: {
      oferta_preferencial_id: string | null;
      fornecedor_preferencial_manual: boolean;
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
    const requestedPreferredOfferId = String((product as any).oferta_preferencial_id || '').trim();
    const manualPreferenceRequested = (product as any).fornecedor_preferencial_manual === true;
    const preferred = resolvePreferredOfferForProduct(
      offersByProductId.get(productId) || [],
      requestedPreferredOfferId,
      manualPreferenceRequested,
    );
    if (!preferred) continue;

    const previous = {
      id: String((product as any).id),
      sku: String((product as any).sku || ''),
      ml_item_id: (product as any).ml_item_id ? String((product as any).ml_item_id) : null,
      ml_status: (product as any).ml_status ? String((product as any).ml_status) : null,
      oferta_preferencial_id: (product as any).oferta_preferencial_id ? String((product as any).oferta_preferencial_id) : null,
      fornecedor_preferencial_manual: (product as any).fornecedor_preferencial_manual === true,
      custo: Number((product as any).custo || 0),
      estoque: Number((product as any).estoque || 0),
      fornecedor: (product as any).fornecedor ? String((product as any).fornecedor) : null,
      dslite_fornecedor_id: (product as any).dslite_fornecedor_id ? String((product as any).dslite_fornecedor_id) : null,
      dslite_produto_id: (product as any).dslite_produto_id ? String((product as any).dslite_produto_id) : null,
      dslite_ultima_sync: (product as any).dslite_ultima_sync ? String((product as any).dslite_ultima_sync) : null,
    };

    const next = {
      oferta_preferencial_id: String((preferred as any).id || '').trim() || null,
      fornecedor_preferencial_manual: manualPreferenceRequested
        && String((preferred as any).id || '').trim() === requestedPreferredOfferId,
      custo: Number(preferred.custo || 0),
      estoque: Number(preferred.estoque || 0),
      fornecedor: preferred.fornecedor_nome ? String(preferred.fornecedor_nome) : previous.fornecedor,
      dslite_fornecedor_id: String(preferred.dslite_fornecedor_id || ''),
      dslite_produto_id: String(preferred.dslite_produto_id || ''),
      dslite_ultima_sync: preferred.last_sync_at || previous.dslite_ultima_sync,
    };

    const changed =
      (previous.oferta_preferencial_id || '') !== (next.oferta_preferencial_id || '') ||
      previous.fornecedor_preferencial_manual !== next.fornecedor_preferencial_manual ||
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
