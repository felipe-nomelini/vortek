export type OrderFulfillmentSource = 'internal' | 'supplier';

export type OrderFulfillmentSelection = {
  source: OrderFulfillmentSource;
  selectedAt: string | null;
  selectedNow: boolean;
};

export type OrderFulfillmentSelectionErrorCode =
  | 'conflict'
  | 'invalid_source'
  | 'migration_missing'
  | 'not_found'
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
): Promise<OrderFulfillmentSelection> {
  const { data, error } = await client.rpc('select_order_fulfillment', {
    p_pedido_id: pedidoId,
    p_source: source,
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
  if (error.code === 'conflict') return 409;
  if (error.code === 'invalid_source') return 400;
  return 500;
}
