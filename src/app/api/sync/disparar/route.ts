import { NextResponse } from 'next/server';
import { asSyncDispatchBody, resolveSyncTaskKeys } from '@/lib/sync/dispatch-request';
import { createClient } from '@/lib/supabase';
import { dispatchSyncTasks } from '@/services/sync-dispatch';

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  try {
    const body = asSyncDispatchBody(await request.json().catch(() => ({})));
    const taskKeys = resolveSyncTaskKeys(body);
    if (taskKeys.length === 0) {
      return NextResponse.json({ erro: 'Nenhuma task válida informada (use taskKey, taskKeys ou tipo).' }, { status: 400 });
    }

    const outcome = await dispatchSyncTasks({
      requestBody: body,
      taskKeys,
      origin: {
        kind: 'manual_ui',
        source: 'api/sync/disparar',
        actorUserId: user.id,
      },
    });
    const { httpStatus, ...response } = outcome;
    return NextResponse.json(response, { status: httpStatus });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao disparar sync';
    return NextResponse.json({ erro: message }, { status: 500 });
  }
}
