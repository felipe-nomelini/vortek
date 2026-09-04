import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { HAYAMAX_FORNECEDOR_ID } from '@/lib/supplier-balance';
import {
  loadSupplierCreditsVisualReview,
  SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK,
} from '@/lib/supplier-credits-visual-review';

const UPDATE_SCHEMA = z.object({
  status: z.enum(['confirmed', 'rejected']),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const auth = await requireAdminUser(supabase);
  if (!auth.ok) return auth.response;

  if (await loadSupplierCreditsVisualReview()) {
    return NextResponse.json(SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK, { status: 409 });
  }

  const parsed = UPDATE_SCHEMA.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: movement, error: findError } = await service
    .from('supplier_balance_movements')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!movement?.id || movement.fornecedor_id === HAYAMAX_FORNECEDOR_ID) {
    return NextResponse.json({ error: 'Movimentação não encontrada.' }, { status: 404 });
  }
  if (movement.status !== 'pending') {
    return NextResponse.json({ error: 'Movimentação já foi analisada.' }, { status: 409 });
  }

  const actor = auth.user.email || auth.user.id;
  const decisionNote = parsed.data.notes ? `\nDecisão: ${parsed.data.notes}` : '';
  const { data, error } = await service
    .from('supplier_balance_movements')
    .update({
      status: parsed.data.status,
      notes: `${movement.notes || ''}${decisionNote}`.trim() || null,
      confirmed_at: parsed.data.status === 'confirmed' ? new Date().toISOString() : null,
      confirmed_by: actor,
    })
    .eq('id', movement.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data?.id) return NextResponse.json({ error: 'Movimentação já foi analisada.' }, { status: 409 });
  return NextResponse.json({ success: true, movement: data });
}
