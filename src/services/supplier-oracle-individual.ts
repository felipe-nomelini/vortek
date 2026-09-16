import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { MAX_SUPPLIER_RECEIPT_BYTES, sniffSupplierReceipt, SUPPLIER_RECEIPT_BUCKET } from '@/lib/supplier-oracle-receipt';
import { supplierOracleFingerprint, supplierOracleRpcError, type SupplierOracleTransition } from '@/lib/supplier-oracle-settlement';

type Client = ReturnType<typeof createServiceClient>;
type Purchase = { id: string; fornecedor_id: string | null; supplier_payment_status: string | null;
  supplier_payment_receipt_path: string | null; supplier_payment_reference?: string | null;
  supplier_settlement_id: string | null };
type Sale = { id: string; ml_order_id: string };
type PaymentInput = { receiptFile: File | null; reference: string | null; notes: string | null;
  resumeDsliteFlow: boolean; resumeOnly: boolean };

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

async function receiptBytes(client: Client, input: PaymentInput, purchase: Purchase) {
  if (!input.receiptFile && !purchase.supplier_payment_receipt_path) return null;
  let bytes: Buffer;
  if (input.receiptFile) {
    if (!input.receiptFile.size || input.receiptFile.size > MAX_SUPPLIER_RECEIPT_BYTES) return null;
    bytes = Buffer.from(await input.receiptFile.arrayBuffer());
  } else {
    const { data, error: downloadError } = await client.storage.from(SUPPLIER_RECEIPT_BUCKET)
      .download(purchase.supplier_payment_receipt_path!);
    if (downloadError || !data || data.size > MAX_SUPPLIER_RECEIPT_BYTES) return null;
    bytes = Buffer.from(await data.arrayBuffer());
  }
  const kind = sniffSupplierReceipt(bytes);
  return kind ? { bytes, ...kind, hash: createHash('sha256').update(bytes).digest('hex') } : null;
}

function success(input: { purchase: Purchase; sale: Sale; settlementId: string | null;
  receiptPath: string | null; resume: boolean; jobId?: string | null; alreadyPaid?: boolean }) {
  const jobId = input.jobId || null;
  return NextResponse.json({ success: true, compraId: input.purchase.id, pedidoId: input.sale.id,
    mlOrderId: input.sale.ml_order_id, supplierSettlementId: input.settlementId,
    receiptPath: input.receiptPath, jobId,
    resume: input.resume ? { started: Boolean(jobId), error: null, deduplicated: Boolean(input.alreadyPaid),
      skipped: false, pending: true, reason: 'supplier_settlement_postprocess',
      nextAction: null } : null,
    whatsapp: { sent: false, skipped: true, reason: input.settlementId
      ? 'manual_review_required' : 'already_paid_legacy' },
  });
}

export async function confirmSupplierOracleIndividual(input: { client: Client; purchase: Purchase; sale: Sale;
  payment: PaymentInput; actor: string }) {
  const { client, purchase, sale, payment, actor } = input;
  const postprocessJob = async (settlementId: string) => {
    const { data } = await client.from('jobs').select('id')
      .eq('dedupe_key', `supplier_settlement_postprocess:${settlementId}`).maybeSingle();
    return data?.id || null;
  };
  if ((payment.reference?.length || 0) > 200 || (payment.notes?.length || 0) > 1000) {
    return error('Referência PIX ou observações excedem o limite permitido', 422);
  }
  if (purchase.supplier_payment_status === 'paid') {
    if (payment.receiptFile || (payment.reference && payment.reference !== purchase.supplier_payment_reference)) {
      return error('Compra já paga; comprovante ou referência não podem ser substituídos nesta ação', 409);
    }
    if (!purchase.supplier_settlement_id) {
      return payment.resumeOnly ? error('Retomada de pagamento anterior exige o fluxo legado controlado', 409)
        : success({ purchase, sale, settlementId: null, receiptPath: purchase.supplier_payment_receipt_path,
          resume: payment.resumeDsliteFlow, alreadyPaid: true });
    }
    const jobId = payment.resumeDsliteFlow ? await postprocessJob(purchase.supplier_settlement_id) : null;
    return success({ purchase, sale, settlementId: purchase.supplier_settlement_id,
      receiptPath: purchase.supplier_payment_receipt_path, resume: payment.resumeDsliteFlow,
      jobId, alreadyPaid: true });
  }
  if (payment.resumeOnly) return error('Compra ainda não paga; a retomada isolada não é permitida', 409);
  if (!purchase.fornecedor_id) return error('Fornecedor da compra não identificado', 409);
  const receipt = await receiptBytes(client, payment, purchase);
  if (!receipt) return error('Anexe um comprovante válido em PDF, JPG, PNG ou WEBP (até 10 MB)', 422);

  let transition: SupplierOracleTransition;
  if (purchase.supplier_settlement_id) {
    const [prior, items] = await Promise.all([
      client.from('supplier_settlements').select('id,status,version,fornecedor_dslite_id,idempotency_key,credit_amount')
        .eq('id', purchase.supplier_settlement_id).maybeSingle(),
      client.from('supplier_settlement_items').select('compra_id')
        .eq('settlement_id', purchase.supplier_settlement_id).is('released_at', null),
    ]);
    if (prior.error || items.error || !prior.data || prior.data.status !== 'prepared'
      || prior.data.fornecedor_dslite_id !== purchase.fornecedor_id
      || !String(prior.data.idempotency_key || '').startsWith('single:')
      || Number(prior.data.credit_amount) !== 0
      || items.data?.length !== 1 || items.data[0].compra_id !== purchase.id) {
      return error('Compra já reservada em outra liquidação; confira antes de confirmar', 409);
    }
    transition = { id: prior.data.id, status: 'prepared', version: prior.data.version, replayed: true };
  } else {
    const { data: prepared, error: prepareError } = await client.rpc('supplier_oracle_prepare', {
      p_supplier_id: purchase.fornecedor_id, p_compra_ids: [purchase.id], p_credit_amount: 0,
      p_idempotency_key: `single:${randomUUID()}`,
      p_fingerprint: supplierOracleFingerprint({ supplierId: purchase.fornecedor_id,
        purchaseIds: [purchase.id], creditCents: 0 }), p_actor: actor,
    });
    if (prepareError) return supplierOracleRpcError(prepareError);
    transition = prepared as SupplierOracleTransition;
  }
  if (transition.status === 'cancelled') return error('Preparo individual cancelado; revise a liquidação antes de continuar', 409);
  const { data: settlement, error: readError } = await client.from('supplier_settlements')
    .select('status,version,receipt_path').eq('id', transition.id).maybeSingle();
  if (readError || !settlement) return error('Preparo criado, mas não foi possível conferir a liquidação', 500);
  const path = `liquidacoes/${transition.id}/${receipt.hash}.${receipt.extension}`;
  if (settlement.status === 'confirmed') {
    if (settlement.receipt_path !== path) return error('Liquidação já confirmada com outro comprovante', 409);
    return success({ purchase, sale, settlementId: transition.id, receiptPath: path,
      resume: payment.resumeDsliteFlow, jobId: payment.resumeDsliteFlow ? await postprocessJob(transition.id) : null,
      alreadyPaid: true });
  }
  if (settlement.status !== 'prepared') return error('Liquidação individual não está preparada', 409);
  let version = settlement.version;
  if (settlement.receipt_path && settlement.receipt_path !== path) {
    return error('Liquidação já possui outro comprovante; confira antes de confirmar', 409);
  }
  if (!settlement.receipt_path) {
    const { error: uploadError } = await client.storage.from(SUPPLIER_RECEIPT_BUCKET)
      .upload(path, receipt.bytes, { contentType: receipt.mime, upsert: false });
    if (uploadError && String(uploadError.statusCode) !== '409') return error('Preparo salvo, mas o comprovante não foi anexado', 500);
    if (uploadError) {
      const { data: stored, error: storedError } = await client.storage.from(SUPPLIER_RECEIPT_BUCKET).download(path);
      if (storedError || !stored || createHash('sha256').update(Buffer.from(await stored.arrayBuffer())).digest('hex') !== receipt.hash) {
        return error('Comprovante existente não pôde ser conferido', 409);
      }
    }
    const { data: attached, error: attachError } = await client.rpc('supplier_oracle_attach_receipt', {
      p_settlement_id: transition.id, p_expected_version: version, p_path: path, p_actor: actor,
    });
    if (attachError) return supplierOracleRpcError(attachError);
    if (!attached || typeof attached !== 'object' || Array.isArray(attached)
      || typeof attached.version !== 'number') return error('Comprovante anexado, mas a versão não foi confirmada', 500);
    version = attached.version;
  }
  const { error: confirmError } = await client.rpc('supplier_oracle_confirm', {
    p_settlement_id: transition.id, p_expected_version: version,
    p_reference: payment.reference, p_notes: payment.notes, p_actor: actor,
  });
  if (confirmError) return supplierOracleRpcError(confirmError);
  return success({ purchase, sale, settlementId: transition.id, receiptPath: path,
    resume: payment.resumeDsliteFlow, jobId: payment.resumeDsliteFlow ? await postprocessJob(transition.id) : null });
}
