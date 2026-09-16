import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import {
  supplierOracleDisabledResponse, supplierOracleFingerprint,
  supplierOracleRpcError, supplierOracleWritesEnabled,
} from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  fornecedorId: z.string().regex(/^[0-9]{1,20}$/),
  compraIds: z.array(z.string().uuid()).min(1).max(100),
  creditoCentavos: z.number().int().nonnegative().max(1_000_000_000),
  chaveIdempotencia: z.string().regex(/^[A-Za-z0-9:_-]{8,100}$/),
}).strict().refine((value) => new Set(value.compraIds).size === value.compraIds.length,
  { path: ['compraIds'], message: 'Compras duplicadas' });

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.payment.confirm');
  if (!auth.ok) return auth.response;
  if (!supplierOracleWritesEnabled()) return supplierOracleDisabledResponse();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados da liquidação inválidos' }, { status: 422 });

  const { fornecedorId, compraIds, creditoCentavos, chaveIdempotencia } = parsed.data;
  const { data, error } = await createServiceClient().rpc('supplier_oracle_prepare', {
    p_supplier_id: fornecedorId,
    p_compra_ids: compraIds,
    p_credit_amount: creditoCentavos / 100,
    p_idempotency_key: chaveIdempotencia,
    p_fingerprint: supplierOracleFingerprint({ supplierId: fornecedorId, purchaseIds: compraIds, creditCents: creditoCentavos }),
    p_actor: auth.userId,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { status: data && typeof data === 'object' && 'replayed' in data && data.replayed ? 200 : 201,
    headers: { 'Cache-Control': 'no-store' } });
}
