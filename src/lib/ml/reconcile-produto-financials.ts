import type { Database } from '@/types/database';
import { fetchMLResult } from '@/services/integration';

type ServiceClientLike = {
  from: (table: string) => any;
};

type ProdutoFinancialRow = Pick<
  Database['public']['Tables']['produtos']['Row'],
  'id' | 'ml_item_id' | 'ml_fee' | 'ml_shipping'
>;

type MlListingLike = {
  id?: string | number | null;
  price?: number | null;
  category_id?: string | null;
  listing_type_id?: string | null;
  shipping?: {
    logistic_type?: string | null;
    mode?: string | null;
  } | null;
};

type FinancialSnapshot = {
  mlFee: number | null;
  mlShipping: number | null;
  price: number | null;
  categoryId: string | null;
  listingTypeId: string | null;
  logisticType: string | null;
  sellerZip: string | null;
  feeSourceStatus: 'resolved' | 'unavailable';
  shippingSourceStatus: 'resolved' | 'unavailable';
};

const DEFAULT_LISTING_TYPE = 'gold_pro';

let sellerZipCache: { value: string | null; expiresAt: number } | null = null;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFeeRate(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed > 1 ? round2(parsed / 100) : round2(parsed);
}

async function getSellerZipCode(): Promise<string | null> {
  if (sellerZipCache && sellerZipCache.expiresAt > Date.now()) {
    return sellerZipCache.value;
  }

  const meResult = await fetchMLResult<any>('/users/me');
  const zipCode = meResult.ok && meResult.data?.address?.zip_code
    ? String(meResult.data.address.zip_code).trim()
    : null;

  sellerZipCache = {
    value: zipCode,
    expiresAt: Date.now() + (10 * 60 * 1000),
  };

  return zipCode;
}

async function ensureItemContext(item: MlListingLike | null | undefined, mlItemId: string): Promise<MlListingLike | null> {
  const hasContext = Boolean(
    item
    && item.price !== null
    && item.price !== undefined
    && item.category_id
    && item.listing_type_id
  );

  if (hasContext) return item || null;

  const itemResult = await fetchMLResult<any>(`/items/${mlItemId}`);
  if (!itemResult.ok || !itemResult.data) return null;
  return itemResult.data;
}

export async function resolveMlListingFinancialSnapshot(
  itemInput: MlListingLike | null | undefined,
): Promise<FinancialSnapshot | null> {
  const mlItemId = String(itemInput?.id || '').trim();
  if (!mlItemId) return null;

  const item = await ensureItemContext(itemInput, mlItemId);
  if (!item) return null;

  const price = toFiniteNumber(item.price);
  const categoryId = item.category_id ? String(item.category_id).trim() : null;
  const listingTypeId = item.listing_type_id ? String(item.listing_type_id).trim() : DEFAULT_LISTING_TYPE;
  const logisticType = item.shipping?.logistic_type ? String(item.shipping.logistic_type).trim() : null;

  let mlFee: number | null = null;
  let feeSourceStatus: FinancialSnapshot['feeSourceStatus'] = 'unavailable';
  if (price !== null && categoryId) {
    const listingPriceParams = new URLSearchParams({
      price: String(price),
      category_id: categoryId,
      listing_type_id: listingTypeId,
    });
    if (logisticType) listingPriceParams.set('logistic_type', logisticType);

    const listingPricesResult = await fetchMLResult<any>(`/sites/MLB/listing_prices?${listingPriceParams.toString()}`);
    if (listingPricesResult.ok && listingPricesResult.data) {
      mlFee = normalizeFeeRate(
        listingPricesResult.data?.sale_fee_details?.percentage_fee
        ?? listingPricesResult.data?.sale_fee_details?.meli_percentage_fee
        ?? null,
      );
      if (mlFee !== null) {
        feeSourceStatus = 'resolved';
      } else {
        console.warn(JSON.stringify({
          event: 'ml_produto_financials_fee_unavailable',
          timestamp_utc: new Date().toISOString(),
          ml_item_id: mlItemId,
          reason: 'missing_percentage_fee',
          listing_type_id: listingTypeId,
          category_id: categoryId,
          logistic_type: logisticType,
        }));
      }
    } else {
      console.warn(JSON.stringify({
        event: 'ml_produto_financials_fee_unavailable',
        timestamp_utc: new Date().toISOString(),
        ml_item_id: mlItemId,
        reason: listingPricesResult.error?.code || 'listing_prices_failed',
        message: listingPricesResult.error?.message || 'Falha ao consultar listing_prices',
        upstream_status: listingPricesResult.status,
        listing_type_id: listingTypeId,
        category_id: categoryId,
        logistic_type: logisticType,
      }));
    }
  } else {
    console.warn(JSON.stringify({
      event: 'ml_produto_financials_fee_unavailable',
      timestamp_utc: new Date().toISOString(),
      ml_item_id: mlItemId,
      reason: 'missing_item_context',
      has_price: price !== null,
      has_category_id: Boolean(categoryId),
      listing_type_id: listingTypeId,
      logistic_type: logisticType,
    }));
  }

  const sellerZip = await getSellerZipCode();
  let mlShipping: number | null = null;
  let shippingSourceStatus: FinancialSnapshot['shippingSourceStatus'] = 'unavailable';
  if (sellerZip) {
    const shippingResult = await fetchMLResult<any>(`/items/${mlItemId}/shipping_options?zip_code=${encodeURIComponent(sellerZip)}`);
    if (shippingResult.ok && shippingResult.data) {
      const options = Array.isArray(shippingResult.data?.options) ? shippingResult.data.options : [];
      const preferred = options.find((option: any) => Number(option?.cost) === 0 && Number.isFinite(Number(option?.list_cost)))
        || options.find((option: any) => Number.isFinite(Number(option?.list_cost)))
        || null;
      mlShipping = preferred ? round2(Number(preferred.list_cost)) : null;
      if (mlShipping !== null) {
        shippingSourceStatus = 'resolved';
      } else {
        console.warn(JSON.stringify({
          event: 'ml_produto_financials_shipping_unavailable',
          timestamp_utc: new Date().toISOString(),
          ml_item_id: mlItemId,
          reason: 'shipping_options_without_list_cost',
          zip_code: sellerZip,
        }));
      }
    } else {
      console.warn(JSON.stringify({
        event: 'ml_produto_financials_shipping_unavailable',
        timestamp_utc: new Date().toISOString(),
        ml_item_id: mlItemId,
        reason: shippingResult.error?.code || 'shipping_options_failed',
        message: shippingResult.error?.message || 'Falha ao consultar shipping_options',
        upstream_status: shippingResult.status,
        zip_code: sellerZip,
      }));
    }
  } else {
    console.warn(JSON.stringify({
      event: 'ml_produto_financials_shipping_unavailable',
      timestamp_utc: new Date().toISOString(),
      ml_item_id: mlItemId,
      reason: 'seller_zip_unavailable',
    }));
  }

  return {
    mlFee,
    mlShipping,
    price,
    categoryId,
    listingTypeId,
    logisticType,
    sellerZip,
    feeSourceStatus,
    shippingSourceStatus,
  };
}

export async function reconcileProdutoMlFinancials(
  client: ServiceClientLike,
  params: {
    produtoId?: string | null;
    mlItemId?: string | null;
    item?: MlListingLike | null;
    source: 'listing_create' | 'publish_reconcile' | 'observed_sync' | 'price_update' | 'financial_backfill';
  },
): Promise<
  | { ok: true; found: false; updated: false; mlItemId: string; financials: FinancialSnapshot | null }
  | { ok: true; found: true; updated: boolean; mlItemId: string; produtoId: string; financials: FinancialSnapshot | null }
  | { ok: false; mlItemId: string; error: string }
> {
  const mlItemId = String(params.mlItemId || params.item?.id || '').trim();
  if (!mlItemId) {
    return { ok: false, mlItemId: '', error: 'ml_item_id ausente para reconciliar produto' };
  }

  const financials = await resolveMlListingFinancialSnapshot({
    ...(params.item || {}),
    id: mlItemId,
  });

  let produto: ProdutoFinancialRow | null = null;
  if (params.produtoId) {
    const { data, error } = await (client
      .from('produtos')
      .select('id, ml_item_id, ml_fee, ml_shipping')
      .eq('id', String(params.produtoId))
      .maybeSingle() as any);
    if (error) {
      return { ok: false, mlItemId, error: error.message };
    }
    produto = (data as ProdutoFinancialRow | null) ?? null;
  } else {
    const { data, error } = await (client
      .from('produtos')
      .select('id, ml_item_id, ml_fee, ml_shipping')
      .eq('ml_item_id', mlItemId)
      .maybeSingle() as any);
    if (error) {
      return { ok: false, mlItemId, error: error.message };
    }
    produto = (data as ProdutoFinancialRow | null) ?? null;
  }

  if (!produto) {
    return { ok: true, found: false, updated: false, mlItemId, financials };
  }

  const patch: Database['public']['Tables']['produtos']['Update'] = {};
  if (financials && financials.mlFee !== null && Math.abs(Number(produto.ml_fee || 0) - financials.mlFee) > 0.0001) {
    patch.ml_fee = financials.mlFee;
  }
  if (financials && financials.mlShipping !== null && Math.abs(Number(produto.ml_shipping || 0) - financials.mlShipping) > 0.009) {
    patch.ml_shipping = financials.mlShipping;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, found: true, updated: false, mlItemId, produtoId: produto.id, financials };
  }

  patch.updated_at = new Date().toISOString();

  const { error: updateError } = await (client
    .from('produtos')
    .update(patch as any)
    .eq('id', produto.id) as any);

  if (updateError) {
    return { ok: false, mlItemId, error: updateError.message };
  }

  console.log(JSON.stringify({
    event: 'ml_produto_financials_reconciled',
    timestamp_utc: new Date().toISOString(),
    source: params.source,
    produto_id: produto.id,
    ml_item_id: mlItemId,
    ml_fee_anterior: Number(produto.ml_fee || 0),
    ml_fee_novo: financials?.mlFee,
    ml_shipping_anterior: Number(produto.ml_shipping || 0),
    ml_shipping_novo: financials?.mlShipping,
  }));

  return { ok: true, found: true, updated: true, mlItemId, produtoId: produto.id, financials };
}
