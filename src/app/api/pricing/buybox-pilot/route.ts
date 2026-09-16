import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  BUYBOX_PILOT_ACTOR_ID,
  evaluateBuyBoxPilotItem,
  executeBuyBoxPilotItem,
  finishBuyBoxPilot,
  initializeBuyBoxPilot,
  summarizeBuyBoxPilot,
} from '@/services/buybox-economics-pilot';

export const maxDuration = 300;

const initialize = z.object({
  action: z.literal('initialize'),
  actorId: z.literal(BUYBOX_PILOT_ACTOR_ID),
  manifestBase64: z.string().min(1),
  screeningBase64: z.string().min(1),
}).strict();
const itemCommand = z.object({
  action: z.enum(['evaluate', 'execute']),
  runId: z.string().uuid(),
  mlItemId: z.string().regex(/^MLB\d+$/),
}).strict();
const summary = z.object({ action: z.literal('summary'), runId: z.string().uuid() }).strict();
const finish = z.object({ action: z.literal('finish'), runId: z.string().uuid(), stopped: z.boolean(),
  errorCode: z.string().trim().max(120).nullable().optional() }).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) return json({ error: 'Não autorizado' }, 401);
  const body = await request.json().catch(() => null);
  const start = initialize.safeParse(body);
  const item = itemCommand.safeParse(body);
  const read = summary.safeParse(body);
  const done = finish.safeParse(body);
  if (!start.success && !item.success && !read.success && !done.success) return json({ error: 'Comando inválido' }, 422);
  try {
    if (start.success) return json(await initializeBuyBoxPilot(start.data));
    if (read.success) return json(await summarizeBuyBoxPilot(read.data.runId));
    if (done.success) return json(await finishBuyBoxPilot(done.data.runId, done.data.stopped, done.data.errorCode));
    if (!item.success) return json({ error: 'Comando inválido' }, 422);
    return json(item.data.action === 'evaluate'
      ? await evaluateBuyBoxPilotItem(item.data.runId, item.data.mlItemId)
      : await executeBuyBoxPilotItem(item.data.runId, item.data.mlItemId));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'buybox_pilot_failed';
    return json({ error: 'O piloto não concluiu esta etapa; nenhuma repetição automática foi feita.', code }, 409);
  }
}
