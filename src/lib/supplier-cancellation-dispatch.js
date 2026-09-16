const PICKUP_SUBSTATUSES = new Set([
  'dropped_off', 'picked_up', 'authorized_by_carrier', 'in_hub', 'in_packing_list',
]);

export function classifySupplierDispatchHistory(history, shipmentId) {
  const base = { source: 'ml_history', shipmentId: String(shipmentId || ''), checkedAt: new Date().toISOString() };
  if (!Array.isArray(history) || history.length === 0 || !base.shipmentId) {
    return { dispatch: 'unknown', evidence: { ...base, proof: 'unverified' } };
  }
  const events = history.map((entry) => ({
    status: String(entry?.status || '').toLowerCase(),
    substatus: String(entry?.substatus || '').toLowerCase(),
    date: String(entry?.date || ''),
  }));
  if (events.some((entry) => !entry.status || !Number.isFinite(Date.parse(entry.date)))) {
    return { dispatch: 'unknown', evidence: { ...base, proof: 'unverified' } };
  }
  const pickup = events.find((entry) => ['shipped', 'delivered'].includes(entry.status)
    || (entry.status === 'ready_to_ship' && PICKUP_SUBSTATUSES.has(entry.substatus)));
  if (pickup) {
    return { dispatch: 'dispatched', evidence: { ...base, proof: 'dispatch_history',
      eventAt: pickup.date, eventStatus: pickup.status, eventSubstatus: pickup.substatus } };
  }
  const cancellation = events.find((entry) => entry.status === 'cancelled');
  if (cancellation) {
    return { dispatch: 'not_dispatched', evidence: { ...base, proof: 'cancelled_history',
      eventAt: cancellation.date, eventStatus: cancellation.status } };
  }
  return { dispatch: 'unknown', evidence: { ...base, proof: 'unverified' } };
}
