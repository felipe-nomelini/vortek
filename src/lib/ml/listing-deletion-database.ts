type ServiceClientLike = {
  from: (table: string) => any;
};

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
  const primaryProductIds = new Set(
    (primaryProducts || []).map((row: any) => String(row.id || '').trim()).filter(Boolean),
  );

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
    const { data: remainingListings, error: remainingError } = await client
      .from('anuncios_ml')
      .select('ml_item_id,status')
      .eq('produto_id', productId)
      .order('status', { ascending: true });
    if (remainingError) throw new Error(remainingError.message);
    if ((remainingListings || []).length === 0) {
      const { error: statusError } = await client
        .from('produtos')
        .update({ ml_status: 'sem_anuncio' })
        .eq('id', productId);
      if (statusError) throw new Error(statusError.message);
    } else if (primaryProductIds.has(productId)) {
      const survivor = (remainingListings || []).find(
        (row: any) => String(row.status || '').trim().toLowerCase() === 'ativo',
      ) || remainingListings[0];
      const { error: survivorError } = await client
        .from('produtos')
        .update({
          ml_item_id: survivor.ml_item_id,
          ml_status: survivor.status,
        })
        .eq('id', productId)
        .is('ml_item_id', null);
      if (survivorError) throw new Error(survivorError.message);
    }
  }

  return { productIds };
}
