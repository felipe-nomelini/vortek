import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import { parseBearerToken } from "@/lib/mobile-auth-token";
import { requireMobileUser } from "@/lib/mobile-auth";
import {
  hasMobilePermission,
  type MobilePermission,
} from "@/lib/mobile-permissions";

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

/**
 * Preserva sessão web por cookie e aceita sessão móvel por Bearer.
 * Permissão móvel sempre é validada no servidor.
 */
export async function authorizeApiRequest(
  request: Request,
  mobilePermission: MobilePermission,
): Promise<ApiRequestAuthResult> {
  const bearerToken = parseBearerToken(request.headers.get("authorization"));

  if (bearerToken) {
    const auth = await requireMobileUser(request);
    if (!auth.ok) return { ok: false, response: auth.response };

    if (!hasMobilePermission(auth.user.role, mobilePermission)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            data: null,
            error: {
              code: "PERMISSION_DENIED",
              message: "Seu cargo não permite esta operação",
            },
            meta: { requestId: auth.requestId },
          },
          {
            status: 403,
            headers: {
              "Cache-Control": "no-store",
              "X-Request-Id": auth.requestId,
            },
          },
        ),
      };
    }

    return { ok: true, source: "mobile", userId: auth.user.id };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { erro: "Não autenticado" },
        { status: 401 },
      ),
    };
  }

  return { ok: true, source: "web", userId: user.id };
}
