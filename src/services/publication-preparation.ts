import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase';
import { assertAllowedMlCategoryForProduct } from '@/lib/ml-category-guard';
import { assessMlProductIdentity, loadMlIdentityKit } from '@/lib/ml-critical-attributes';
import { isMlIdentityComplete } from '@/lib/ml-listing-identity';
import { buildEvidenceBasedMlDescription } from '@/lib/ml-listing-description';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { loadProductFulfillmentCapacity } from '@/lib/orders/fulfillment-capacity-loader';
import { fiscalStrictSchema } from '@/lib/fiscal-strict';
import { warrantySaleTerms, warrantyDescription, warrantyDescriptionConflicts } from '@/lib/product-warranty';
import { loadProductWarranty } from './product-warranty';
import { getCategoryAttributes, getCategorySaleTerms } from './mercadolibre';
import { fetchMLResult } from './integration';
import { loadPricingDetail } from './pricing-detail';
import { pricingMaterialFingerprint } from './pricing-audit';
import { resolveProductMlLinks } from './ml-listing-links';
import { requireTestPricingAccount, testPricingTransport } from './pricing-execution-access';

const attribute = z.object({ id: z.string().min(1).max(100), value_id: z.string().max(100).optional(),
  value_name: z.string().max(1000).optional() }).strict();
export const publicationInputSchema = z.object({
  produtoId: z.string().uuid(), categoriaId: z.string().regex(/^MLB\d+$/),
  listingType: z.enum(['gold_special', 'gold_pro']), priceCents: z.number().int().positive().safe().optional(),
  description: z.string().max(50000).optional(), attributes: z.array(attribute).max(200),
  sale_terms: z.array(attribute).max(50).default([]), warrantyRevision: z.string().min(1).max(200),
  shipping: z.object({ mode: z.enum(['me2', 'not_specified']), logisticType: z.string().min(1).max(60),
    freeShipping: z.boolean() }).strict(),
}).strict();
export type PublicationInput = z.infer<typeof publicationInputSchema>;

/** Preparation is repeatable and creates no listing. All commercial calculations remain in pricing-detail. */
export async function preparePublication(raw: unknown, actorId: string) {
  const input = publicationInputSchema.parse(raw);
  const sellerId = await requireTestPricingAccount();
  const client = createServiceClient();
  const productResult = await client.from('produtos').select('*').eq('id', input.produtoId).single();
  const product = productResult.data;
  if (productResult.error || !product || !product.ativo || !product.sku?.trim()) throw new Error('publication_product_invalid');
  if (product.ml_item_id) throw new Error('publication_existing_listing');
  await assertAllowedMlCategoryForProduct(product, input.categoriaId);
  const links = await resolveProductMlLinks(client, product, Number(sellerId));
  if (links.classification !== 'NOVO_ANUNCIO_CANDIDATO' || links.candidates.length)
    throw new Error('publication_existing_or_inconclusive_link');
  const [capacity, attrs, terms, warranty, kit, supplierIds, offers, account] = await Promise.all([
    loadProductFulfillmentCapacity(client, product.id), getCategoryAttributes(input.categoriaId), getCategorySaleTerms(input.categoriaId),
    loadProductWarranty(client, product.id), loadMlIdentityKit(client, product.id), loadOperationalDropshippingSupplierIds(client),
    client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', product.id), fetchMLResult<any>('/users/me'),
  ]);
  if (!attrs || !terms || offers.error || !account.ok || String(account.data?.id) !== sellerId)
    throw new Error('publication_evidence_unavailable');
  if (!Number.isSafeInteger(capacity.safe) || capacity.safe < 1) throw new Error('publication_stock_unavailable');
  const fiscal = fiscalStrictSchema.safeParse({ ncm: product.ncm, origem_fiscal: product.origem_fiscal,
    csosn: product.csosn, sku: product.sku, title: product.nome });
  if (!fiscal.success) throw new Error('publication_fiscal_incomplete');
  const warrantyTerms = warrantySaleTerms(warranty.resolution, terms);
  if (!warrantyTerms.compatible || input.warrantyRevision !== warranty.resolution.revision)
    throw new Error('warranty_validation_required');
  if (warrantyDescriptionConflicts(input.description || '', warranty.resolution)) throw new Error('warranty_description_conflict');
  // The category/evidence owner provides warranty. Never accept a different warranty in the submitted attributes.
  if (input.sale_terms.filter(t => t.id.startsWith('WARRANTY_')).some(t => !warrantyTerms.terms.some(v =>
    v.id === t.id && (t.value_id ? t.value_id === v.value_id : t.value_name === v.value_name))))
    throw new Error('warranty_evidence_mismatch');
  const attributes = input.attributes.filter(a => a.id !== 'SELLER_SKU');
  if (new Set(attributes.map(a => a.id)).size !== attributes.length) throw new Error('publication_duplicate_attribute');
  attributes.push({ id: 'SELLER_SKU', value_name: product.sku });
  const identity = assessMlProductIdentity({ attributes, seller_custom_field: product.sku }, product, offers.data || [], supplierIds,
    { categoryAttributes: attrs, kit, remoteEvidence: { source: 'manual_validation', reference: 'publication-preparation:' + product.id,
      collectedAt: new Date().toISOString(), condition: 'valid' } });
  if (!isMlIdentityComplete(identity)) throw new Error('publication_identity_requires_validation');
  const pictures = product.imagens;
  if (!Array.isArray(pictures) || !pictures.length || pictures.length > 12 || pictures.some(p => {
    try { const u = new URL(p); return u.protocol !== 'https:' || !!u.username || !!u.password; } catch { return true; }
  })) throw new Error('publication_images_required');
  const context = { categoryId: input.categoriaId, listingType: input.listingType, condition: 'new', ...input.shipping };
  const quote = async (priceCents?: number) => {
    const response = await loadPricingDetail({ produtoId: product.id, context, ...(priceCents ? { priceCents } : {}) }, { actorId });
    if (!response.ok) throw new Error('publication_economy_unavailable');
    return (await response.json()).pricing;
  };
  let pricing = await quote(input.priceCents);
  if (!input.priceCents && pricing.target.ok) pricing = await quote(pricing.target.evaluation.memory.revenueCents);
  const memory = pricing.current.memory;
  if (pricing.revalidation?.status !== 'queried' || pricing.current.status === 'inconclusive'
    || !memory || !Number.isSafeInteger(memory.revenueCents) || memory.revenueCents <= 0
    || (input.priceCents !== undefined && memory.revenueCents !== input.priceCents)
    || !Number.isSafeInteger(memory.resultCents) || !Number.isFinite(memory.margin) || !Number.isFinite(memory.band?.floor)
    || !pricing.target.ok || !pricing.floor.ok || !pricing.breakEven.ok
    || memory.margin < memory.band.floor || memory.resultCents < 0) throw new Error('publication_economy_inconclusive');
  const expiresAt = new Date(Math.min(Date.now() + 15 * 60 * 1000,
    ...[memory.cost.expiresAt, memory.fee.expiresAt, memory.shipping.expiresAt].filter(Boolean).map(Date.parse))).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) throw new Error('publication_evidence_expired');
  const description = warrantyDescription(buildEvidenceBasedMlDescription(product, input.description), warranty.resolution);
  const payload = {
    ...(account.data.tags?.includes('user_product_seller')
      ? { family_name: 'Item de Teste – Por favor, NÃO OFERTAR!' } : { title: 'Item de Teste – Por favor, NÃO OFERTAR!' }),
    category_id: input.categoriaId, price: memory.revenueCents / 100, currency_id: 'BRL',
    available_quantity: capacity.safe, buying_mode: 'buy_it_now', listing_type_id: input.listingType, condition: 'new',
    attributes, seller_custom_field: product.sku, pictures: pictures.map(source => ({ source })),
    sale_terms: [...input.sale_terms.filter(t => !t.id.startsWith('WARRANTY_')), ...warrantyTerms.terms],
    shipping: { mode: input.shipping.mode, local_pick_up: false, free_shipping: input.shipping.freeShipping },
  };
  const conditional = await fetchMLResult<{ required_attributes: { id: string }[] }>(
    '/categories/' + encodeURIComponent(input.categoriaId) + '/attributes/conditional', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, description: { plain_text: description } }),
    }, testPricingTransport(sellerId));
  if (!conditional.ok || !Array.isArray(conditional.data?.required_attributes)
    || conditional.data.required_attributes.some(required => !required.id || !attributes.some(a =>
      a.id === required.id && Boolean(a.value_id?.trim() || a.value_name?.trim()))))
    throw new Error('publication_conditional_attributes_required');
  const validation = await fetchMLResult('/items/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) }, testPricingTransport(sellerId));
  if (!validation.ok) throw new Error('publication_ml_validation_failed');
  const preparation = { input: { ...input, priceCents: memory.revenueCents }, payload, description,
    warrantyRevision: warranty.resolution.revision, identity, capacity: capacity.safe, fiscal: fiscal.data };
  const fingerprint = createHash('sha256').update(pricingMaterialFingerprint({ sellerId,
    ...preparation, identity: identity.comparisons.map(({ field, local, remote, status, reason }) =>
      ({ field, local, remote, status, reason })), memory })).digest('hex');
  const decisionContext = { operationKind: 'listing_create', sellerId, itemId: null, groupId: null, groupVersion: null,
    previousPriceCents: null, priceCents: memory.revenueCents, executable: true, reasons: [], clearance: null,
    fingerprint, expiresAt, preparation };
  const saved = await client.from('pricing_evaluations').insert({ produto_id: product.id, actor_id: actorId,
    fingerprint, result: { ...pricing, decisionContext } }).select('id').single();
  if (saved.error || !saved.data) throw new Error('publication_preparation_persistence_failed');
  return { evaluationId: saved.data.id, decisionContext, pricing, preparation };
}
