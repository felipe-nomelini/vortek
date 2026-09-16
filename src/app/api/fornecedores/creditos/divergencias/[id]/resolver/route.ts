import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { loadSupplierCreditsVisualReview, SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK } from '@/lib/supplier-credits-visual-review';
import { supplierOracleRpcError } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
const bodySchema = z.object({
  versaoEsperada: z.number().int().positive(),
  decisao: z.enum(['no_credit', 'pending_credit', 'compensate']),
  justificativa: z.string().trim().min(10).max(1000),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  if (await loadSupplierCreditsVisualReview()) {
    return NextResponse.json(SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK, { status: 409 });
  }
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Decisão inválida' }, { status: 422 });
  }
  const { data, error } = await createServiceClient().rpc('supplier_oracle_resolve_cancellation', {
    p_case_id: id, p_expected_version: parsed.data.versaoEsperada,
    p_decision: parsed.data.decisao, p_note: parsed.data.justificativa,
    p_actor: auth.user.id,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
