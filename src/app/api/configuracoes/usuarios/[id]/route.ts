import { NextResponse } from 'next/server';
import type { Database } from '@/types/database';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';

type UserRole = Database['public']['Enums']['user_role'];

const VALID_ROLES = new Set<UserRole>(['admin', 'gerente', 'operador', 'visualizador']);

function normalizeRole(value: unknown): UserRole | null {
  const role = String(value || '').trim().toLowerCase() as UserRole;
  return VALID_ROLES.has(role) ? role : null;
}

function isActiveFromBannedUntil(value: string | undefined): boolean {
  if (!value) return true;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return true;
  return time <= Date.now();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const userId = String(id || '').trim();
  if (!userId) {
    return NextResponse.json({ erro: 'Usuário inválido' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const serviceClient = createServiceClient();

  if (typeof body?.ativo === 'boolean') {
    if (userId === admin.user.id && body.ativo === false) {
      return NextResponse.json(
        { erro: 'Você não pode desativar seu próprio usuário' },
        { status: 422 },
      );
    }

    const { data, error } = await serviceClient.auth.admin.updateUserById(userId, {
      ban_duration: body.ativo ? 'none' : '876000h',
    });

    if (error || !data.user) {
      return NextResponse.json(
        { erro: error?.message || 'Falha ao atualizar status do usuário' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      usuario: {
        id: data.user.id,
        ativo: isActiveFromBannedUntil(data.user.banned_until),
        banned_until: data.user.banned_until || null,
      },
    });
  }

  const nome = String(body?.nome || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const senha = String(body?.senha || '');
  const avatarUrl = String(body?.avatar_url || '').trim() || null;
  const cargo = normalizeRole(body?.cargo);

  if (!nome || !email || !cargo) {
    return NextResponse.json(
      { erro: 'Nome, e-mail e cargo são obrigatórios' },
      { status: 400 },
    );
  }

  if (senha && senha.length < 6) {
    return NextResponse.json(
      { erro: 'Senha deve ter pelo menos 6 caracteres' },
      { status: 422 },
    );
  }

  const authPayload: { email: string; password?: string; user_metadata: { nome: string } } = {
    email,
    user_metadata: { nome },
  };
  if (senha) authPayload.password = senha;

  const { data: authData, error: authError } = await serviceClient.auth.admin.updateUserById(
    userId,
    authPayload,
  );

  if (authError || !authData.user) {
    return NextResponse.json(
      { erro: authError?.message || 'Falha ao atualizar autenticação do usuário' },
      { status: 500 },
    );
  }

  const { error: profileError } = await serviceClient
    .from('profiles')
    .update({
      nome,
      cargo,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    return NextResponse.json({ erro: profileError.message }, { status: 500 });
  }

  return NextResponse.json({
    usuario: {
      id: authData.user.id,
      nome,
      email,
      cargo,
      avatar_url: avatarUrl,
      ativo: isActiveFromBannedUntil(authData.user.banned_until),
      banned_until: authData.user.banned_until || null,
      created_at: authData.user.created_at,
      last_sign_in_at: authData.user.last_sign_in_at || null,
    },
  });
}
