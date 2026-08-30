type LocalMlStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export {
  classifyMlPublishEligibility,
  classifyMlPublishFailure,
  isModifiableMlListingStatus,
  mlNonModifiableBlockReason,
  resolveMlPublishBlockPatch,
} from './publish-eligibility.js';

export type OperationalListingCandidate = {
  ml_item_id: string;
  status?: string | null;
  catalog_listing?: boolean | null;
};

type ServiceClientLike = {
  from: (table: string) => any;
};

function listingRank(candidate: OperationalListingCandidate): number {
  const status = String(candidate.status || '').trim().toLowerCase();
  const catalogPenalty = candidate.catalog_listing === true ? 1 : 0;

  if (status === 'active') return catalogPenalty;
  if (status === 'paused') return 2 + catalogPenalty;
  return 4 + catalogPenalty;
}

/** Prefere anúncio tradicional ativo; `closed` só vence quando não há item vendável. */
export function selectOperationalMlListing<T extends OperationalListingCandidate>(
  candidates: T[],
): T | null {
  return [...candidates]
    .filter((candidate) => String(candidate.ml_item_id || '').trim())
    .sort((a, b) => listingRank(a) - listingRank(b))[0] || null;
}

export function operationalMlStatus(candidate: OperationalListingCandidate | null): LocalMlStatus {
  if (!candidate) return 'sem_anuncio';
  return String(candidate.status || '').trim().toLowerCase() === 'active' ? 'ativo' : 'pausado';
}

/** Mantém `produtos.ml_item_id` apontando para o anúncio operacional observado. */
export async function syncProdutoOperationalListing(
  client: ServiceClientLike,
  produtoId: string,
): Promise<{ changed: boolean; mlItemId: string | null; status: LocalMlStatus }> {
  const { data: candidates, error: candidatesError } = await (client
    .from('catalogo_ml_snapshot')
    .select('ml_item_id,status,catalog_listing')
    .eq('produto_id', produtoId) as any);
  if (candidatesError) throw new Error(candidatesError.message);

  const selected = selectOperationalMlListing((candidates || []) as OperationalListingCandidate[]);
  if (!selected) return { changed: false, mlItemId: null, status: 'sem_anuncio' };

  const mlItemId = String(selected.ml_item_id).trim();
  const status = operationalMlStatus(selected);
  const { data: product, error: productError } = await (client
    .from('produtos')
    .select('ml_item_id,ml_status')
    .eq('id', produtoId)
    .maybeSingle() as any);
  if (productError) throw new Error(productError.message);

  const changed = String(product?.ml_item_id || '').trim() !== mlItemId
    || String(product?.ml_status || '') !== status;
  if (!changed) return { changed: false, mlItemId, status };

  const { error: updateError } = await (client
    .from('produtos')
    .update({ ml_item_id: mlItemId, ml_status: status, updated_at: new Date().toISOString() })
    .eq('id', produtoId) as any);
  if (updateError) throw new Error(updateError.message);

  return { changed: true, mlItemId, status };
}
