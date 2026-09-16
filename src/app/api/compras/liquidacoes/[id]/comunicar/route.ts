import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { supplierOracleDisabledResponse, supplierOracleRpcError, supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';
import { buildSupplierOracleMessage, supplierOracleSelectionKey } from '@/lib/supplier-oracle-communication';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ liquidacaoIds: z.array(z.string().uuid()).min(1).max(20) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.payment.confirm');
  if (!auth.ok) return auth.response;
  if (!supplierOracleWritesEnabled()) return supplierOracleDisabledResponse();
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Seleção inválida' }, { status: 422 });
  }
  const ids = parsed.data.liquidacaoIds;
  if (!ids.includes(id) || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Inclua a liquidação da rota uma única vez' }, { status: 422 });
  }
  const client = createServiceClient();
  const [settlementsResult, itemsResult] = await Promise.all([
    client.from('supplier_settlements').select('id,status,contact_phone_snapshot,fornecedor_nome_snapshot,cnpj_snapshot,gross_amount,credit_amount,pix_amount,payment_reference').in('id', ids),
    client.from('supplier_settlement_items').select('settlement_id,sale_number_snapshot,product_description_snapshot,quantity_snapshot').in('settlement_id', ids),
  ]);
  if (settlementsResult.error || itemsResult.error) return NextResponse.json({ error: 'Falha ao consultar liquidações' }, { status: 500 });
  const settlements = settlementsResult.data || [];
  if (settlements.length !== ids.length || settlements.some((row) => row.status !== 'confirmed')) {
    return NextResponse.json({ error: 'Selecione somente liquidações confirmadas' }, { status: 409 });
  }
  const contacts = new Set(settlements.map((row) => String(row.contact_phone_snapshot || '').replace(/\D/g, '')));
  if (contacts.size !== 1 || ![...contacts][0] || !/^\d{10,15}$/.test([...contacts][0])) {
    return NextResponse.json({ error: 'As liquidações devem ter o mesmo contato válido' }, { status: 409 });
  }
  let body: string;
  try { body = buildSupplierOracleMessage(settlements, itemsResult.data || []); }
  catch { return NextResponse.json({ error: 'Não foi possível gerar o rascunho' }, { status: 409 }); }
  const { data, error } = await client.rpc('supplier_oracle_communication_draft', {
    p_ids: ids, p_selection_key: supplierOracleSelectionKey(ids), p_body: body, p_actor: auth.userId,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { status: (data as { replayed?: boolean })?.replayed ? 200 : 201,
    headers: { 'Cache-Control': 'no-store' } });
}
