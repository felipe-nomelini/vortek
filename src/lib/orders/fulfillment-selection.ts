export type OrderFulfillmentSource = 'internal' | 'supplier';

export type OrderFulfillmentSelection = {
  source: OrderFulfillmentSource;
  selectedAt: string | null;
  selectedNow: boolean;
};

export type OrderFulfillmentStockItem = {
  produtoId: string;
  sku: string;
  quantidade: number;
};

export type OrderFulfillmentSelectionErrorCode =
  | 'conflict'
  | 'invalid_source'
  | 'invalid_stock_items'
  | 'insufficient_stock'
  | 'migration_missing'
  | 'not_found'
  | 'reservation_conflict'
  | 'database';

export class OrderFulfillmentSelectionError extends Error {
  readonly code: OrderFulfillmentSelectionErrorCode;
  readonly selectedSource: OrderFulfillmentSource | null;

  constructor(
    code: OrderFulfillmentSelectionErrorCode,
    message: string,
    selectedSource: OrderFulfillmentSource | null = null,
  ) {
    super(message);
    this.name = 'OrderFulfillmentSelectionError';
    this.code = code;
    this.selectedSource = selectedSource;
  }
}

function normalizeSource(value: unknown): OrderFulfillmentSource | null {
  return value === 'internal' || value === 'supplier' ? value : null;
}

export function canSelectOrderFulfillment(
  selectedSource: unknown,
  requestedSource: OrderFulfillmentSource,
): boolean {
  const normalized = normalizeSource(selectedSource);
  return normalized === null || normalized === requestedSource;
}

export function parseOrderFulfillmentSelectionError(error: any): OrderFulfillmentSelectionError {
  const message = String(error?.message || 'Falha ao selecionar origem do pedido');
  const conflict = message.match(/fulfillment_conflict:(internal|supplier)/);
  if (conflict) {
    const selectedSource = normalizeSource(conflict[1]);
    return new OrderFulfillmentSelectionError(
      'conflict',
      selectedSource === 'internal'
        ? 'Pedido já selecionado para envio pelo estoque interno.'
        : 'Pedido já selecionado para envio pelo fornecedor DSLite.',
      selectedSource,
    );
  }
  const insufficientStock = message.match(/internal_stock_insufficient:(.*):(\d+)/);
  if (insufficientStock) {
    return new OrderFulfillmentSelectionError(
      'insufficient_stock',
      `Estoque interno insuficiente para ${insufficientStock[1]}. Disponível: ${insufficientStock[2]}.`,
    );
  }
  if (message.includes('internal_stock_reservation_conflict')) {
    return new OrderFulfillmentSelectionError(
      'reservation_conflict',
      'A reserva existente do pedido não corresponde aos itens atuais.',
      'internal',
    );
  }
  if (
    message.includes('invalid_internal_stock_items')
    || message.includes('internal_stock_product_not_found')
  ) {
    return new OrderFulfillmentSelectionError(
      'invalid_stock_items',
      'Não foi possível resolver todos os itens do pedido para o estoque interno.',
    );
  }
  if (message.includes('order_not_found') || String(error?.code || '') === 'P0002') {
    return new OrderFulfillmentSelectionError('not_found', 'Pedido não encontrado.');
  }
  if (message.includes('invalid_fulfillment_source') || String(error?.code || '') === '22023') {
    return new OrderFulfillmentSelectionError('invalid_source', 'Origem de atendimento inválida.');
  }
  if (['PGRST202', '42883', '42703'].includes(String(error?.code || ''))) {
    return new OrderFulfillmentSelectionError(
      'migration_missing',
      'Migration de seleção da origem do pedido ainda não foi aplicada.',
    );
  }
  return new OrderFulfillmentSelectionError('database', message);
}

export async function selectOrderFulfillment(
  client: any,
  pedidoId: string,
  source: OrderFulfillmentSource,
  stockItems?: OrderFulfillmentStockItem[],
): Promise<OrderFulfillmentSelection> {
  const { data, error } = await client.rpc('select_order_fulfillment', {
    p_pedido_id: pedidoId,
    p_source: source,
    p_items: source === 'internal'
      ? (stockItems || []).map((item) => ({
          produto_id: item.produtoId,
          sku: item.sku,
          quantidade: item.quantidade,
        }))
      : null,
  });
  if (error) throw parseOrderFulfillmentSelectionError(error);

  const row = Array.isArray(data) ? data[0] : data;
  const selectedSource = normalizeSource(row?.fulfillment_source);
  if (!selectedSource) {
    throw new OrderFulfillmentSelectionError(
      'database',
      'Banco não confirmou a origem selecionada para o pedido.',
    );
  }
  return {
    source: selectedSource,
    selectedAt: row?.fulfillment_selected_at ? String(row.fulfillment_selected_at) : null,
    selectedNow: Boolean(row?.selected_now),
  };
}

export function fulfillmentSelectionHttpStatus(error: unknown): number {
  if (!(error instanceof OrderFulfillmentSelectionError)) return 500;
  if (error.code === 'not_found') return 404;
  if (error.code === 'migration_missing') return 503;
  if (error.code === 'conflict' || error.code === 'reservation_conflict') return 409;
  if (error.code === 'insufficient_stock' || error.code === 'invalid_stock_items') return 422;
  if (error.code === 'invalid_source') return 400;
  return 500;
}
