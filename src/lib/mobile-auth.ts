import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { parseBearerToken } from "@/lib/mobile-auth-token";
import {
  createServiceClient,
  createTokenValidationClient,
} from "@/lib/supabase";
import type { Database } from "@/types/database";

export type MobileUserRole = Database["public"]["Enums"]["user_role"];

export type MobileAuthenticatedUser = {
  id: string;
  email: string | null;
  name: string;
  role: MobileUserRole;
  avatarUrl: string | null;
};

type MobileAuthSuccess = {
  ok: true;
  requestId: string;
  authUser: User;
  user: MobileAuthenticatedUser;
};

type MobileAuthFailure = {
  ok: false;
  requestId: string;
  response: NextResponse;
};

export type MobileAuthResult = MobileAuthSuccess | MobileAuthFailure;

function resolveRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[a-zA-Z0-9_-]{8,80}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function errorResponse(
  requestId: string,
  status: 401 | 403 | 500,
  code: string,
  message: string,
) {
  return NextResponse.json(
    {
      data: null,
      error: { code, message },
      meta: { requestId },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

/**
 * Valida sessão móvel no Supabase Auth e carrega cargo em fonte controlada.
 * Nunca usa user_metadata para autorização.
 */
export async function requireMobileUser(request: Request): Promise<MobileAuthResult> {
  const requestId = resolveRequestId(request);
  const token = parseBearerToken(request.headers.get("authorization"));

  if (!token) {
    return {
      ok: false,
      requestId,
      response: errorResponse(
        requestId,
        401,
        "AUTH_TOKEN_MISSING",
        "Sessão não informada",
      ),
    };
  }

  const authClient = createTokenValidationClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !authUser) {
    return {
      ok: false,
      requestId,
      response: errorResponse(
        requestId,
        401,
        "AUTH_TOKEN_INVALID",
        "Sessão inválida ou expirada",
      ),
    };
  }

  const serviceClient = createServiceClient();
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("nome, cargo, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profileError) {
    console.error("[mobile-auth] Falha ao consultar perfil", {
      requestId,
      userId: authUser.id,
      code: profileError.code,
    });
    return {
      ok: false,
      requestId,
      response: errorResponse(
        requestId,
        500,
        "PROFILE_LOOKUP_FAILED",
        "Não foi possível validar o perfil",
      ),
    };
  }

  if (!profile) {
    return {
      ok: false,
      requestId,
      response: errorResponse(
        requestId,
        403,
        "PROFILE_NOT_FOUND",
        "Usuário sem perfil autorizado",
      ),
    };
  }

  return {
    ok: true,
    requestId,
    authUser,
    user: {
      id: authUser.id,
      email: authUser.email || null,
      name: profile.nome,
      role: profile.cargo,
      avatarUrl: profile.avatar_url,
    },
  };
}
