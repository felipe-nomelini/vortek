export const DSLITE_LABEL_FORM_FIELD = 'etiqueta';

interface DsliteFetchFailureLike {
  code: string;
  message: string;
  status: number | null;
}

export type DslitePurchasePageResolution<T> =
  | {
      ok: true;
      data: T;
      error: null;
      httpStatus: 200;
    }
  | {
      ok: false;
      data: null;
      error: {
        code: string;
        message: string;
        upstream_status: number | null;
      };
      httpStatus: 502 | 503 | 504;
    };

export function resolveDslitePurchasePageResult<T extends { pedidos: unknown[] }>(result: {
  data: T | null;
  failure: DsliteFetchFailureLike | null;
}): DslitePurchasePageResolution<T> {
  if (result.failure) {
    const httpStatus = ['dslite_timeout', 'dslite_connect_timeout'].includes(result.failure.code)
      ? 504
      : result.failure.code === 'dslite_config_missing'
        ? 503
        : 502;

    return {
      ok: false,
      data: null,
      error: {
        code: result.failure.code,
        message: result.failure.message,
        upstream_status: result.failure.status,
      },
      httpStatus,
    };
  }

  if (!result.data || !Array.isArray(result.data.pedidos)) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'dslite_pedidos_invalid_payload',
        message: 'DSLite retornou uma resposta de pedidos inválida',
        upstream_status: null,
      },
      httpStatus: 502,
    };
  }

  return {
    ok: true,
    data: result.data,
    error: null,
    httpStatus: 200,
  };
}

export function isDsliteCarrierAlreadyConfigured(
  currentCarrierId: unknown,
  expectedCarrierId: string | number,
): boolean {
  const current = String(currentCarrierId ?? '').trim();
  const expected = String(expectedCarrierId).trim();
  return current.length > 0 && current === expected;
}
