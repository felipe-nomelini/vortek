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

export type DsliteManualUnlinkEvent = {
  pedido_id?: string | null;
  resposta_ml?: unknown;
};

export type DsliteReactivatedOrderReuseResult = {
  safe: boolean;
  reason:
    | 'reactivated_order_match'
    | 'status_not_reusable'
    | 'remote_order_missing'
    | 'remote_dsid_mismatch'
    | 'nfe_key_mismatch'
    | 'purchase_missing'
    | 'purchase_dsid_mismatch'
    | 'purchase_nfe_mismatch'
    | 'supplier_mismatch'
    | 'items_mismatch'
    | DslitePedidoLinkResolution['reason'];
  pedidoIds: string[];
};

type DsliteReactivatedOrderReuseInput = {
  expectedDsliteId: string;
  expectedNfeKey: string;
  expectedItems: Array<{ sku: string; quantity: number }>;
  targetPedidoId: string;
  pedidoCandidates: DslitePedidoLinkCandidate[];
  purchase?: Record<string, unknown> | null;
  remoteOrder?: Record<string, unknown> | null;
};

function normalized(value: unknown): string {
  return String(value || '').trim();
}

function normalizedStatus(value: unknown): string {
  return normalized(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizedItems(
  items: Array<{ sku: unknown; quantity: unknown }>,
): string[] {
  return items
    .map((item) => {
      const sku = normalized(item.sku);
      const quantity = Number(item.quantity);
      if (!sku || !Number.isFinite(quantity) || quantity <= 0) return '';
      return `${sku}::${quantity}`;
    })
    .filter(Boolean)
    .sort();
}

/**
 * Impede que o sincronizador restaure exatamente o vínculo DSLite removido
 * manualmente. Um novo pedido DSLite continua elegível para vínculo.
 */
export function isDsliteRelinkBlockedByManualUnlink(
  events: DsliteManualUnlinkEvent[],
  candidatePedidoIds: string[],
  expectedDsliteId: string,
): boolean {
  const candidateIds = new Set(candidatePedidoIds.map(normalized).filter(Boolean));
  const expected = normalized(expectedDsliteId);
  if (!candidateIds.size || !expected) return false;

  return events.some((event) => {
    if (!candidateIds.has(normalized(event.pedido_id))) return false;
    if (!event.resposta_ml || typeof event.resposta_ml !== 'object' || Array.isArray(event.resposta_ml)) {
      return false;
    }

    const response = event.resposta_ml as Record<string, unknown>;
    return normalized(response.dslite_id_antigo) === expected;
  });
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

/**
 * Permite que uma ação explícita de criação retome um pedido DSLite que foi
 * reativado como "Aguardando Informações". Exige identidade fiscal, comercial
 * e local exatas; o sincronizador automático continua respeitando desvínculos
 * manuais por meio de isDsliteRelinkBlockedByManualUnlink.
 */
export function resolveSafeReactivatedDsliteOrderReuse(
  input: DsliteReactivatedOrderReuseInput,
): DsliteReactivatedOrderReuseResult {
  const expectedDsliteId = normalized(input.expectedDsliteId);
  const expectedNfeKey = normalized(input.expectedNfeKey);
  const remote = input.remoteOrder;
  const purchase = input.purchase;

  if (!remote) {
    return { safe: false, reason: 'remote_order_missing', pedidoIds: [] };
  }
  if (normalizedStatus(remote.status) !== 'aguardando informacoes') {
    return { safe: false, reason: 'status_not_reusable', pedidoIds: [] };
  }
  if (normalized(remote.dsid) !== expectedDsliteId) {
    return { safe: false, reason: 'remote_dsid_mismatch', pedidoIds: [] };
  }

  const remoteNfeKey = normalized(remote.nf_chave || remote.chave_acesso);
  if (!expectedNfeKey || remoteNfeKey !== expectedNfeKey) {
    return { safe: false, reason: 'nfe_key_mismatch', pedidoIds: [] };
  }
  if (!purchase) {
    return { safe: false, reason: 'purchase_missing', pedidoIds: [] };
  }
  if (normalized(purchase.dsid) !== expectedDsliteId) {
    return { safe: false, reason: 'purchase_dsid_mismatch', pedidoIds: [] };
  }
  if (normalized(purchase.nf_chave) !== expectedNfeKey) {
    return { safe: false, reason: 'purchase_nfe_mismatch', pedidoIds: [] };
  }

  const remoteSupplier = remote.fornecedor;
  const remoteSupplierId =
    remoteSupplier && typeof remoteSupplier === 'object' && !Array.isArray(remoteSupplier)
      ? normalized((remoteSupplier as Record<string, unknown>).fornecedorid)
      : '';
  const purchaseSupplierId = normalized(purchase.fornecedor_id);
  if (!remoteSupplierId || !purchaseSupplierId || remoteSupplierId !== purchaseSupplierId) {
    return { safe: false, reason: 'supplier_mismatch', pedidoIds: [] };
  }

  const remoteItemsRaw = Array.isArray(remote.items) ? remote.items : [];
  const expectedItems = normalizedItems(
    input.expectedItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
  );
  const remoteItems = normalizedItems(
    remoteItemsRaw.map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        sku: row.nf_produtoid,
        quantity: row.quantidade,
      };
    }),
  );
  if (
    expectedItems.length === 0 ||
    expectedItems.length !== remoteItems.length ||
    expectedItems.some((item, index) => item !== remoteItems[index])
  ) {
    return { safe: false, reason: 'items_mismatch', pedidoIds: [] };
  }

  const linkResolution = resolveSafeDslitePedidoMutation(
    input.pedidoCandidates,
    expectedDsliteId,
    input.targetPedidoId,
  );
  if (!linkResolution.safe) {
    return {
      safe: false,
      reason: linkResolution.reason,
      pedidoIds: [],
    };
  }

  return {
    safe: true,
    reason: 'reactivated_order_match',
    pedidoIds: linkResolution.ids,
  };
}
