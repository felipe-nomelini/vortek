import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { createServiceClient } from '@/lib/supabase';

export async function POST(request: Request) {
  const { email, senha, nome, cargo } = await request.json();

  if (!email || !senha || !nome) {
    return NextResponse.json({ erro: 'Nome, e-mail e senha são obrigatórios' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: senha,
  });

  if (authError) {
    return NextResponse.json({ erro: authError.message }, { status: 400 });
  }

  if (!authData.user) {
    return NextResponse.json({ erro: 'Erro ao criar usuário' }, { status: 500 });
  }

  const serviceClient = createServiceClient();
  const { error: profileError } = await serviceClient
    .from('profiles')
    .insert({
      id: authData.user.id,
      nome,
      cargo: cargo || 'operador',
    });

  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ erro: 'Erro ao criar perfil' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: { id: authData.user.id, email, nome, cargo: cargo || 'operador' } });
}
