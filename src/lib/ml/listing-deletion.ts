import { fetchMLResult } from '@/services/integration';
import {
  deleteMlListingPermanentlyWith,
  type DeleteMlListingResult,
} from '@/lib/ml/listing-deletion-core';

export { detachDeletedMlListing } from '@/lib/ml/listing-deletion-database';
export { isMlListingDeleted, isMlListingDeletionPayload } from '@/lib/ml/listing-deletion-state';
export type { DeleteMlListingResult } from '@/lib/ml/listing-deletion-core';

/**
 * Encerra e exclui definitivamente um anúncio, confirmando `sub_status=deleted`.
 * Anúncios `under_review/forbidden` seguem a exceção oficial do Mercado Livre.
 */
export async function deleteMlListingPermanently(
  itemId: string,
): Promise<DeleteMlListingResult> {
  return deleteMlListingPermanentlyWith(fetchMLResult, itemId);
}
