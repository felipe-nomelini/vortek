import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { isHomologationFixtureId } from '@/lib/homologation-fixture';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  status: z.enum(['unknown', 'ready', 'blocked', 'cancelled']),
  note: z.string().trim().max(1000),
  expectedStatus: z.enum(['unknown', 'ready', 'blocked', 'cancelled']),
  expectedChangedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().refine((value) => value.status === 'unknown' || value.note.length >= 8, {
  message: 'Informe uma justificativa operacional com pelo menos oito caracteres',
  path: ['note'],
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.supply.manage');
  if (!auth.ok) return auth.response;
  const { id } = await props.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Compra inválida' }, { status: 422 });
  if (isHomologationFixtureId(id)) return NextResponse.json({ error: 'Registro de demonstração protegido' }, { status: 409 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Estado ou justificativa inválidos' }, { status: 422 });

  const client = createServiceClient();
  const { data: purchase, error: readError } = await client.from('compras')
    .select('id,supplier_payment_mode,supplier_payment_status')
    .eq('id', id).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Falha ao consultar compra' }, { status: 500 });
  if (!purchase) return NextResponse.json({ error: 'Compra não encontrada' }, { status: 404 });
  if (purchase.supplier_payment_mode !== 'prepaid_pix' || purchase.supplier_payment_status !== 'pending') {
    return NextResponse.json({ error: 'Somente compras PIX pendentes podem ser classificadas nesta etapa' }, { status: 409 });
  }

  const now = new Date().toISOString();
  let update = client.from('compras').update({
    supply_status: parsed.data.status,
    supply_status_note: parsed.data.note || null,
    supply_status_changed_by: auth.userId,
    supply_status_changed_at: now,
  }).eq('id', id).eq('supply_status', parsed.data.expectedStatus)
    .eq('supplier_payment_mode', 'prepaid_pix').eq('supplier_payment_status', 'pending');
  update = parsed.data.expectedChangedAt
    ? update.eq('supply_status_changed_at', parsed.data.expectedChangedAt)
    : update.is('supply_status_changed_at', null);
  const { data, error } = await update.select('id,supply_status,supply_status_note,supply_status_changed_at,supply_status_changed_by');
  if (error) return NextResponse.json({ error: 'Falha ao atualizar abastecimento' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'A compra mudou. Atualize a tela antes de classificar.' }, { status: 409 });
  return NextResponse.json({ data: data[0] }, { headers: { 'Cache-Control': 'no-store' } });
}
