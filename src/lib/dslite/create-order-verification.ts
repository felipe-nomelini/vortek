type DsliteCreateFailureLike = {
  failureType?: unknown;
  parsedBody?: unknown;
};

export function isDsliteCreatedOrderVerified(
  payload: unknown,
  expectedDsid: string | number,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const actualDsid = String((payload as { dsid?: unknown }).dsid ?? '').trim();
  return actualDsid.length > 0 && actualDsid === String(expectedDsid).trim();
}

export function canFallbackToSupplierlessCreate(
  failure: DsliteCreateFailureLike,
): boolean {
  if (failure.failureType !== 'invalid_response') return false;
  if (!failure.parsedBody || typeof failure.parsedBody !== 'object') return false;

  const body = failure.parsedBody as {
    sucesso?: unknown;
    erros?: unknown;
    logs?: Array<{ dsid?: unknown }>;
  };
  const hasReturnedDsid = Array.isArray(body.logs)
    && body.logs.some((log) => String(log?.dsid ?? '').trim().length > 0);

  return !hasReturnedDsid
    && Number(body.sucesso) === 0
    && Number(body.erros) > 0;
}
