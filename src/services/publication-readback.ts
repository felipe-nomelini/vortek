import 'server-only';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from './integration';
import { getCategoryAttributes, getCategorySaleTerms } from './mercadolibre';
import { assessMlProductIdentity, loadMlIdentityKit } from '@/lib/ml-critical-attributes';
import { isMlIdentityComplete } from '@/lib/ml-listing-identity';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { loadProductWarranty } from './product-warranty';
import { warrantySaleTerms } from '@/lib/product-warranty';
import { persistSingleAnuncioBySku } from '@/lib/ml/persist-single-anuncio';
import { loadPricingDetail } from './pricing-detail';
import { resolveProductMlLinks, persistProductMlGroups } from './ml-listing-links';
import { pricingReadbackMatches } from '@/lib/ml/pricing-execution';

/** Reconciliation never POSTs/PUTs the listing, description, price or status. */
export async function verifyCreatedPublication(client: ReturnType<typeof createServiceClient>, operation: any, preparation: any, sellerId: string) {
  const itemResponse = await fetchMLResult<any>('/items/' + encodeURIComponent(operation.item_id));
  const item = itemResponse.data;
  if (!itemResponse.ok || item?.id !== operation.item_id || !pricingReadbackMatches(item, sellerId, operation.new_price_cents)
    || !['active', 'paused'].includes(item.status) || item.sub_status?.includes('picture_download_pending')
    || !Array.isArray(item.pictures) || !item.pictures.length
    || item.category_id !== preparation.payload.category_id || item.listing_type_id !== preparation.payload.listing_type_id
    || item.condition !== preparation.payload.condition || item.available_quantity !== preparation.capacity
    || item.shipping?.mode !== preparation.input.shipping.mode || item.shipping?.logistic_type !== preparation.input.shipping.logisticType
    || item.shipping?.free_shipping !== preparation.input.shipping.freeShipping) return false;
  const [productResult, offers, attrs, terms, description, warranty, kit, supplierIds] = await Promise.all([
    client.from('produtos').select('*').eq('id', operation.produto_id).single(),
    client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', operation.produto_id),
    getCategoryAttributes(item.category_id), getCategorySaleTerms(item.category_id),
    fetchMLResult<any>('/items/' + encodeURIComponent(item.id) + '/description'),
    loadProductWarranty(client, operation.produto_id), loadMlIdentityKit(client, operation.produto_id),
    loadOperationalDropshippingSupplierIds(client),
  ]);
  const product = productResult.data;
  if (productResult.error || offers.error || !attrs || !terms || !product || !product.ativo
    || (product.ml_item_id && product.ml_item_id !== item.id)
    || !description.ok || description.data?.plain_text?.replace(/\r\n/g, '\n') !== preparation.description.replace(/\r\n/g, '\n')
    || warranty.resolution.revision !== preparation.warrantyRevision) return false;
  const expectedWarranty = warrantySaleTerms(warranty.resolution, terms);
  if (!expectedWarranty.compatible || expectedWarranty.terms.some(term => !item.sale_terms?.some((actual: any) =>
    actual.id === term.id && (term.value_id ? actual.value_id === term.value_id : actual.value_name === term.value_name)))) return false;
  const identity = assessMlProductIdentity(item, product, offers.data || [], supplierIds, {
    categoryAttributes: attrs, kit, remoteEvidence: { source: 'mercado_livre', reference: item.id,
      collectedAt: new Date().toISOString(), condition: 'valid' },
  });
  if (!isMlIdentityComplete(identity)) return false;
  const persisted = await persistSingleAnuncioBySku(client, {
    ml_item_id: item.id, produto_id: product.id, sku: product.sku, titulo: item.title,
    preco_ml: item.price, vendidos: item.sold_quantity, status: item.status === 'active' ? 'ativo' : 'pausado',
    thumbnail: item.thumbnail || null, permalink: item.permalink || null,
  }, new Date().toISOString());
  if (!persisted.ok) throw new Error('publication_projection_failed');
  const quote = await loadPricingDetail({ produtoId: product.id, mlItemId: item.id, priceCents: operation.new_price_cents }, { actorId: operation.actor_id });
  if (!quote.ok) return false;
  const result = await quote.json();
  const memory = result.pricing?.current.memory;
  if (result.pricing?.revalidation?.status !== 'queried' || !memory || memory.revenueCents !== operation.new_price_cents
    || result.pricing.current.status === 'inconclusive' || !Number.isSafeInteger(memory.resultCents)
    || !Number.isFinite(memory.margin) || !Number.isFinite(memory.band?.floor)
    || memory.margin < memory.band.floor || memory.resultCents < 0 || result.automaticPricing?.active) return false;
  const links = await resolveProductMlLinks(client, product, Number(sellerId));
  if (links.coverage !== 'complete' || !links.groups.length || !links.candidates.some(c => c.itemId === item.id && c.identity === 'complete')) return false;
  await persistProductMlGroups(client, product.id, Number(sellerId), links, new Date().toISOString());
  const linked = await client.from('produtos').update({ ml_item_id: item.id,
    ml_status: item.status === 'active' ? 'ativo' : 'pausado' }).eq('id', product.id).eq('ativo', true)
    .or(`ml_item_id.is.null,ml_item_id.eq.${item.id}`).select('id');
  if (linked.error || linked.data?.length !== 1) throw new Error('publication_product_link_conflict');
  return true;
}
