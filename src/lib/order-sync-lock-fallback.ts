type OrderSyncResult = {
  status: number;
  data?: unknown;
};

function hasDomainLockConflict(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const errors = (data as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    errors.some(
      (error) =>
        error &&
        typeof error === "object" &&
        String((error as { code?: unknown }).code || "") ===
          "domain_lock_conflict",
    )
  );
}

export function canReuseExistingOrderSnapshot(params: {
  syncResult: OrderSyncResult;
  snapshotIncomplete: boolean;
  itemCount: number;
}): boolean {
  return (
    params.syncResult.status === 409 &&
    hasDomainLockConflict(params.syncResult.data) &&
    !params.snapshotIncomplete &&
    params.itemCount > 0
  );
}
