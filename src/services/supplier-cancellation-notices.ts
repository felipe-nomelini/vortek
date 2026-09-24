import { createServiceClient } from '@/lib/supabase';
import { isHomologationFixtureSource } from '@/lib/homologation-fixture';
import { resolveSafeDslitePedidoMutation } from '@/lib/dslite/purchase-link';
import { buildSupplierCancellationWhatsapp } from '@/lib/notifications/templates';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { getWahaNewMessageId, normalizeWhatsappChatId, sendWahaText } from '@/services/waha';
import type { Json } from '@/types/database';

type Db = ReturnType<typeof createServiceClient>;
type RecipientKey = 'primary' | 'evolusom_additional';
type RecipientCheckpoint = {
  chatId?: string;
  messageId?: string;
  status?: 'sent' | 'failed' | 'duplicate';
};
type RecipientState = Partial<Record<RecipientKey, RecipientCheckpoint>>;

function checkpoints(value: Json): RecipientState {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecipientState
    : {};
}

function normalizeRecipient(phone: unknown): string | null {
  try {
    return normalizeWhatsappChatId(String(phone || ''));
  } catch {
    return null;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Falha no envio ao fornecedor';
}

async function resolvePurchase(client: Db, sale: {
  id: string;
  dslite_id: string | null;
  evolusom_order_id: number | null;
}) {
  const directId = Number(sale.evolusom_order_id || 0);
  const dsid = String(sale.dslite_id || '').trim();
  if (directId && dsid) return { reason: 'ambiguous_purchase_sources' as const };
  if (!directId && !dsid) return { reason: 'purchase_not_linked' as const };

  const direct = directId > 0;
  const [{ data: purchase, error: purchaseError }, { data: group, error: groupError }] = await Promise.all([
    direct
      ? client.from('compras').select('id,pedido_id,evolusom_order_id,dsid,fornecedor_id,status,evolusom_request_state').eq('evolusom_order_id', directId).maybeSingle()
      : client.from('compras').select('id,pedido_id,evolusom_order_id,dsid,fornecedor_id,status,evolusom_request_state').eq('dsid', dsid).maybeSingle(),
    direct
      ? client.from('pedidos').select('id,situacao,dslite_id,evolusom_order_id,ml_pack_id,ml_bundle_type,ml_bundle_parent_item_id').eq('evolusom_order_id', directId).limit(1000)
      : client.from('pedidos').select('id,situacao,dslite_id,evolusom_order_id,ml_pack_id,ml_bundle_type,ml_bundle_parent_item_id').eq('dslite_id', dsid).limit(1000),
  ]);
  if (purchaseError || groupError) throw purchaseError || groupError;
  if (!purchase?.id) return { reason: 'purchase_not_found' as const };
  if (!group?.length || group.length === 1000) return { reason: 'ambiguous_purchase_group' as const };
  if (direct && (purchase.fornecedor_id !== '133' || purchase.pedido_id == null
    || purchase.evolusom_request_state !== 'created')) {
    return { reason: 'direct_purchase_link_invalid' as const };
  }
  if (!direct && (purchase.evolusom_order_id != null || String(purchase.dsid || '') !== dsid)) {
    return { reason: 'dslite_purchase_link_invalid' as const };
  }
  const candidates = group.map((row) => ({
    id: row.id,
    dslite_id: direct ? String(row.evolusom_order_id || '') : row.dslite_id,
    ml_pack_id: row.ml_pack_id,
    ml_bundle_type: row.ml_bundle_type,
    ml_bundle_parent_item_id: row.ml_bundle_parent_item_id,
  }));
  const safe = resolveSafeDslitePedidoMutation(candidates, direct ? String(directId) : dsid, sale.id);
  if (!safe.safe || (direct && !safe.ids.includes(purchase.pedido_id!))) {
    return { reason: 'ambiguous_purchase_group' as const };
  }
  return {
    purchase,
    reference: direct ? directId : dsid,
    providerLabel: direct ? 'Evolusom' as const : 'DSLite' as const,
    partialPurchase: group.some((row) => row.situacao !== 'cancelado'),
  };
}

export async function runSupplierCancellationNotices(client: Db, limit: number) {
  const { data: notices, error } = await client.from('supplier_cancellation_notices')
    .select('pedido_id,compra_id,status,recipients')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const summary = { seen: notices?.length || 0, sent: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const notice of notices || []) {
    const pedidoId = notice.pedido_id;
    const state = checkpoints(notice.recipients);
    const save = async (fields: Record<string, unknown>) => {
      const { error: saveError } = await client.from('supplier_cancellation_notices')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('pedido_id', pedidoId);
      if (saveError) throw saveError;
    };

    try {
      const { data: sale, error: saleError } = await client.from('pedidos')
        .select('id,numero,ml_order_id,situacao,dslite_id,evolusom_order_id,snapshot_source')
        .eq('id', pedidoId).maybeSingle();
      if (saleError) throw saleError;
      if (!sale || sale.situacao !== 'cancelado' || isHomologationFixtureSource(sale.snapshot_source)) {
        await save({ status: 'skipped', last_error: isHomologationFixtureSource(sale?.snapshot_source)
          ? 'homologation_fixture' : 'sale_not_cancelled', completed_at: new Date().toISOString() });
        summary.skipped += 1;
        continue;
      }

      const resolved = await resolvePurchase(client, sale);
      if (!('purchase' in resolved) || !resolved.purchase) {
        const reason = resolved.reason || 'purchase_not_found';
        const status = reason === 'purchase_not_linked' || reason === 'purchase_not_found' ? 'skipped' : 'blocked';
        await save({ status, last_error: reason, completed_at: new Date().toISOString() });
        summary[status] += 1;
        continue;
      }
      const { purchase, providerLabel, partialPurchase, reference } = resolved;
      if (providerLabel === 'DSLite' && !state.primary) {
        // Entre a migration e o deploy, o worker antigo ainda pode ter enviado.
        const { data: legacySend, error: legacyError } = await client.from('nf_auditoria_eventos')
          .select('id,resposta_ml').eq('pedido_id', pedidoId)
          .eq('evento', 'ml_cancel_auto_supplier_whatsapp_sent')
          .eq('status_resultante', 'success').limit(1).maybeSingle();
        if (legacyError) throw legacyError;
        const legacyResponse = legacySend?.resposta_ml;
        const legacyDsid = legacyResponse && typeof legacyResponse === 'object' && !Array.isArray(legacyResponse)
          ? String(legacyResponse.dsid || '') : '';
        if (legacyDsid === String(reference)) {
          state.primary = { status: 'sent' };
          await save({ compra_id: purchase.id, recipients: state as Json });
        }
      }
      const supplierId = String(purchase.fornecedor_id || '').trim();
      if (!supplierId) {
        await save({ status: 'blocked', last_error: 'supplier_missing', completed_at: new Date().toISOString() });
        summary.blocked += 1;
        continue;
      }
      const { data: supplier, error: supplierError } = await client.from('fornecedores')
        .select('telefone').eq('dslite_id', supplierId).maybeSingle();
      if (supplierError) throw supplierError;
      const primary = normalizeRecipient(supplier?.telefone);
      const additional = providerLabel === 'Evolusom'
        ? normalizeRecipient(process.env.EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE)
        : null;
      const recipients: Array<{ key: RecipientKey; chatId: string | null }> = [
        { key: 'primary', chatId: primary },
        ...(providerLabel === 'Evolusom'
          ? [{ key: 'evolusom_additional' as const, chatId: additional }]
          : []),
      ];
      const message = buildSupplierCancellationWhatsapp({
        dsliteId: reference,
        providerLabel,
        partialPurchase,
        mlOrderId: sale.ml_order_id,
        saleId: sale.numero,
      });
      let failed = false;
      let lastError: string | null = null;
      for (const recipient of recipients) {
        const prior = state[recipient.key];
        if (prior?.status === 'sent' || prior?.status === 'duplicate') continue;
        if (!recipient.chatId) {
          state[recipient.key] = { status: 'failed' };
          failed = true;
          lastError = `${recipient.key}:invalid_phone`;
          await save({ compra_id: purchase.id, recipients: state as Json });
          continue;
        }
        const primaryDeliveredTo = state.primary?.status === 'sent'
          ? state.primary.chatId || primary : primary;
        if (recipient.key === 'evolusom_additional' && recipient.chatId === primaryDeliveredTo) {
          state[recipient.key] = { status: 'duplicate' };
          await save({ compra_id: purchase.id, recipients: state as Json });
          continue;
        }
        let messageId: string;
        try {
          messageId = prior?.chatId === recipient.chatId && prior.messageId
            ? prior.messageId : await getWahaNewMessageId();
        } catch (cause) {
          failed = true;
          lastError = `${recipient.key}:${safeError(cause)}`;
          continue;
        }
        state[recipient.key] = { chatId: recipient.chatId, messageId, status: 'failed' };
        // O ID reutilizável precisa estar persistido antes da chamada externa.
        await save({ compra_id: purchase.id, recipients: state as Json });
        try {
          await sendWahaText({ chatId: recipient.chatId, text: message, messageId });
        } catch (cause) {
          failed = true;
          lastError = `${recipient.key}:${safeError(cause)}`;
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: sale.ml_order_id,
            evento: 'ml_cancel_auto_supplier_whatsapp_failed',
            respostaMl: { compra_id: purchase.id, provider: providerLabel, recipient: recipient.key, error: safeError(cause) },
            statusResultante: 'failed',
          });
          continue;
        }
        state[recipient.key] = { chatId: recipient.chatId, messageId, status: 'sent' };
        // Falha neste checkpoint encerra o pedido; o retry usa o mesmo ID.
        await save({ compra_id: purchase.id, recipients: state as Json });
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: sale.ml_order_id,
          evento: 'ml_cancel_auto_supplier_whatsapp_sent',
          payloadEnviado: { compra_id: purchase.id, provider: providerLabel, recipient: recipient.key },
          statusResultante: 'success',
        });
      }
      await save({
        compra_id: purchase.id,
        recipients: state as Json,
        status: failed ? 'failed' : 'sent',
        last_error: lastError,
        next_attempt_at: failed ? new Date(Date.now() + 5 * 60_000).toISOString() : new Date().toISOString(),
        completed_at: failed ? null : new Date().toISOString(),
      });
      summary[failed ? 'failed' : 'sent'] += 1;
    } catch (cause) {
      summary.failed += 1;
      const errorText = safeError(cause);
      try {
        await save({ status: 'failed', last_error: errorText, next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() });
      } catch (saveCause) {
        console.error('[supplier-cancellation] falha ao persistir retry', safeError(saveCause));
      }
      console.error('[supplier-cancellation] falha no aviso', pedidoId, errorText);
    }
  }
  return summary;
}
