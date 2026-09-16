import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { supplierOracleDisabledResponse, supplierOracleRpcError, supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.payment.confirm');
  if (!auth.ok) return auth.response;
  if (!supplierOracleWritesEnabled()) return supplierOracleDisabledResponse();
  const { id } = await context.params;
  const parsed = z.object({ justificativa: z.string().trim().min(10).max(500) }).strict()
    .safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Reprocessamento inválido' }, { status: 422 });
  }
  const { data, error } = await createServiceClient().rpc('supplier_oracle_requeue_job', {
    p_job_id: id, p_note: parsed.data.justificativa, p_actor: auth.userId,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
