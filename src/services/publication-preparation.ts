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
import { factoryWarranty, warrantySaleTerms, warrantyDescription, warrantyDescriptionConflicts } from '@/lib/product-warranty';
import { catalogCompatibilityMismatches } from '@/lib/ml-catalog-compatibility';
import { getCategoryAttributes, getCategorySaleTerms } from './mercadolibre';
import { fetchMLResult } from './integration';
import { loadPricingDetail } from './pricing-detail';
import { pricingMaterialFingerprint } from './pricing-audit';
import { resolveProductMlLinks } from './ml-listing-links';
import { requirePricingExecutionAccount, pricingExecutionTransport } from './pricing-execution-access';

const attribute = z.object({ id: z.string().min(1).max(100), value_id: z.string().max(100).optional(),
  value_name: z.string().max(1000).optional() }).strict();
export const publicationInputSchema = z.object({
  produtoId: z.string().uuid(), categoriaId: z.string().regex(/^MLB\d+$/),
  action: z.enum(['new', 'relist']).default('new'),
  sourceItemId: z.string().regex(/^MLB\d+$/).optional(),
  listingType: z.enum(['gold_special', 'gold_pro']), priceCents: z.number().int().positive().safe().optional(),
  description: z.string().max(50000).optional(), attributes: z.array(attribute).max(200),
  sale_terms: z.array(attribute).max(50).default([]),
  shipping: z.object({ mode: z.enum(['me2', 'not_specified']), logisticType: z.string().min(1).max(60),
    freeShipping: z.boolean() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.action === 'relist' && !value.sourceItemId)
    context.addIssue({ code: 'custom', path: ['sourceItemId'], message: 'O anúncio encerrado é obrigatório.' });
  if (value.action === 'new' && value.sourceItemId)
    context.addIssue({ code: 'custom', path: ['sourceItemId'], message: 'Um anúncio novo não possui anúncio de origem.' });
});
export type PublicationInput = z.infer<typeof publicationInputSchema>;

async function resolveExactCatalogProduct(input: {
  product: any; attributes: Array<{ id: string; value_id?: string; value_name?: string }>; categoryId: string;
}) {
  const gtin = String(input.product.gtin || '').replace(/\D/g, '');
  if (!gtin) return null;
  const search = await fetchMLResult<any>(
    `/products/search?site_id=MLB&status=active&product_identifier=${encodeURIComponent(gtin)}`,
  );
  if (!search.ok || !Array.isArray(search.data?.results)) throw new Error('publication_catalog_evidence_unavailable');
  const ids = [...new Set<string>(search.data.results.map((row: any) =>
    String(row?.catalog_product_id || row?.id || '').trim()).filter((id: string) => /^MLB\d+$/.test(id)))];
  if (!ids.length) return null;
  if (ids.length !== 1) throw new Error('publication_catalog_identity_ambiguous');
  const found = await fetchMLResult<any>('/products/' + encodeURIComponent(ids[0]));
  const catalogProduct = found.data;
  if (!found.ok || catalogProduct?.id !== ids[0]
    || String(catalogProduct.status || '').toLowerCase() !== 'active'
    || (catalogProduct.category_id && catalogProduct.category_id !== input.categoryId)
    || (Array.isArray(catalogProduct.children_ids) && catalogProduct.children_ids.length))
    throw new Error('publication_catalog_product_invalid');
  const item = { title: input.product.nome, attributes: input.attributes };
  if (catalogCompatibilityMismatches({ item, catalogProduct, localProduct: input.product }).length)
    throw new Error('publication_catalog_identity_conflict');
  return ids[0];
}

/** Preparation is repeatable and creates no listing. All commercial calculations remain in pricing-detail. */
export async function preparePublication(raw: unknown, actorId: string) {
  const input = publicationInputSchema.parse(raw);
  const execution = await requirePricingExecutionAccount(undefined, 'listing_create');
  const { sellerId } = execution;
  const client = createServiceClient();
  const productResult = await client.from('produtos').select('*').eq('id', input.produtoId).single();
  const product = productResult.data;
  if (productResult.error || !product || !product.ativo || !product.sku?.trim()) throw new Error('publication_product_invalid');
  if (input.action === 'new' && product.ml_item_id) throw new Error('publication_existing_listing');
  if (input.action === 'relist' && product.ml_item_id !== input.sourceItemId)
    throw new Error('publication_relist_source_mismatch');
  await assertAllowedMlCategoryForProduct(product, input.categoriaId);
  const links = await resolveProductMlLinks(client, product, Number(sellerId));
  if (input.action === 'new' && (links.classification !== 'NOVO_ANUNCIO_CANDIDATO' || links.candidates.length))
    throw new Error('publication_existing_or_inconclusive_link');
  const [capacity, attrs, terms, kit, supplierIds, offers, account, sourceResult] = await Promise.all([
    loadProductFulfillmentCapacity(client, product.id), getCategoryAttributes(input.categoriaId), getCategorySaleTerms(input.categoriaId),
    loadMlIdentityKit(client, product.id), loadOperationalDropshippingSupplierIds(client),
    client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', product.id), fetchMLResult<any>('/users/me'),
    input.sourceItemId ? fetchMLResult<any>('/items/' + encodeURIComponent(input.sourceItemId) + '?include_attributes=all') : Promise.resolve(null),
  ]);
  if (!attrs || !terms || offers.error || !account.ok || String(account.data?.id) !== sellerId)
    throw new Error('publication_evidence_unavailable');
  if (!Number.isSafeInteger(capacity.safe) || capacity.safe < 1) throw new Error('publication_stock_unavailable');
  const sourceItem = sourceResult?.data;
  if (input.action === 'relist') {
    const sourceCandidate = links.candidates.find(candidate => candidate.itemId === input.sourceItemId);
    if (!links.discoveryComplete || !sourceResult?.ok || sourceItem?.id !== input.sourceItemId
      || String(sourceItem.seller_id) !== sellerId || sourceItem.status !== 'closed'
      || sourceItem.category_id !== input.categoriaId || sourceItem.currency_id !== 'BRL'
      || sourceCandidate?.identity !== 'complete' || sourceCandidate.status !== 'closed'
      || links.candidates.some(candidate => candidate.itemId !== input.sourceItemId
        && (['active', 'paused'].includes(candidate.status) || candidate.parentItemId === input.sourceItemId)))
      throw new Error('publication_relist_source_invalid');
  }
  const fiscal = fiscalStrictSchema.safeParse({ ncm: product.ncm, origem_fiscal: product.origem_fiscal,
    csosn: product.csosn, sku: product.sku, title: product.nome });
  if (!fiscal.success) throw new Error('publication_fiscal_incomplete');
  const warrantyTerms = warrantySaleTerms(terms);
  if (!warrantyTerms.compatible) throw new Error('warranty_category_incompatible');
  if (warrantyDescriptionConflicts(input.description || '')) throw new Error('warranty_description_conflict');
  // A garantia de fábrica de 12 meses é uma regra comercial da Bentevi.
  if (input.sale_terms.filter(t => t.id.startsWith('WARRANTY_')).some(t => !warrantyTerms.terms.some(v =>
    v.id === t.id && (t.value_id ? t.value_id === v.value_id : t.value_name === v.value_name))))
    throw new Error('warranty_policy_mismatch');
  const attributes = input.attributes.filter(a => a.id !== 'SELLER_SKU');
  if (new Set(attributes.map(a => a.id)).size !== attributes.length) throw new Error('publication_duplicate_attribute');
  attributes.push({ id: 'SELLER_SKU', value_name: product.sku });
  const identity = assessMlProductIdentity({ attributes, seller_custom_field: product.sku }, product, offers.data || [], supplierIds,
    { categoryAttributes: attrs, kit, remoteEvidence: { source: 'manual_validation', reference: 'publication-preparation:' + product.id,
      collectedAt: new Date().toISOString(), condition: 'valid' } });
  if (!isMlIdentityComplete(identity)) throw new Error('publication_identity_requires_validation');
  if (input.action === 'relist') {
    const sourceIdentity = assessMlProductIdentity(sourceItem, product, offers.data || [], supplierIds,
      { categoryAttributes: attrs, kit, remoteEvidence: { source: 'mercado_livre', reference: input.sourceItemId!,
        collectedAt: new Date().toISOString(), condition: 'valid' } });
    if (!isMlIdentityComplete(sourceIdentity)) throw new Error('publication_relist_identity_requires_validation');
  }
  const pictures = product.imagens;
  if (!Array.isArray(pictures) || !pictures.length || pictures.length > 12 || pictures.some(p => {
    try { const u = new URL(p); return u.protocol !== 'https:' || !!u.username || !!u.password; } catch { return true; }
  })) throw new Error('publication_images_required');
  const catalogProductId = input.action === 'new'
    ? await resolveExactCatalogProduct({ product, attributes, categoryId: input.categoriaId })
    : null;
  const context = { categoryId: input.categoriaId, catalogProductId,
    listingType: input.listingType, condition: 'new' as const, ...input.shipping };
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
  const description = warrantyDescription(buildEvidenceBasedMlDescription(product, input.description));
  const listingName = execution.capability.target === 'test'
    ? 'Item de Teste – Por favor, NÃO OFERTAR!'
    : product.nome.trim();
  const expected = {
    ...(account.data.tags?.includes('user_product_seller')
      ? { family_name: listingName } : { title: listingName }),
    category_id: input.categoriaId, price: memory.revenueCents / 100, currency_id: 'BRL',
    available_quantity: capacity.safe, buying_mode: 'buy_it_now', listing_type_id: input.listingType, condition: 'new',
    attributes, seller_custom_field: product.sku, pictures: pictures.map(source => ({ source })),
    sale_terms: [...input.sale_terms.filter(t => !t.id.startsWith('WARRANTY_')), ...warrantyTerms.terms],
    shipping: { mode: input.shipping.mode, local_pick_up: false, free_shipping: input.shipping.freeShipping },
    ...(catalogProductId ? { catalog_product_id: catalogProductId, catalog_listing: true } : {}),
  };
  const payload = input.action === 'relist'
    ? { price: memory.revenueCents / 100, quantity: capacity.safe, listing_type_id: input.listingType }
    : expected;
  const conditional = await fetchMLResult<{ required_attributes: { id: string }[] }>(
    '/categories/' + encodeURIComponent(input.categoriaId) + '/attributes/conditional', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...expected, description: { plain_text: description } }),
    }, pricingExecutionTransport(sellerId));
  if (!conditional.ok || !Array.isArray(conditional.data?.required_attributes)
    || conditional.data.required_attributes.some(required => !required.id || !attributes.some(a =>
      a.id === required.id && Boolean(a.value_id?.trim() || a.value_name?.trim()))))
    throw new Error('publication_conditional_attributes_required');
  if (input.action === 'new') {
    const validation = await fetchMLResult('/items/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) }, pricingExecutionTransport(sellerId));
    if (!validation.ok) throw new Error('publication_ml_validation_failed');
  }
  const preparation = { action: input.action, sourceItemId: input.sourceItemId || null,
    input: { ...input, priceCents: memory.revenueCents }, payload, expected, description,
    warrantyRevision: factoryWarranty.revision, identity, capacity: capacity.safe, fiscal: fiscal.data };
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
