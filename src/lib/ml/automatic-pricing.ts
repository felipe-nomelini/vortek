import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { resolveAutomaticPricingProductIds } from '@/lib/ml/automatic-pricing-selection';
import { shouldSupplierOfferBeInactiveByCost } from '@/lib/product-activity';
import { loadPricingTaxContext, requirePricingTaxRate } from '@/services/pricing-tax-context';
import { loadCommercialPricingConfiguration } from '@/services/commercial-pricing-configuration';
import { resolveMlFee } from '@/lib/commercial-pricing';

type ServiceClientLike = { from: (table: string) => any };

export type CostSnapshot = {
  productId: string;
  previous: { custo: number };
  next: { custo: number };
};

export type AutomaticPricingResult = {
  productsUpdated: number;
  outboxEnqueued: number;
  skipped: number;
  errors: Array<{ productId: string; message: string }>;
};

/** Recalcula preço quando custo muda; kits podem forçar reconciliação da fonte vigente. */
export async function enqueueAutomaticPricesForCostChanges(
  client: ServiceClientLike,
  snapshots: CostSnapshot[],
  options: { forceProductIds?: string[] } = {},
): Promise<AutomaticPricingResult> {
  const result: AutomaticPricingResult = { productsUpdated: 0, outboxEnqueued: 0, skipped: 0, errors: [] };
  const productIds = resolveAutomaticPricingProductIds(snapshots, options.forceProductIds);
  if (productIds.length === 0) return result;
  const [pricingTaxContext, commercial] = await Promise.all([
    loadPricingTaxContext(client as any),
    loadCommercialPricingConfiguration(client as any),
  ]);
  const taxRate = requirePricingTaxRate(pricingTaxContext);

  const [{ data: products, error: productsError }, { data: listings, error: listingsError }] = await Promise.all([
    client
      .from('produtos')
      .select('id,sku,ativo,ml_item_id,ml_status,custo,custom_price,ml_fee,ml_shipping,ml_shipping_warning')
      .in('id', productIds),
    client
      .from('anuncios_ml')
      .select('produto_id,ml_item_id')
      .in('produto_id', productIds),
  ]);
  if (productsError) throw new Error(`Falha ao carregar produtos para preço automático: ${productsError.message}`);
  if (listingsError) throw new Error(`Falha ao carregar anúncios para preço automático: ${listingsError.message}`);

  const targetsByProduct = new Map<string, Set<string>>();
  for (const product of products || []) {
    const productId = String(product.id || '');
    const target = new Set<string>();
    const itemId = String(product.ml_item_id || '').trim();
    if (itemId) target.add(itemId);
    targetsByProduct.set(productId, target);
  }
  for (const listing of listings || []) {
    const productId = String(listing.produto_id || '');
    const itemId = String(listing.ml_item_id || '').trim();
    if (productId && itemId) (targetsByProduct.get(productId) || new Set<string>()).add(itemId);
    if (productId && !targetsByProduct.has(productId)) targetsByProduct.set(productId, new Set(itemId ? [itemId] : []));
  }

  const itemIds = Array.from(new Set(Array.from(targetsByProduct.values()).flatMap((items) => Array.from(items))));
  const skus = (products || []).map((product: any) => String(product.sku || '').trim()).filter(Boolean);
  const [blockedItemsResponse, blockedSkusResponse] = await Promise.all([
    itemIds.length > 0
      ? client.from('ml_manual_blocklist').select('ml_item_id').eq('ativo', true).in('ml_item_id', itemIds)
      : Promise.resolve({ data: [] }),
    skus.length > 0
      ? client.from('ml_manual_blocklist').select('sku').eq('ativo', true).in('sku', skus)
      : Promise.resolve({ data: [] }),
  ]);
  if (blockedItemsResponse.error) {
    throw new Error(`Falha ao consultar bloqueios manuais por anúncio: ${blockedItemsResponse.error.message}`);
  }
  if (blockedSkusResponse.error) {
    throw new Error(`Falha ao consultar bloqueios manuais por SKU: ${blockedSkusResponse.error.message}`);
  }
  const blockedItems = blockedItemsResponse.data;
  const blockedSkus = blockedSkusResponse.data;
  const blockedItemSet = new Set((blockedItems || []).map((row: any) => String(row.ml_item_id || '').trim()));
  const blockedSkuSet = new Set((blockedSkus || []).map((row: any) => String(row.sku || '').trim().toUpperCase()));

  for (const product of products || []) {
    const productId = String(product.id || '');
    const targets = Array.from(targetsByProduct.get(productId) || []);
    const cost = Number(product.custo || 0);
    const warning = String(product.ml_shipping_warning || '').trim();
    const publishable = product.ativo !== false && ['ativo', 'pausado'].includes(String(product.ml_status || ''));
    if (!publishable || targets.length === 0 || cost <= 0 || shouldSupplierOfferBeInactiveByCost(cost, commercial.inactiveCostThreshold) || warning) {
      result.skipped += 1;
      continue;
    }

    let desiredPrice: number;
    try {
      desiredPrice = calculateSuggestedPrice({
        cost,
        shipping: Number(product.ml_shipping || 0),
        mlFee: resolveMlFee(product.ml_fee, commercial.mlFeeFallbackRate),
        taxRate,
        costTiers: commercial.costTiers,
      }).suggestedPrice;
    } catch (error: any) {
      result.errors.push({ productId, message: error?.message || 'Falha ao calcular preço automático' });
      continue;
    }

    const { error: updateError } = await client
      .from('produtos')
      .update({ custom_price: desiredPrice, updated_at: new Date().toISOString() })
      .eq('id', productId);
    if (updateError) {
      result.errors.push({ productId, message: updateError.message });
      continue;
    }
    result.productsUpdated += 1;

    const skuBlocked = blockedSkuSet.has(String(product.sku || '').trim().toUpperCase());
    for (const mlItemId of targets) {
      if (skuBlocked || blockedItemSet.has(mlItemId)) {
        result.skipped += 1;
        continue;
      }
      const queued = await enqueueMlPublishOutbox(client, {
        produtoId: productId,
        mlItemId,
        desiredPrice,
        source: 'dslite_price_automation',
        dedupePending: true,
        payload: {
          apply_price: true,
          apply_quantity_pricing: true,
          apply_quantity: false,
          apply_status: false,
          base_price_for_quantity_pricing: desiredPrice,
          previous_cost: Number(snapshots.find((snapshot) => snapshot.productId === productId)?.previous.custo || 0),
          current_cost: cost,
          calculated_at: new Date().toISOString(),
        },
      });
      if (queued.ok) {
        if (queued.action === 'skipped_ineligible') result.skipped += 1;
        else if (queued.action !== 'unchanged') result.outboxEnqueued += 1;
      } else {
        result.errors.push({ productId, message: queued.error });
      }
    }
  }

  return result;
}
