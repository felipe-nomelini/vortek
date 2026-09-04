import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import {
  configurationValidationMessage,
  updateUserConfigurationSchema,
  userIdSchema,
} from '@/lib/configuracoes/contracts';
import { recordConfigurationAudit } from '@/services/configuration-audit';

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
  const parsedUserId = userIdSchema.safeParse(id);
  if (!parsedUserId.success) {
    return NextResponse.json({ erro: 'Usuário inválido' }, { status: 422 });
  }
  const userId = parsedUserId.data;

  const body = await request.json().catch(() => ({}));
  const parsed = updateUserConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, 'Dados do usuário inválidos') },
      { status: 422 },
    );
  }
  const serviceClient = createServiceClient();
  const { data: previousAuth, error: previousAuthError } =
    await serviceClient.auth.admin.getUserById(userId);
  if (previousAuthError || !previousAuth.user) {
    return NextResponse.json(
      { erro: previousAuthError?.message || 'Usuário não encontrado' },
      { status: 404 },
    );
  }

  if ('ativo' in parsed.data) {
    if (userId === admin.user.id && parsed.data.ativo === false) {
      return NextResponse.json(
        { erro: 'Você não pode desativar seu próprio usuário' },
        { status: 422 },
      );
    }

    const { data, error } = await serviceClient.auth.admin.updateUserById(userId, {
      ban_duration: parsed.data.ativo ? 'none' : '876000h',
    });

    if (error || !data.user) {
      return NextResponse.json(
        { erro: error?.message || 'Falha ao atualizar status do usuário' },
        { status: 500 },
      );
    }

    const previousActive = isActiveFromBannedUntil(previousAuth.user.banned_until);
    const currentActive = isActiveFromBannedUntil(data.user.banned_until);
    try {
      await recordConfigurationAudit(
        serviceClient,
        { id: admin.user.id, name: admin.nome },
        [{
          key: 'usuarios.ativo',
          targetId: userId,
          before: previousActive,
          after: currentActive,
          action: currentActive ? 'enabled' : 'disabled',
        }],
      );
    } catch {
      return NextResponse.json(
        { erro: 'Status alterado, mas o histórico administrativo não pôde ser registrado', persisted: true },
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

  const { nome, email, cargo } = parsed.data;
  const senha = parsed.data.senha || '';
  const avatarUrl = parsed.data.avatar_url || null;
  const { data: previousProfile, error: previousProfileError } = await serviceClient
    .from('profiles')
    .select('nome,cargo,avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (previousProfileError) {
    return NextResponse.json({ erro: previousProfileError.message }, { status: 500 });
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

  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        { key: 'usuarios.nome', targetId: userId, before: previousProfile?.nome || previousAuth.user.user_metadata?.nome, after: nome },
        { key: 'usuarios.email', targetId: userId, before: previousAuth.user.email, after: email },
        { key: 'usuarios.cargo', targetId: userId, before: previousProfile?.cargo, after: cargo },
        { key: 'usuarios.avatar_url', targetId: userId, before: previousProfile?.avatar_url, after: avatarUrl },
        ...(senha
          ? [{ key: 'usuarios.senha' as const, targetId: userId, before: true, after: senha, action: 'secret_set' as const, force: true }]
          : []),
      ],
    );
  } catch {
    return NextResponse.json(
      { erro: 'Usuário salvo, mas o histórico administrativo não pôde ser registrado', persisted: true },
      { status: 500 },
    );
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
