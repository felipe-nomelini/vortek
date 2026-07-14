import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function POST(request: Request) {
  const { email, senha } = await request.json();

  if (!email || !senha) {
    return NextResponse.json({ erro: 'E-mail e senha são obrigatórios' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    return NextResponse.json({ erro: 'Credenciais inválidas' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  return NextResponse.json(
    {
      user: {
        id: data.user.id,
        email: data.user.email,
        nome: profile?.nome || email.split('@')[0],
        cargo: profile?.cargo || 'operador',
        avatar_url: profile?.avatar_url,
      },
    },
    { headers: response.headers },
  );
}
