import { NextResponse } from 'next/server';
import type { Database } from '@/types/database';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import {
  configurationValidationMessage,
  createUserConfigurationSchema,
} from '@/lib/configuracoes/contracts';
import { recordConfigurationAudit } from '@/services/configuration-audit';

type UserRole = Database['public']['Enums']['user_role'];

function isActiveFromBannedUntil(value: string | undefined): boolean {
  if (!value) return true;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return true;
  return time <= Date.now();
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const {
    data: { users },
    error: usersError,
  } = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (usersError) {
    return NextResponse.json({ erro: usersError.message }, { status: 500 });
  }

  const userIds = users.map((user) => user.id);
  const { data: profiles, error: profilesError } = userIds.length
    ? await serviceClient
        .from('profiles')
        .select('id, nome, cargo, avatar_url')
        .in('id', userIds)
    : { data: [], error: null };

  if (profilesError) {
    return NextResponse.json({ erro: profilesError.message }, { status: 500 });
  }

  const profilesMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  const data = users.map((user) => {
    const profile = profilesMap.get(user.id);
    const email = user.email || '';
    return {
      id: user.id,
      email,
      nome: profile?.nome || user.user_metadata?.nome || email.split('@')[0] || 'Usuário',
      cargo: (profile?.cargo || 'operador') as UserRole,
      avatar_url: profile?.avatar_url || null,
      ativo: isActiveFromBannedUntil(user.banned_until),
      banned_until: user.banned_until || null,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
    };
  });

  return NextResponse.json({ usuarios: data, currentUserId: admin.user.id });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const parsed = createUserConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, 'Dados do usuário inválidos') },
      { status: 422 },
    );
  }
  const { nome, email, senha, cargo } = parsed.data;
  const avatarUrl = parsed.data.avatar_url || null;

  const serviceClient = createServiceClient();
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { erro: createError?.message || 'Falha ao criar usuário' },
      { status: 500 },
    );
  }

  const { error: profileError } = await serviceClient.from('profiles').insert({
    id: created.user.id,
    nome,
    cargo,
    avatar_url: avatarUrl,
  });

  if (profileError) {
    await serviceClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ erro: profileError.message }, { status: 500 });
  }

  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        { key: 'usuarios.nome', targetId: created.user.id, before: null, after: nome, action: 'created' },
        { key: 'usuarios.email', targetId: created.user.id, before: null, after: email, action: 'created' },
        { key: 'usuarios.cargo', targetId: created.user.id, before: null, after: cargo, action: 'created' },
        { key: 'usuarios.avatar_url', targetId: created.user.id, before: null, after: avatarUrl, action: 'created' },
        { key: 'usuarios.senha', targetId: created.user.id, before: null, after: senha, action: 'secret_set', force: true },
        { key: 'usuarios.ativo', targetId: created.user.id, before: null, after: true, action: 'enabled' },
      ],
    );
  } catch {
    return NextResponse.json(
      { erro: 'Usuário criado, mas o histórico administrativo não pôde ser registrado', persisted: true },
      { status: 500 },
    );
  }

  return NextResponse.json({
    usuario: {
      id: created.user.id,
      nome,
      email,
      cargo,
      avatar_url: avatarUrl,
      ativo: true,
      banned_until: null,
      created_at: created.user.created_at,
      last_sign_in_at: created.user.last_sign_in_at || null,
    },
  });
}
