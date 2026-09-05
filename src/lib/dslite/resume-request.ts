type ResumeFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export type DsliteResumeResponse = Record<string, unknown> & {
  error?: string;
  jobId?: string;
  deduplicated?: boolean;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'fetch failed';
}

function isResumeResponse(value: unknown): value is DsliteResumeResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function requestDsliteResume(input: {
  urls: string[];
  headers: Record<string, string>;
  body: string;
  fetcher?: ResumeFetch;
}): Promise<{ json: DsliteResumeResponse | null; error: string | null }> {
  const fetcher = input.fetcher || fetch;
  let lastNetworkError: string | null = null;

  for (const url of input.urls) {
    let response: Awaited<ReturnType<ResumeFetch>>;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: input.headers,
        body: input.body,
      });
    } catch (error: unknown) {
      lastNetworkError = getErrorMessage(error);
      continue;
    }

    const json = await response.json().catch(() => null);
    if (!isResumeResponse(json)) {
      return {
        json: null,
        error: `Resposta inválida da retomada DSLite (HTTP ${response.status})`,
      };
    }

    if (response.ok) return { json, error: null };

    return {
      json: null,
      error: typeof json.error === 'string' && json.error.trim()
        ? json.error
        : `HTTP ${response.status}`,
    };
  }

  return {
    json: null,
    error: lastNetworkError || 'Falha ao retomar o fluxo DSLite após confirmar o pagamento',
  };
}
