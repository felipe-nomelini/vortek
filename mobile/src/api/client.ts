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

export async function apiGet<T>(path: string): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new MobileApiError("Sessão não encontrada", 401, "AUTH_TOKEN_MISSING");
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "X-App-Version": "0.1.0",
        "X-Platform": "android",
        "X-Request-Id": requestId,
      },
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
