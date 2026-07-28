import { fetchMLResult } from '@/services/integration';
import {
  isMlListingDeleted,
  isMlListingUnderReviewForbidden,
  type MlItemState,
} from '@/lib/ml/listing-deletion-state';

export { isMlListingDeleted, isMlListingDeletionPayload } from '@/lib/ml/listing-deletion-state';

type ServiceClientLike = {
  from: (table: string) => any;
};

export type DeleteMlListingResult =
  | { ok: true; alreadyDeleted: boolean; item: MlItemState }
  | { ok: false; code: string; error: string; status: number | null };

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encerra e exclui definitivamente um anúncio, confirmando `sub_status=deleted`.
 * Anúncios `under_review/forbidden` seguem a exceção oficial do Mercado Livre.
 */
export async function deleteMlListingPermanently(
  itemId: string,
): Promise<DeleteMlListingResult> {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return { ok: false, code: 'ml_item_id_missing', error: 'ml_item_id ausente', status: null };
  }

  const current = await fetchMLResult<MlItemState>(`/items/${encodeURIComponent(normalizedItemId)}`);
  if (!current.ok || !current.data) {
    return {
      ok: false,
      code: current.error?.code || 'ml_listing_read_failed',
      error: current.error?.message || 'Falha ao consultar anúncio antes da exclusão',
      status: current.status,
    };
  }

  if (isMlListingDeleted(current.data)) {
    return { ok: true, alreadyDeleted: true, item: current.data };
  }

  const status = String(current.data.status || '').trim().toLowerCase();
  if (status !== 'closed' && !isMlListingUnderReviewForbidden(current.data)) {
    const close = await fetchMLResult<MlItemState>(`/items/${encodeURIComponent(normalizedItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    if (!close.ok) {
      // Itens `inactive/under_review` podem rejeitar a troca de status, mas
      // ainda aceitam a exclusão direta. A confirmação final continua obrigatória.
      if (!['inactive', 'under_review'].includes(status)) {
        return {
          ok: false,
          code: close.error?.code || 'ml_listing_close_failed',
          error: close.error?.message || 'Falha ao encerrar anúncio antes da exclusão',
          status: close.status,
        };
      }
    } else {
      await wait(900);
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const deletion = await fetchMLResult<MlItemState>(`/items/${encodeURIComponent(normalizedItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted: true }),
    });
    if (deletion.ok) break;

    const lastDeleteError: DeleteMlListingResult = {
      ok: false,
      code: deletion.error?.code || 'ml_listing_delete_failed',
      error: deletion.error?.message || 'Falha ao excluir anúncio',
      status: deletion.status,
    };
    if (deletion.status !== 409 || attempt === 3) return lastDeleteError;
    await wait(attempt * 900);
  }

  const verified = await fetchMLResult<MlItemState>(`/items/${encodeURIComponent(normalizedItemId)}`);
  if (!verified.ok || !verified.data) {
    return {
      ok: false,
      code: verified.error?.code || 'ml_listing_delete_verify_failed',
      error: verified.error?.message || 'Falha ao confirmar exclusão do anúncio',
      status: verified.status,
    };
  }
  if (!isMlListingDeleted(verified.data)) {
    return {
      ok: false,
      code: 'ml_listing_delete_not_effective',
      error: 'Mercado Livre não confirmou sub_status=deleted',
      status: verified.status,
    };
  }

  return { ok: true, alreadyDeleted: false, item: verified.data };
}

/** Remove referências operacionais depois que o Mercado Livre confirmou a exclusão. */
export async function detachDeletedMlListing(
  client: ServiceClientLike,
  itemId: string,
): Promise<{ productIds: string[] }> {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) throw new Error('ml_item_id ausente para desvincular anúncio');

  const [{ data: listingRows, error: listingError }, { data: primaryProducts, error: productError }] =
    await Promise.all([
      client
        .from('anuncios_ml')
        .select('produto_id')
        .eq('ml_item_id', normalizedItemId),
      client
        .from('produtos')
        .select('id')
        .eq('ml_item_id', normalizedItemId),
    ]);
  if (listingError) throw new Error(listingError.message);
  if (productError) throw new Error(productError.message);

  const productIds = Array.from(new Set([
    ...(listingRows || []).map((row: any) => String(row.produto_id || '').trim()),
    ...(primaryProducts || []).map((row: any) => String(row.id || '').trim()),
  ].filter(Boolean)));

  const { error: outboxError } = await client
    .from('anuncios_ml_outbox')
    .update({
      status: 'cancelled',
      last_error: 'Cancelado: anúncio excluído definitivamente no Mercado Livre',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('ml_item_id', normalizedItemId)
    .in('status', ['pending', 'retry', 'processing']);
  if (outboxError) throw new Error(outboxError.message);

  const [{ error: listingDeleteError }, { error: snapshotDeleteError }, { error: primaryDetachError }] =
    await Promise.all([
      client.from('anuncios_ml').delete().eq('ml_item_id', normalizedItemId),
      client.from('catalogo_ml_snapshot').delete().eq('ml_item_id', normalizedItemId),
      client
        .from('produtos')
        .update({ ml_item_id: null })
        .eq('ml_item_id', normalizedItemId),
    ]);
  if (listingDeleteError) throw new Error(listingDeleteError.message);
  if (snapshotDeleteError) throw new Error(snapshotDeleteError.message);
  if (primaryDetachError) throw new Error(primaryDetachError.message);

  for (const productId of productIds) {
    const { count, error: remainingError } = await client
      .from('anuncios_ml')
      .select('*', { head: true, count: 'exact' })
      .eq('produto_id', productId);
    if (remainingError) throw new Error(remainingError.message);
    if ((count || 0) === 0) {
      const { error: statusError } = await client
        .from('produtos')
        .update({ ml_status: 'sem_anuncio' })
        .eq('id', productId);
      if (statusError) throw new Error(statusError.message);
    }
  }

  return { productIds };
}
