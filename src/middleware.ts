import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const apiKey = request.headers.get('x-api-key');
  const isSyncRoute = pathname.startsWith('/api/sync/');
  const isApiRoute = pathname.startsWith('/api/');
  const isPublicApiRoute =
    pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/public/')
    || pathname.startsWith('/api/webhooks/')
    || pathname === '/api/ops/health';

  if (isSyncRoute && apiKey === process.env.API_SECRET_KEY) {
    return supabaseResponse;
  }

  if (!user && isApiRoute && !isPublicApiRoute) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/api/') && !pathname.startsWith('/s/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
