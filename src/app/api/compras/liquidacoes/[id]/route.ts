import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { maskSupplierFinancialValue } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Liquidação inválida' }, { status: 422 });
  const client = createServiceClient();
  const { data: settlement, error } = await client.from('supplier_settlements')
    .select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao consultar liquidação' }, { status: 500 });
  if (!settlement) return NextResponse.json({ error: 'Liquidação não encontrada' }, { status: 404 });
  const { data: items, error: itemsError } = await client.from('supplier_settlement_items')
    .select('id,compra_id,pedido_id,dsid_snapshot,sale_number_snapshot,product_description_snapshot,quantity_snapshot,gross_amount,credit_amount,pix_amount,released_at')
    .eq('settlement_id', id).order('created_at', { ascending: true });
  if (itemsError) return NextResponse.json({ error: 'Falha ao consultar itens' }, { status: 500 });
  return NextResponse.json({ data: {
    id: settlement.id, fornecedorId: settlement.fornecedor_id,
    fornecedorDsliteId: settlement.fornecedor_dslite_id,
    fornecedor: settlement.fornecedor_nome_snapshot,
    cnpjMasked: maskSupplierFinancialValue(settlement.cnpj_snapshot),
    pixKeyMasked: maskSupplierFinancialValue(settlement.supplier_pix_key_snapshot),
    status: settlement.status, version: settlement.version,
    grossAmount: settlement.gross_amount, creditAmount: settlement.credit_amount,
    pixAmount: settlement.pix_amount, paymentReference: settlement.payment_reference,
    hasReceipt: Boolean(settlement.receipt_path), notes: settlement.notes,
    preparedAt: settlement.prepared_at, confirmedAt: settlement.confirmed_at,
    cancelledAt: settlement.cancelled_at, items: items || [],
  } }, { headers: { 'Cache-Control': 'no-store' } });
}
