import { NextResponse } from "next/server";
import { requireMobileUser } from "@/lib/mobile-auth";
import { mobilePermissionsForRole } from "@/lib/mobile-permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      data: {
        user: auth.user,
        permissions: mobilePermissionsForRole(auth.user.role),
      },
      error: null,
      meta: { requestId: auth.requestId },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": auth.requestId,
      },
    },
  );
}
