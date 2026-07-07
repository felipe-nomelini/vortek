import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type AdminGuardResult =
  | {
      ok: true;
      user: User;
      cargo: Database['public']['Enums']['user_role'];
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireAdminUser(
  supabase: SupabaseClient<Database>,
): Promise<AdminGuardResult> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('cargo')
    .eq('id', user.id)
    .single();

  if (profileError) {
    return {
      ok: false,
      response: NextResponse.json({ erro: 'Falha ao carregar perfil do usuário' }, { status: 500 }),
    };
  }

  if (profile?.cargo !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ erro: 'Acesso restrito a administradores' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
    cargo: profile.cargo,
  };
}
