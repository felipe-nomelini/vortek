import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  HAYAMAX_FORNECEDOR_ID,
  HAYAMAX_MIN_TOPUP_AMOUNT,
  getSupplierBalance,
  normalizeMoneyAmount,
} from '@/lib/supplier-balance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const service = createServiceClient();

  const [{ data: movements, error }, balance, { data: pendingReview }, { data: lastMpMovement }] = await Promise.all([
    service
      .from('supplier_balance_movements')
      .select('*')
      .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
      .order('created_at', { ascending: false })
      .limit(50),
    getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID),
    service
      .from('mercadopago_account_movements')
      .select('id,external_id,movement_date,description,reference,amount,movement_type,matched_supplier')
      .eq('matched_supplier', 'REVIEW_REQUIRED')
      .is('supplier_balance_movement_id', null)
      .order('movement_date', { ascending: false, nullsFirst: false })
      .limit(5),
    service
      .from('mercadopago_account_movements')
      .select('movement_date,updated_at')
      .order('movement_date', { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fornecedorId: HAYAMAX_FORNECEDOR_ID,
    fornecedorNome: 'HAYAMAX',
    balance,
    lowBalance: balance < HAYAMAX_MIN_TOPUP_AMOUNT,
    movements: movements || [],
    mercadoPago: {
      lastMovementDate: lastMpMovement?.[0]?.movement_date || null,
      pendingReview: pendingReview || [],
      pendingReviewCount: pendingReview?.length || 0,
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const amount = normalizeMoneyAmount(body?.amount);
  const reference = String(body?.reference || '').trim() || null;
  const notes = String(body?.notes || '').trim() || null;

  if (amount < HAYAMAX_MIN_TOPUP_AMOUNT) {
    return NextResponse.json({ error: `Boleto Hayamax deve ser de no mínimo R$ ${HAYAMAX_MIN_TOPUP_AMOUNT}.` }, { status: 422 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from('supplier_balance_movements')
    .insert({
      fornecedor_id: HAYAMAX_FORNECEDOR_ID,
      fornecedor_nome: 'HAYAMAX',
      movement_type: 'topup',
      amount,
      reference,
      notes,
      created_by: user.email || user.id,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const balance = await getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID);
  return NextResponse.json({ success: true, balance });
}
