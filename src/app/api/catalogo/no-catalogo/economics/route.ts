import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE } from '@/lib/catalogo/visible-economics';
import { loadCatalogVisibleEconomics } from '@/services/catalog-visible-economics';

const inputSchema = z.object({
  items: z.array(z.object({
    mlItemId: z.string().regex(/^MLB\d+$/),
    snapshotSyncedAt: z.string().datetime({ offset: true }),
  }).strict()).min(1).max(CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map(item => item.mlItemId)).size !== value.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Anúncios duplicados no lote', path: ['items'] });
  }
});

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Lote de cálculo inválido' }, 422);
  try {
    return json(await loadCatalogVisibleEconomics(createServiceClient(), parsed.data.items));
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'catalog_visible_economics_failed',
      message: error instanceof Error ? error.message : 'unknown', timestamp_utc: new Date().toISOString() }));
    return json({ error: 'Não foi possível calcular os resultados desta página.' }, 503);
  }
}
