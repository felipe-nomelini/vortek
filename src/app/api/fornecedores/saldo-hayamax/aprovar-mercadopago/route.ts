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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const movementId = String(body?.movementId || '').trim();
  if (!movementId) return NextResponse.json({ error: 'Movimento Mercado Pago ausente' }, { status: 422 });

  const service = createServiceClient();
  const { data: movement, error: movementError } = await service
    .from('mercadopago_account_movements')
    .select('*')
    .eq('id', movementId)
    .maybeSingle();

  if (movementError) return NextResponse.json({ error: movementError.message }, { status: 500 });
  if (!movement?.id) return NextResponse.json({ error: 'Movimento Mercado Pago não encontrado' }, { status: 404 });
  if (movement.supplier_balance_movement_id) {
    const balance = await getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID);
    return NextResponse.json({ success: true, alreadyApproved: true, balance });
  }

  const amount = normalizeMoneyAmount(Math.abs(Number(movement.amount || 0)));
  if (amount < HAYAMAX_MIN_TOPUP_AMOUNT) {
    return NextResponse.json({ error: `Crédito Hayamax deve ser de no mínimo R$ ${HAYAMAX_MIN_TOPUP_AMOUNT}.` }, { status: 422 });
  }

  const movementKey = `mercadopago:${movement.external_id}`;
  const { data: existing, error: existingError } = await service
    .from('supplier_balance_movements')
    .select('id')
    .eq('movement_key', movementKey)
    .maybeSingle();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  let balanceMovementId = existing?.id || null;
  if (!balanceMovementId) {
    const { data: inserted, error: insertError } = await service
      .from('supplier_balance_movements')
      .insert({
        fornecedor_id: HAYAMAX_FORNECEDOR_ID,
        fornecedor_nome: 'HAYAMAX',
        movement_type: 'topup',
        amount,
        reference: movement.reference || movement.description || `Mercado Pago ${movement.external_id}`,
        notes: `Crédito aprovado manualmente a partir do Mercado Pago. Movimento: ${movement.id}`,
        created_by: user.email || user.id,
        movement_key: movementKey,
      })
      .select('id')
      .maybeSingle();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    balanceMovementId = inserted?.id || null;
  }

  if (balanceMovementId) {
    await service
      .from('mercadopago_account_movements')
      .update({
        matched_supplier: 'HAYAMAX',
        supplier_balance_movement_id: balanceMovementId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movement.id);
  }

  const balance = await getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID);
  return NextResponse.json({ success: true, balance, movementId: balanceMovementId });
}
