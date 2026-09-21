export const EVOLUSOM_ORDER_STATUSES = [
  'Pendente', 'Bloqueado', 'Processando', 'Faturado', 'Cancelado',
] as const;

export type EvolusomOrderStatus = typeof EVOLUSOM_ORDER_STATUSES[number];

export function readEvolusomMerchantOrderStatus(response: unknown, expectedOrderId: number): EvolusomOrderStatus {
  if (!response || typeof response !== 'object') throw new Error('Resposta de status Evolusom inválida');
  const body = response as {
    status?: unknown;
    data?: { pedido_lojista?: { numero?: unknown; status?: unknown } | null } | null;
  };
  if (body.status !== 200 || Number(body.data?.pedido_lojista?.numero) !== expectedOrderId) {
    throw new Error('Resposta de status Evolusom não corresponde ao pedido consultado');
  }
  const status = body.data?.pedido_lojista?.status;
  if (!EVOLUSOM_ORDER_STATUSES.some((value) => value === status)) {
    throw new Error('Estado do pedido Evolusom não reconhecido');
  }
  return status as EvolusomOrderStatus;
}
