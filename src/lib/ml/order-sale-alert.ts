export function isMlOrderPaid(order: { status?: unknown } | null | undefined): boolean {
  return String(order?.status || '').trim().toLowerCase() === 'paid';
}
