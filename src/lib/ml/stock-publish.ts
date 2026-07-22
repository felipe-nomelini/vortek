import { fetchMLResult } from '@/services/integration';

type MlStockLocation = {
  type?: string;
  store_id?: string | number;
  network_node_id?: string;
  quantity?: number;
};

export type MlStockContext = {
  warehouseManagement: boolean;
};

export type MlStockPublishResult = {
  ok: boolean;
  method: 'items' | 'seller_warehouse' | 'none';
  code?: string;
  error?: string;
  observedQuantity?: number;
  userProductId?: string;
};

/** Detecta se a conta exige estoque por depósitos antes de publicar quantidade. */
export async function loadMlStockContext(): Promise<MlStockContext | null> {
  const result = await fetchMLResult<{ tags?: string[] }>('/users/me');
  if (!result.ok || !result.data) return null;
  const tags = new Set((result.data.tags || []).map((tag) => String(tag).toLowerCase()));
  return { warehouseManagement: tags.has('warehouse_management') };
}

function stockQuantity(locations: MlStockLocation[], type: string): number {
  return locations
    .filter((location) => String(location.type || '') === type)
    .reduce((total, location) => total + Math.max(0, Math.trunc(Number(location.quantity || 0))), 0);
}

async function publishSingleWarehouseStock(
  userProductId: string,
  quantity: number,
): Promise<MlStockPublishResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const current = await fetchMLResult<{ locations?: MlStockLocation[] }>(`/user-products/${userProductId}/stock`);
    if (!current.ok || !current.data) {
      return {
        ok: false,
        method: 'seller_warehouse',
        code: current.error?.code || 'ml_stock_read_failed',
        error: current.error?.message || 'Falha ao consultar estoque do User Product',
        userProductId,
      };
    }

    const locations = (current.data.locations || []).filter((location) => location.type === 'seller_warehouse');
    if (locations.length !== 1 || !locations[0].store_id || !locations[0].network_node_id) {
      return {
        ok: false,
        method: 'seller_warehouse',
        code: 'ml_stock_warehouse_mapping_required',
        error: `User Product possui ${locations.length} depósitos editáveis; configure mapeamento antes de distribuir estoque`,
        userProductId,
      };
    }

    const version = current.headers?.['x-version'];
    if (!version) {
      return {
        ok: false,
        method: 'seller_warehouse',
        code: 'ml_stock_version_missing',
        error: 'Mercado Livre não retornou x-version do estoque',
        userProductId,
      };
    }

    const location = locations[0];
    const update = await fetchMLResult<{ locations?: MlStockLocation[] }>(
      `/user-products/${userProductId}/stock/type/seller_warehouse`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-version': version },
        body: JSON.stringify({
          locations: [{
            store_id: String(location.store_id),
            network_node_id: String(location.network_node_id),
            quantity,
          }],
        }),
      },
    );

    if (!update.ok) {
      if (update.status === 409 && attempt === 1) continue;
      return {
        ok: false,
        method: 'seller_warehouse',
        code: update.error?.code || 'ml_stock_update_failed',
        error: update.error?.message || 'Falha ao atualizar estoque por depósito',
        userProductId,
      };
    }

    const verified = await fetchMLResult<{ locations?: MlStockLocation[] }>(`/user-products/${userProductId}/stock`);
    const observedQuantity = verified.ok && verified.data
      ? stockQuantity(verified.data.locations || [], 'seller_warehouse')
      : -1;
    if (observedQuantity !== quantity) {
      return {
        ok: false,
        method: 'seller_warehouse',
        code: 'ml_stock_reconcile_mismatch',
        error: `Estoque final no ML (${observedQuantity}) difere do desejado (${quantity})`,
        observedQuantity,
        userProductId,
      };
    }

    return { ok: true, method: 'seller_warehouse', observedQuantity, userProductId };
  }

  return { ok: false, method: 'seller_warehouse', code: 'ml_stock_conflict', error: 'Conflito ao atualizar estoque' };
}

/** Publica e confirma estoque real; HTTP 2xx sem quantidade aplicada não é sucesso. */
export async function publishAndVerifyMlStock(
  itemId: string,
  desiredQuantity: number,
  context: MlStockContext,
): Promise<MlStockPublishResult> {
  const quantity = Math.max(0, Math.trunc(Number(desiredQuantity || 0)));

  if (context.warehouseManagement) {
    const item = await fetchMLResult<{ user_product_id?: string }>(`/items/${itemId}`);
    const userProductId = String(item.data?.user_product_id || '').trim();
    if (!item.ok || !userProductId) {
      return {
        ok: false,
        method: 'none',
        code: item.error?.code || 'ml_user_product_missing',
        error: item.error?.message || 'Anúncio sem user_product_id para estoque multiorigem',
      };
    }
    return publishSingleWarehouseStock(userProductId, quantity);
  }

  const update = await fetchMLResult(`/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available_quantity: quantity }),
  });
  if (!update.ok) {
    return {
      ok: false,
      method: 'items',
      code: update.error?.code || 'ml_stock_update_failed',
      error: update.error?.message || 'Falha ao publicar estoque no ML',
    };
  }

  const verified = await fetchMLResult<{ available_quantity?: number }>(`/items/${itemId}`);
  const observedQuantity = verified.ok && verified.data
    ? Math.max(0, Math.trunc(Number(verified.data.available_quantity || 0)))
    : -1;
  if (observedQuantity !== quantity) {
    return {
      ok: false,
      method: 'items',
      code: 'ml_stock_reconcile_mismatch',
      error: `Estoque final no ML (${observedQuantity}) difere do desejado (${quantity})`,
      observedQuantity,
    };
  }

  return { ok: true, method: 'items', observedQuantity };
}
