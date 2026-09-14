const {
  batchManifestState,
  classifyMlListingUnder70,
  preservesUntouchedListingFields,
} = require('../../src/lib/ml/listing-terms-batch-core.ts');

function failure(code, message, status = null, item = null) {
  return { ok: false, code, error: message, status, item };
}

async function readItem(request, itemId) {
  const result = await request(`/items/${encodeURIComponent(itemId)}`);
  if (!result.ok || !result.data) {
    return failure(
      result.error?.code || 'ml_listing_read_failed',
      result.error?.message || 'Falha ao consultar anúncio',
      result.status,
    );
  }
  return { ok: true, item: result.data };
}

/** Executa cada escrita no máximo uma vez; toda continuação depende de read-back. */
async function normalizeMlListingTermsWith(request, itemId) {
  const initial = await readItem(request, itemId);
  if (!initial.ok) return initial;

  const before = initial.item;
  let classification = classifyMlListingUnder70(before);
  if (!classification.target) {
    return { ok: true, skipped: true, reason: classification.reason, before, item: before };
  }
  if (classification.blockedByMandatoryFreeShipping) {
    return failure(
      'mandatory_free_shipping',
      'Mercado Livre marcou o frete grátis como obrigatório',
      null,
      before,
    );
  }

  let current = before;
  if (classification.needsListingType) {
    const changeType = await request(`/items/${encodeURIComponent(itemId)}/listing_type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'gold_special' }),
    });
    if (!changeType.ok) {
      return failure(
        changeType.error?.code || 'ml_listing_type_change_failed',
        changeType.error?.message || 'Falha ao alterar anúncio para Clássico',
        changeType.status,
        current,
      );
    }

    const afterType = await readItem(request, itemId);
    if (!afterType.ok) return afterType;
    current = afterType.item;
    if (!preservesUntouchedListingFields(before, current)) {
      return failure(
        'ml_listing_unexpected_field_change',
        'Preço, estoque ou título mudou durante a alteração de exposição',
        null,
        current,
      );
    }
    classification = classifyMlListingUnder70(current);
    if (!classification.target || String(current.listing_type_id || '') !== 'gold_special') {
      return failure(
        'ml_listing_type_readback_failed',
        'Mercado Livre não confirmou a exposição Clássico',
        null,
        current,
      );
    }
    if (classification.blockedByMandatoryFreeShipping) {
      return failure(
        'mandatory_free_shipping',
        'Mercado Livre passou a exigir frete grátis após alterar a exposição',
        null,
        current,
      );
    }
  }

  classification = classifyMlListingUnder70(current);
  if (classification.needsBuyerPaidShipping) {
    const changeShipping = await request(`/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipping: { free_shipping: false } }),
    });
    if (!changeShipping.ok) {
      return failure(
        changeShipping.error?.code || 'ml_listing_shipping_change_failed',
        changeShipping.error?.message || 'Falha ao transferir o frete ao comprador',
        changeShipping.status,
        current,
      );
    }

    const afterShipping = await readItem(request, itemId);
    if (!afterShipping.ok) return afterShipping;
    current = afterShipping.item;
    if (!preservesUntouchedListingFields(before, current)) {
      return failure(
        'ml_listing_unexpected_field_change',
        'Preço, estoque ou título mudou durante a alteração de frete',
        null,
        current,
      );
    }
  }

  const finalClassification = classifyMlListingUnder70(current);
  if (finalClassification.reason !== 'already_compliant') {
    return failure(
      'ml_listing_terms_readback_failed',
      'Mercado Livre não confirmou Clássico com frete pago pelo comprador',
      null,
      current,
    );
  }

  return {
    ok: true,
    skipped: false,
    reason: 'confirmed',
    before,
    item: current,
    readback: batchManifestState(current),
  };
}

module.exports = { normalizeMlListingTermsWith };
