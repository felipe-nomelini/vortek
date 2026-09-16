import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { supplierOracleDisabledResponse, supplierOracleRpcError, supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  versaoEsperada: z.number().int().positive(),
  referenciaPix: z.string().trim().max(200).nullable().optional(),
  observacoes: z.string().trim().max(1000).nullable().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.payment.confirm');
  if (!auth.ok) return auth.response;
  if (!supplierOracleWritesEnabled()) return supplierOracleDisabledResponse();
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Confirmação inválida' }, { status: 422 });
  }
  const { data, error } = await createServiceClient().rpc('supplier_oracle_confirm', {
    p_settlement_id: id,
    p_expected_version: parsed.data.versaoEsperada,
    p_reference: parsed.data.referenciaPix || null,
    p_notes: parsed.data.observacoes || null,
    p_actor: auth.userId,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
