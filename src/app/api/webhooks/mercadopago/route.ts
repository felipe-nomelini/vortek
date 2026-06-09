import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMercadoPagoPayment } from '@/services/mercadopago';
import { HAYAMAX_FORNECEDOR_ID, HAYAMAX_MIN_TOPUP_AMOUNT, normalizeMoneyAmount } from '@/lib/supplier-balance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSignature(header: string | null) {
  const result: { ts?: string; v1?: string } = {};
  for (const part of String(header || '').split(',')) {
    const [key, value] = part.split('=');
    const cleanKey = key?.trim();
    const cleanValue = value?.trim();
    if (cleanKey === 'ts') result.ts = cleanValue;
    if (cleanKey === 'v1') result.v1 = cleanValue;
  }
  return result;
}

function safeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateMercadoPagoSignature(params: {
  secret: string;
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
}) {
  const { ts, v1 } = parseSignature(params.signatureHeader);
  if (!ts || !v1) return false;

  const chunks: string[] = [];
  if (params.dataId) chunks.push(`id:${params.dataId.toLowerCase()};`);
  if (params.requestId) chunks.push(`request-id:${params.requestId};`);
  chunks.push(`ts:${ts};`);

  const expected = crypto
    .createHmac('sha256', params.secret)
    .update(chunks.join(''))
    .digest('hex');

  return safeEqualHex(expected, v1);
}

function textFromPayload(value: unknown) {
  return JSON.stringify(value || {})
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasHayamaxIdentity(payment: Record<string, unknown>) {
  const text = textFromPayload(payment);
  return text.includes('hayamax') || text.includes('01.725.627/0001-72') || text.includes('01725627000172');
}

function isBillPaymentCandidate(payment: Record<string, unknown>) {
  const text = textFromPayload(payment);
  return text.includes('bill payments')
    || text.includes('pagamento de conta')
    || text.includes('utility_entity')
    || text.includes('account_money');
}

function paymentAmount(payment: Record<string, unknown>) {
  const transactionAmount = normalizeMoneyAmount(payment.transaction_amount);
  const details = isRecord(payment.transaction_details) ? payment.transaction_details : {};
  const totalPaid = normalizeMoneyAmount(details.total_paid_amount);
  return Math.abs(transactionAmount || totalPaid || 0);
}

function paymentDate(payment: Record<string, unknown>) {
  const date = String(payment.date_approved || payment.date_created || '').trim();
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function jsonPayload(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function upsertPaymentEvent(params: {
  paymentId: string;
  webhookBody: Record<string, unknown>;
  payment: Record<string, unknown>;
}) {
  const service = createServiceClient();
  const amount = paymentAmount(params.payment);
  const enoughValue = amount >= HAYAMAX_MIN_TOPUP_AMOUNT;
  const matchedHayamax = enoughValue && hasHayamaxIdentity(params.payment);
  const reviewRequired = !matchedHayamax && enoughValue && isBillPaymentCandidate(params.payment);
  const matchedSupplier = matchedHayamax ? 'HAYAMAX' : reviewRequired ? 'REVIEW_REQUIRED' : null;
  const externalId = `payment:${params.paymentId}`;

  const { data: rawMovement, error: rawError } = await service
    .from('mercadopago_account_movements')
    .upsert({
      external_id: externalId,
      movement_date: paymentDate(params.payment),
      description: String(params.payment.description || params.payment.statement_descriptor || '').trim() || null,
      reference: String(params.payment.external_reference || params.payment.id || params.paymentId).trim(),
      amount: amount ? -amount : 0,
      movement_type: 'payment_webhook',
      currency: String(params.payment.currency_id || '').trim() || null,
      raw_payload: jsonPayload({
        source: 'webhook_payment',
        webhook: params.webhookBody,
        payment: params.payment,
      }),
      matched_supplier: matchedSupplier,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'external_id' })
    .select('id, supplier_balance_movement_id')
    .maybeSingle();

  if (rawError) throw new Error(`Falha ao salvar webhook Mercado Pago: ${rawError.message}`);
  if (!matchedHayamax || rawMovement?.supplier_balance_movement_id) {
    return { matchedSupplier, topupCreated: false };
  }

  const movementKey = `mercadopago:${externalId}`;
  const { data: existing, error: existingError } = await service
    .from('supplier_balance_movements')
    .select('id')
    .eq('movement_key', movementKey)
    .maybeSingle();

  if (existingError) throw new Error(`Falha ao consultar saldo Hayamax: ${existingError.message}`);

  let movementId = existing?.id || null;
  let topupCreated = false;
  if (!movementId) {
    const { data: inserted, error: insertError } = await service
      .from('supplier_balance_movements')
      .insert({
        fornecedor_id: HAYAMAX_FORNECEDOR_ID,
        fornecedor_nome: 'HAYAMAX',
        movement_type: 'topup',
        amount,
        reference: String(params.payment.external_reference || params.payment.id || params.paymentId),
        notes: 'Baixa automática Mercado Pago via webhook payment',
        created_by: 'mercadopago:webhook',
        movement_key: movementKey,
      })
      .select('id')
      .maybeSingle();

    if (insertError) throw new Error(`Falha ao creditar saldo Hayamax: ${insertError.message}`);
    movementId = inserted?.id || null;
    topupCreated = true;
  }

  if (movementId && rawMovement?.id) {
    await service
      .from('mercadopago_account_movements')
      .update({ supplier_balance_movement_id: movementId, updated_at: new Date().toISOString() })
      .eq('id', rawMovement.id);
  }

  return { matchedSupplier, topupCreated };
}

export async function POST(request: Request) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'MERCADOPAGO_WEBHOOK_SECRET ausente' }, { status: 500 });
  }

  const url = new URL(request.url);
  const queryDataId = url.searchParams.get('data.id');
  const queryType = url.searchParams.get('type');
  const bodyRaw = await request.json().catch(() => ({}));
  const body = isRecord(bodyRaw) ? bodyRaw : {};
  const bodyData = isRecord(body.data) ? body.data : {};
  const dataId = queryDataId || String(bodyData.id || '').trim();

  const validSignature = validateMercadoPagoSignature({
    secret,
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId: queryDataId || dataId,
  });

  if (!validSignature) {
    return NextResponse.json({ error: 'Assinatura Mercado Pago inválida' }, { status: 401 });
  }

  const type = String(queryType || body.type || '').trim();
  if (type !== 'payment') {
    return NextResponse.json({ success: true, ignored: true, type });
  }

  if (!dataId) {
    return NextResponse.json({ error: 'data.id ausente' }, { status: 400 });
  }

  try {
    const payment = await getMercadoPagoPayment(dataId);
    const result = await upsertPaymentEvent({ paymentId: dataId, webhookBody: body, payment });
    return NextResponse.json({ success: true, paymentId: dataId, ...result });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      paymentId: dataId,
      error: err?.message || 'Falha ao processar webhook Mercado Pago',
    }, { status: 500 });
  }
}
