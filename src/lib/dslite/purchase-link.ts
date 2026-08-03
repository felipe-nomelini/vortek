export type DslitePedidoLinkCandidate = {
  id: string;
  dslite_id?: string | null;
  ml_pack_id?: string | null;
  ml_bundle_type?: string | null;
  ml_bundle_parent_item_id?: string | null;
};

export type DslitePedidoLinkResolution = {
  safe: boolean;
  ids: string[];
  reason:
    | 'single_order'
    | 'cart_group'
    | 'virtual_kit_group'
    | 'empty'
    | 'conflicting_dslite_id'
    | 'ambiguous_nfe'
    | 'target_not_in_resolved_group';
};

function normalized(value: unknown): string {
  return String(value || '').trim();
}

/**
 * Aceita vínculo por NF-e somente quando ela identifica um pedido único ou
 * componentes explícitos do mesmo carrinho/kit. Impede fan-out para vendas
 * independentes que receberam a mesma chave fiscal por inconsistência.
 */
export function resolveSafeDslitePedidoLinks(
  candidates: DslitePedidoLinkCandidate[],
  expectedDsliteId: string,
): DslitePedidoLinkResolution {
  const expected = normalized(expectedDsliteId);
  const rows = candidates.filter((row) => normalized(row?.id));
  if (!rows.length) return { safe: false, ids: [], reason: 'empty' };

  const conflictingDsliteId = rows.some((row) => {
    const current = normalized(row.dslite_id);
    return Boolean(current && current !== expected);
  });
  if (conflictingDsliteId) {
    return { safe: false, ids: [], reason: 'conflicting_dslite_id' };
  }

  if (rows.length === 1) {
    return { safe: true, ids: [normalized(rows[0].id)], reason: 'single_order' };
  }

  const types = new Set(rows.map((row) => normalized(row.ml_bundle_type)));
  if (types.size !== 1) {
    return { safe: false, ids: [], reason: 'ambiguous_nfe' };
  }

  const type = Array.from(types)[0];
  if (type === 'cart') {
    const packIds = new Set(rows.map((row) => normalized(row.ml_pack_id)).filter(Boolean));
    if (packIds.size === 1 && rows.every((row) => normalized(row.ml_pack_id))) {
      return { safe: true, ids: rows.map((row) => normalized(row.id)), reason: 'cart_group' };
    }
  }

  if (type === 'virtual_kit') {
    const parentIds = new Set(rows.map((row) => normalized(row.ml_bundle_parent_item_id)).filter(Boolean));
    if (parentIds.size === 1 && rows.every((row) => normalized(row.ml_bundle_parent_item_id))) {
      return { safe: true, ids: rows.map((row) => normalized(row.id)), reason: 'virtual_kit_group' };
    }
  }

  return { safe: false, ids: [], reason: 'ambiguous_nfe' };
}

/**
 * Exige, além da cardinalidade segura, que o pedido alvo pertença ao grupo
 * fiscal resolvido antes de qualquer mutação externa irreversível.
 */
export function resolveSafeDslitePedidoMutation(
  candidates: DslitePedidoLinkCandidate[],
  expectedDsliteId: string,
  targetPedidoId: string,
): DslitePedidoLinkResolution {
  const resolution = resolveSafeDslitePedidoLinks(candidates, expectedDsliteId);
  if (!resolution.safe) return resolution;

  const target = normalized(targetPedidoId);
  if (!target || !resolution.ids.includes(target)) {
    return { safe: false, ids: [], reason: 'target_not_in_resolved_group' };
  }

  return resolution;
}
