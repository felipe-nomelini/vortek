import { fetchMLResult } from '@/services/integration';
import { getCategoryAttributes } from '@/services/mercadolibre';
import { buildMlItemsBulkPath, getMlItemsBulkBody } from '@/lib/ml/items-bulk';
import { assessMlProductIdentity, loadMlIdentityKit } from '@/lib/ml-critical-attributes';
import { isMlExistingListingIdentitySafe, hasConfirmedMlIdentityConflict } from '@/lib/ml-listing-identity';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { classifyListingLinks, type ListingLinkCandidate, type ListingLinkResult } from '@/lib/ml/listing-link';
import type { ConflictEvidence } from '@/types/commercial-conflicts';

/** Não confundir retorno vazio válido com consulta indisponível. Ambos os locais oficiais de SKU. */
export async function searchListingIdsBySkus(sellerId: number, skus: string[]) {
  const ids = new Set<string>(); const evidence: ConflictEvidence[] = [];
  let complete = true;
  for (const sku of [...new Set(skus.map(s => s.trim()).filter(Boolean))]) for (const field of ['sku', 'seller_sku']) {
    let offset = 0;
    for (;;) {
      const response = await fetchMLResult<any>(`/users/${sellerId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100&offset=${offset}`);
      const data = response.data;
      if (!response.ok || !Array.isArray(data?.results) || !data.results.every((id: unknown) => typeof id === 'string' && /^ML[A-Z]\d+$/.test(id)) || !Number.isSafeInteger(data?.paging?.total) || data.paging.total < 0) { complete = false; break; }
      for (const id of data.results) if (typeof id === 'string') ids.add(id);
      if (offset + data.results.length >= data.paging.total) {
        evidence.push({ source: 'mercado_livre', reference: `seller:${sellerId}/${field}:${sku}`, collectedAt: new Date().toISOString(), condition: 'valid' }); break;
      }
      if (!data.results.length || offset + data.results.length >= 1000) { complete = false; break; }
      offset += data.results.length;
    }
  }
  return { ids: [...ids], complete, evidence };
}

type Client = { from: (table: string) => any };
export async function resolveProductMlLinks(client: Client, product: any, sellerId: number): Promise<ListingLinkResult> {
  const [offersResult, listingsResult, snapshotsResult, kit, operationalIds] = await Promise.all([
    client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', product.id),
    client.from('anuncios_ml').select('ml_item_id,produto_id').eq('produto_id', product.id),
    client.from('catalogo_ml_snapshot').select('ml_item_id,produto_id,seller_id').eq('produto_id', product.id),
    loadMlIdentityKit(client, product.id), loadOperationalDropshippingSupplierIds(client),
  ]);
  if (offersResult.error || listingsResult.error || snapshotsResult.error) throw new Error('listing_link_local_read_failed');
  const offers = offersResult.data || [];
  const productSkus = [product.sku, ...offers.flatMap((o: any) => [o.sku_oferta, o.sku_fornecedor])].filter(Boolean).map((sku: string) => sku.trim());
  const search = await searchListingIdsBySkus(sellerId, productSkus);
  const ids = new Set<string>([...search.ids, product.ml_item_id, ...listingsResult.data.map((r: any) => r.ml_item_id), ...snapshotsResult.data.map((r: any) => r.ml_item_id)].filter(Boolean));
  const items = new Map<string, any>(); const attempted = new Set<string>(); let complete = search.complete;
  // Relações podem estar fora do lote observado: consulta em lotes, sem truncar ao primeiro par.
  while ([...ids].some(id => !attempted.has(id))) {
    const batch = [...ids].filter(id => !attempted.has(id)).slice(0, 20);
    batch.forEach(id => attempted.add(id));
    const response = await fetchMLResult<any[]>(buildMlItemsBulkPath(batch));
    if (!response.ok || !Array.isArray(response.data)) { complete = false; continue; }
    for (const row of response.data) {
      let item = getMlItemsBulkBody<any>(row);
      if (!item || !batch.includes(item.id)) { complete = false; continue; }
      if (Array.isArray(item.variations) && item.variations.length) {
        // Atributos de variação: contrato documentado para consulta individual, não presumido no bulk.
        const full = await fetchMLResult<any>(`/items/${encodeURIComponent(item.id)}?include_attributes=all`);
        if (!full.ok || full.data?.id !== item.id) { complete = false; continue; }
        item = full.data;
      }
      items.set(item.id, item);
      if (Number(item.seller_id) === sellerId && Array.isArray(item.item_relations)) for (const rel of item.item_relations) if (typeof rel?.id === 'string') ids.add(rel.id);
    }
    if (batch.some(id => !items.has(id))) complete = false;
  }
  const candidateIds = [...items.keys()];
  const ownership = new Map<string, string>();
  for (let offset = 0; offset < candidateIds.length; offset += 100) {
    const batchIds = candidateIds.slice(offset, offset + 100);
    const [listings, snapshots, pointers] = await Promise.all([
      client.from('anuncios_ml').select('ml_item_id,produto_id').in('ml_item_id', batchIds),
      client.from('catalogo_ml_snapshot').select('ml_item_id,produto_id').in('ml_item_id', batchIds),
      client.from('produtos').select('id,ml_item_id').in('ml_item_id', batchIds),
    ]);
    if (listings.error || snapshots.error || pointers.error) throw new Error('listing_link_ownership_read_failed');
    const owners = [...(listings.data || []), ...(snapshots.data || []), ...(pointers.data || []).map((row: any) => ({ ml_item_id: row.ml_item_id, produto_id: row.id }))];
    for (const row of owners) if (row.produto_id) {
      // Uma fonte apontando para outro produto não pode ser apagada pela próxima linha.
      if (!ownership.has(row.ml_item_id) || row.produto_id !== product.id) ownership.set(row.ml_item_id, row.produto_id);
    }
  }
  const categoryPromises = new Map<string, ReturnType<typeof getCategoryAttributes>>();
  const candidates: ListingLinkCandidate[] = [];
  for (const item of items.values()) {
    const categoryId = String(item.category_id || '');
    if (!categoryPromises.has(categoryId)) categoryPromises.set(categoryId, getCategoryAttributes(categoryId));
    const attributes = await categoryPromises.get(categoryId);
    const evidence: ConflictEvidence = { source: 'mercado_livre', reference: item.id, collectedAt: new Date().toISOString(), condition: 'valid' };
    const variations = Array.isArray(item.variations) ? item.variations : [];
    const matching = variations.filter((v: any) => productSkus.includes(String(v.seller_custom_field || v.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || '').trim()));
    const variationId = matching.length === 1 ? String(matching[0].id) : '';
    const identity = assessMlProductIdentity(item, product, offers, operationalIds, { categoryAttributes: attributes || null, kit, variationId: variationId || null, remoteEvidence: evidence });
    const relationsKnown = Array.isArray(item.item_relations);
    const relations = (relationsKnown ? item.item_relations : []).map((r: any) => ({ itemId: String(r.id || ''), variationId: r.variation_id == null ? '' : String(r.variation_id) }));
    let sync: ListingLinkCandidate['sync'] = { status: 'UNKNOWN', relations: [] };
    if (relations.length && Number(item.seller_id) === sellerId) {
      const result = await fetchMLResult<any>(`/public/buybox/sync/${encodeURIComponent(item.id)}`);
      if (result.ok && result.data?.item_id === item.id && ['SYNC', 'UNSYNC'].includes(result.data.status) && Array.isArray(result.data.relations) && result.data.relations.every((id: unknown) => typeof id === 'string')) {
        sync = { status: result.data.status, relations: [...new Set<string>(result.data.relations)].sort(), evidence: {
          source: 'mercado_livre', reference: `buybox/sync/${item.id}`, collectedAt: new Date().toISOString(), condition: 'valid',
        } };
      }
    }
    candidates.push({ itemId: item.id, variationId, catalog: item.catalog_listing === true,
      sellerId: Number(item.seller_id), productId: ownership.get(item.id) || null, status: String(item.status || ''), relations, sync, evidence,
      identity: !relationsKnown || (variations.length && !variationId) ? 'pending' : isMlExistingListingIdentitySafe(identity) ? 'complete' : hasConfirmedMlIdentityConflict(identity) ? 'conflict' : 'pending' });
  }
  return classifyListingLinks({ sellerId, productId: product.id, candidates, complete, searchEvidence: search.evidence });
}

export async function persistProductMlGroups(client: { rpc: (fn: 'reconcile_ml_pricing_groups', args: any) => any }, productId: string, sellerId: number, result: Pick<ListingLinkResult, 'coverage' | 'groups'>, observedAt: string) {
  const { data, error } = await client.rpc('reconcile_ml_pricing_groups', {
    p_seller_id: sellerId, p_product_id: productId, p_observed_at: observedAt,
    p_complete: result.coverage === 'complete', p_groups: result.groups,
  });
  if (error) throw new Error('listing_group_persistence_failed');
  return data;
}
