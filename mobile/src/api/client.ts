import { env } from "@/config/env";
import { supabase } from "@/lib/supabase";

type ApiErrorBody = {
  error?: { code?: string; message?: string } | null;
  meta?: { requestId?: string };
};

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

async function getSessionHeaders(extra: Record<string, string> = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new MobileApiError("Sessão não encontrada", 401, "AUTH_TOKEN_MISSING");
  }
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.access_token}`,
    "X-App-Version": "0.1.0",
    "X-Platform": "android",
    ...extra,
  };
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method: options.method || "GET",
      headers: await getSessionHeaders({
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        "X-Request-Id": requestId,
      }),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const body = (await response.json()) as T & ApiErrorBody;

    if (!response.ok) {
      throw new MobileApiError(
        body.error?.message || "Falha na comunicação com o Vortek",
        response.status,
        body.error?.code,
        body.meta?.requestId || response.headers.get("x-request-id") || undefined,
      );
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiMultipart<T>(path: string, form: FormData): Promise<T> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: "POST",
    headers: await getSessionHeaders({ "X-Request-Id": requestId }),
    body: form,
  });
  const body = (await response.json()) as T & ApiErrorBody;
  if (!response.ok) {
    throw new MobileApiError(
      body.error?.message || "Falha na comunicação com o Vortek",
      response.status,
      body.error?.code,
      body.meta?.requestId || response.headers.get("x-request-id") || undefined,
    );
  }
  return body;
}

export async function getApiDownloadHeaders(): Promise<Record<string, string>> {
  return getSessionHeaders();
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T>(
  path: string,
  options: { body?: unknown; idempotencyKey: string },
): Promise<T> {
  return apiRequest<T>(path, { method: "POST", ...options });
}
