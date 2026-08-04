export type MlLabelHttpFailureReason =
  | 'buffered'
  | 'not_ready'
  | 'http_error';

export type MlLabelHttpFailure = {
  reason: MlLabelHttpFailureReason;
  retryable: boolean;
  delivered: boolean;
  invalidCaller: boolean;
};

function parseFailedShipments(text: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.failed_shipments) ? parsed.failed_shipments : [];
  } catch {
    return [];
  }
}

/**
 * Respeita o contrato de erro por shipment do Mercado Livre.
 * `invoice_pending` e `waiting_for_carrier_authorization` são intermediários
 * mesmo quando `shipment_labels` retorna `retry: false`; a etiqueta só fica
 * disponível em `ready_to_print`.
 */
export function classifyMlLabelHttpFailure(
  status: number,
  responseText: string,
): MlLabelHttpFailure {
  const text = String(responseText || '');
  const lowered = text.toLowerCase();
  const failedShipments = parseFailedShipments(text);
  const retryFlags = failedShipments
    .map((shipment) => shipment.retry)
    .filter((value): value is boolean => typeof value === 'boolean');
  const explicitRetry = retryFlags.some(Boolean);
  const explicitNoRetry = retryFlags.length > 0 && retryFlags.every((value) => !value);
  const delivered = failedShipments.some((shipment) =>
    String(shipment.message || '').toLowerCase().includes('status is delivered')
  ) || lowered.includes('status is delivered');
  const invalidCaller =
    lowered.includes('invalid_shipment_caller')
    || lowered.includes('not printable by caller');
  const buffered = lowered.includes('buffered');
  const invoicePending = lowered.includes('invoice_pending');
  const waitingForCarrierAuthorization = lowered.includes(
    'waiting_for_carrier_authorization',
  );
  const notPrintableStatus =
    lowered.includes('not_printable_status')
    || lowered.includes('shplab0200');
  const retryableStatus = [
    404, 408, 409, 423, 424, 425, 429, 500, 502, 503, 504,
  ].includes(status);
  const temporaryNotPrintable =
    notPrintableStatus
    && !delivered
    && (
      invoicePending
      || waitingForCarrierAuthorization
      || (!explicitNoRetry && explicitRetry)
    );

  return {
    reason: buffered
      ? 'buffered'
      : invoicePending || waitingForCarrierAuthorization || temporaryNotPrintable
        ? 'not_ready'
        : 'http_error',
    retryable:
      !invalidCaller
      && !delivered
      && (invoicePending
        || waitingForCarrierAuthorization
        || (!explicitNoRetry && (buffered || temporaryNotPrintable || retryableStatus))),
    delivered,
    invalidCaller,
  };
}
