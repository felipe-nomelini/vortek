import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import { parseBearerToken } from "@/lib/mobile-auth-token";
import { requireMobileUser } from "@/lib/mobile-auth";
import {
  hasPermission,
  type VortekPermission,
  type VortekRole,
} from "@/lib/permissions";

type AuthorizedRequest = {
  ok: true;
  source: "web" | "mobile";
  userId: string;
};

type UnauthorizedRequest = {
  ok: false;
  response: NextResponse;
};

export type ApiRequestAuthResult = AuthorizedRequest | UnauthorizedRequest;

type RequestPrincipal =
  | {
      source: "mobile";
      userId: string;
      role: VortekRole;
      requestId: string;
    }
  | {
      source: "web";
      userId: string;
      role: VortekRole;
    };

const PERMISSION_DENIED_MESSAGE = "Seu cargo não permite esta operação";

function permissionDeniedResponse(principal: RequestPrincipal): NextResponse {
  if (principal.source === "mobile") {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "PERMISSION_DENIED",
          message: PERMISSION_DENIED_MESSAGE,
        },
        meta: { requestId: principal.requestId },
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": principal.requestId,
        },
      },
    );
  }

  return NextResponse.json(
    { error: PERMISSION_DENIED_MESSAGE },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Preserva as autenticações por cookie e Bearer, mas aplica a mesma matriz de
 * permissões do Vortek independentemente da origem.
 */
export async function authorizeApiRequest(
  request: Request,
  permission: VortekPermission,
): Promise<ApiRequestAuthResult> {
  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  let principal: RequestPrincipal;

  if (bearerToken) {
    const auth = await requireMobileUser(request);
    if (!auth.ok) return { ok: false, response: auth.response };

    principal = {
      source: "mobile",
      userId: auth.user.id,
      role: auth.user.role,
      requestId: auth.requestId,
    };
  } else {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        response: NextResponse.json(
          { erro: "Não autenticado" },
          { status: 401 },
        ),
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("cargo")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Não foi possível validar as permissões do usuário" },
          { status: 500 },
        ),
      };
    }

    if (!profile) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Usuário sem perfil autorizado" },
          { status: 403 },
        ),
      };
    }

    principal = {
      source: "web",
      userId: user.id,
      role: profile.cargo,
    };
  }

  if (!hasPermission(principal.role, permission)) {
    return { ok: false, response: permissionDeniedResponse(principal) };
  }

  return {
    ok: true,
    source: principal.source,
    userId: principal.userId,
  };
}
