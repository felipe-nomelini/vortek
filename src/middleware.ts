import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  resolveSupabaseAuthCookieName,
  resolveSupabaseServiceUrl,
} from "@/lib/supabase-url";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/fornecedor/bkr1/kits-sem-anuncio" ||
    pathname === "/fornecedor/evolusom/produtos-sem-gtin"
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });
  const serviceUrl = resolveSupabaseServiceUrl();
  const cookieName = resolveSupabaseAuthCookieName();

  const supabase = createServerClient(
    serviceUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: cookieName },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const apiKey = request.headers.get("x-api-key");
  const isSyncRoute = pathname.startsWith("/api/sync/");
  const isInternalJobRoute = pathname === "/api/dslite/pedido";
  const isInternalCatalogRoute = [
    "/api/catalogo/no-catalogo/refresh",
    "/api/catalogo/no-catalogo/refresh/job/worker",
  ].includes(pathname);
  const isMlListingFlowRoute = [
    "/api/ml/anuncio/categorias",
    "/api/ml/anuncio/schema",
    "/api/ml/anuncio/preencher-inteligente",
    "/api/ml/anuncio/criar",
  ].includes(pathname);
  const isApiRoute = pathname.startsWith("/api/");
  const isMobileApiRoute = pathname.startsWith("/api/mobile/");
  const hasBearerToken = /^Bearer\s+\S+$/i.test(
    request.headers.get("authorization") || "",
  );
  const isTvBearerRoute = pathname.startsWith("/api/tv/") && hasBearerToken;
  const isPublicApiRoute =
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/ops/health";

  const isLocalDevMlBatch =
    process.env.NODE_ENV === "development" &&
    isMlListingFlowRoute &&
    request.headers.get("x-local-dev-batch") === "true";

  if (
    ((isSyncRoute ||
      isInternalJobRoute ||
      isInternalCatalogRoute ||
      isMlListingFlowRoute) &&
      apiKey === process.env.API_SECRET_KEY) ||
    isLocalDevMlBatch
  ) {
    return supabaseResponse;
  }

  // Rotas mobile validam Authorization Bearer dentro de cada handler.
  if (
    !user &&
    isApiRoute &&
    !isPublicApiRoute &&
    !isMobileApiRoute &&
    !isTvBearerRoute
  ) {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/s/")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/configuracoes")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("cargo")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.cargo !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
