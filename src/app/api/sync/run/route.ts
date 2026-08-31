import { NextResponse } from 'next/server';
import { asSyncDispatchBody, resolveSyncTaskKeys } from '@/lib/sync/dispatch-request';
import { dispatchSyncTasks } from '@/services/sync-dispatch';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = asSyncDispatchBody(await request.json().catch(() => ({})));
    const apiKey = request.headers.get('x-api-key') || '';
    if (apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
    }

    const taskKeys = resolveSyncTaskKeys(body);
    if (taskKeys.length === 0) {
      return NextResponse.json({ error: 'Nenhuma task válida informada (use taskKey, taskKeys ou tipo).' }, { status: 400 });
    }

    const outcome = await dispatchSyncTasks({
      requestBody: body,
      taskKeys,
      origin: { kind: 'system', source: 'api/sync/run' },
    });
    const { httpStatus, ...response } = outcome;
    return NextResponse.json(response, { status: httpStatus });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro inesperado no disparo de sync';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
