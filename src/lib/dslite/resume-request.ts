type ResumeFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export async function requestDsliteResume(input: {
  urls: string[];
  headers: Record<string, string>;
  body: string;
  fetcher?: ResumeFetch;
}): Promise<{ json: any; error: string | null }> {
  const fetcher = input.fetcher || fetch;
  let lastNetworkError: string | null = null;

  for (const url of input.urls) {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return { json, error: null };

      return {
        json: null,
        error: json?.error || `HTTP ${response.status}`,
      };
    } catch (err: any) {
      lastNetworkError = err?.message || "fetch failed";
    }
  }

  return {
    json: null,
    error:
      lastNetworkError ||
      "Falha ao retomar o fluxo DSLite após confirmar o pagamento",
  };
}
