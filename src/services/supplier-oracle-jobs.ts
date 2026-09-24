import { createServiceClient } from '@/lib/supabase';
import { supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';
import { requestDsliteResume } from '@/lib/dslite/resume-request';
import { getWahaNewMessageId, normalizeWhatsappChatId, sendWahaText } from '@/services/waha';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { isDslitePlaceholderLabelSource } from '@/lib/dslite/label-state';
import { DEFAULT_STALE_JOB_THRESHOLD_MINUTES, isJobStale } from '@/lib/sync/stale-jobs';

export const ORACLE_POSTPROCESS_JOB = 'supplier_settlement_postprocess';
export const ORACLE_COMMUNICATION_JOB = 'supplier_settlement_communication';
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_SUFFIX = new RegExp(`:(${ID})$`, 'i');
const now = () => new Date().toISOString();

type Client = ReturnType<typeof createServiceClient>;
type ClaimedJob = { id: string; dedupe_key: string };

function targetId(job: ClaimedJob): string {
  const value = job.dedupe_key.match(UUID_SUFFIX)?.[1];
  if (!value) throw new Error('Chave do job Oráculo inválida');
  return value;
}

async function finishJob(client: Client, jobId: string, status: 'pendente' | 'on_hold' | 'completo', processed: number, total: number, reason: string) {
  const { data: current } = await client.from('jobs').select('log').eq('id', jobId).maybeSingle();
  const previous = Array.isArray(current?.log) ? current.log : [];
  const { error } = await client.from('jobs').update({
    status, processados: processed, total,
    progresso: total ? Math.round(processed / total * 100) : 100,
    finished_at: status === 'completo' ? now() : null,
    log: [...previous, { event: 'supplier_oracle_checkpoint', at: now(), reason, processed, total }],
  }).eq('id', jobId).eq('status', 'rodando');
  if (error) throw new Error(`Falha ao concluir job do Oráculo: ${error.message}`);
}

async function processResumeEffect(client: Client, settlementId: string, item: { pedido_id: string; ml_order_id_snapshot: string | null }) {
  const { error: insertError } = await client.from('supplier_settlement_resume_effects')
    .upsert({ settlement_id: settlementId, pedido_id: item.pedido_id },
      { onConflict: 'settlement_id,pedido_id', ignoreDuplicates: true });
  if (insertError) throw new Error(`Falha ao registrar retomada: ${insertError.message}`);
  const { data: effect, error: effectError } = await client.from('supplier_settlement_resume_effects')
    .select('*').eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).single();
  if (effectError || !effect) throw new Error('Retomada não encontrada');
  if (['done', 'skipped', 'failed', 'uncertain'].includes(effect.status)) return effect.status;
  if (effect.status === 'dispatching') {
    await client.from('supplier_settlement_resume_effects').update({ status: 'uncertain', error_code: 'interrupted_dispatch', updated_at: now() })
      .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'dispatching');
    return 'uncertain';
  }
  if (effect.status === 'accepted') {
    if (!effect.child_job_id) {
      await client.from('supplier_settlement_resume_effects').update({ status: 'uncertain', error_code: 'child_job_missing', updated_at: now() })
        .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'accepted');
      return 'uncertain';
    }
    const { data: child, error } = await client.from('jobs').select('status').eq('id', effect.child_job_id).maybeSingle();
    if (error || !child) {
      await client.from('supplier_settlement_resume_effects').update({ status: 'uncertain', error_code: 'child_job_not_found', updated_at: now() })
        .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'accepted');
      return 'uncertain';
    }
    const next = child.status === 'completo' ? 'done'
      : ['erro', 'failed_auth', 'cancelado', 'completo_parcial'].includes(child.status) ? 'failed' : 'accepted';
    if (next !== 'accepted') await client.from('supplier_settlement_resume_effects')
      .update({ status: next, error_code: next === 'failed' ? 'child_job_failed' : null, updated_at: now() })
      .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'accepted');
    return next;
  }
  const { data: order, error: orderError } = await client.from('pedidos')
    .select('id,ml_order_id,situacao,evolusom_order_id,dslite_etiqueta_enviada,dslite_label_source')
    .eq('id', item.pedido_id).maybeSingle();
  if (orderError || !order) throw new Error('Venda da retomada indisponível');
  if (order.situacao === 'concretizada_ml' || order.evolusom_order_id || order.dslite_etiqueta_enviada
    || order.dslite_label_source === 'dslite_paid_shipping'
    || isDslitePlaceholderLabelSource(order.dslite_label_source)) {
    await client.from('supplier_settlement_resume_effects').update({ status: 'skipped', updated_at: now() })
      .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'pending');
    return 'skipped';
  }
  const mlOrderId = String(order.ml_order_id || item.ml_order_id_snapshot || '');
  if (!mlOrderId || !process.env.API_SECRET_KEY) throw new Error('Retomada sem venda ML ou chave interna');
  const { data: claimed, error: claimError } = await client.from('supplier_settlement_resume_effects')
    .update({ status: 'dispatching', attempts: effect.attempts + 1, updated_at: now() })
    .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'pending')
    .select('pedido_id').maybeSingle();
  if (claimError) throw new Error(`Falha ao assumir retomada: ${claimError.message}`);
  if (!claimed) return 'pending';
  const key = `supplier-settlement:${settlementId}:${item.pedido_id}`;
  const base = String(process.env.INTERNAL_APP_URL || `http://127.0.0.1:${process.env.PORT || '3000'}`).replace(/\/+$/, '');
  const result = await requestDsliteResume({
    urls: [`${base}/api/dslite/pedido`],
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_SECRET_KEY, 'Idempotency-Key': key },
    body: JSON.stringify({ pedidoId: item.pedido_id, mlOrderId, nfeProvider: 'brasilnfe',
      resumeAfterSupplierPayment: true, idempotencyKey: key }),
    fetcher: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
  });
  const childId = String(result.json?.jobId || '');
  if (result.error || !/^[0-9a-f-]{36}$/i.test(childId)) {
    await client.from('supplier_settlement_resume_effects').update({ status: 'uncertain', error_code: 'dslite_outcome_unknown', updated_at: now() })
      .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'dispatching');
    await registrarEventoNfAuditoria({ pedidoId: item.pedido_id, mlOrderId,
      evento: 'supplier_settlement_resume_uncertain', respostaMl: { settlement_id: settlementId }, statusResultante: 'uncertain' });
    return 'uncertain';
  }
  const { error: checkpointError } = await client.from('supplier_settlement_resume_effects')
    .update({ status: 'accepted', child_job_id: childId, updated_at: now() })
    .eq('settlement_id', settlementId).eq('pedido_id', item.pedido_id).eq('status', 'dispatching');
  if (checkpointError) throw new Error(`Falha ao salvar job DSLite: ${checkpointError.message}`);
  await registrarEventoNfAuditoria({ pedidoId: item.pedido_id, mlOrderId,
    evento: 'supplier_settlement_resume_accepted', respostaMl: { settlement_id: settlementId, child_job_id: childId }, statusResultante: 'accepted' });
  return 'accepted';
}

async function runPostprocess(client: Client, job: ClaimedJob) {
  const settlementId = targetId(job);
  const { data: settlement, error: settlementError } = await client.from('supplier_settlements')
    .select('status').eq('id', settlementId).maybeSingle();
  if (settlementError || settlement?.status !== 'confirmed') throw new Error('Liquidação não confirmada');
  const { data: items, error } = await client.from('supplier_settlement_items')
    .select('pedido_id,ml_order_id_snapshot').eq('settlement_id', settlementId).order('pedido_id');
  if (error || !items?.length) throw new Error('Itens da liquidação não encontrados');
  const { data: priorEffects, error: priorError } = await client.from('supplier_settlement_resume_effects')
    .select('pedido_id,status').eq('settlement_id', settlementId);
  if (priorError) throw new Error('Falha ao consultar retomadas');
  if ((priorEffects || []).some((effect) => ['failed', 'uncertain', 'dispatching'].includes(effect.status))) {
    const completed = (priorEffects || []).filter((effect) => ['done', 'skipped'].includes(effect.status)).length;
    await finishJob(client, job.id, 'on_hold', completed, items.length, 'external_check_required');
    return;
  }
  const effectByOrder = new Map((priorEffects || []).map((effect) => [effect.pedido_id, effect.status]));
  const due = items.filter((item) => !['done', 'skipped', 'failed', 'uncertain'].includes(effectByOrder.get(item.pedido_id) || 'pending'));
  for (const item of due.slice(0, 2)) {
    const result = await processResumeEffect(client, settlementId, item);
    if (result === 'failed' || result === 'uncertain') break;
  }
  const { data: effects, error: effectsError } = await client.from('supplier_settlement_resume_effects')
    .select('status').eq('settlement_id', settlementId);
  if (effectsError) throw new Error('Falha ao conferir retomadas');
  const statuses = effects || [];
  const done = statuses.filter((row) => ['done', 'skipped'].includes(row.status)).length;
  const blocked = statuses.some((row) => ['failed', 'uncertain', 'dispatching'].includes(row.status));
  await finishJob(client, job.id, blocked ? 'on_hold' : done === items.length ? 'completo' : 'pendente',
    done, items.length, blocked ? 'external_check_required' : done === items.length ? 'completed' : 'waiting_child_jobs');
}

async function runCommunication(client: Client, job: ClaimedJob) {
  const communicationId = targetId(job);
  const { data: current, error } = await client.from('supplier_settlement_communications')
    .select('*').eq('id', communicationId).maybeSingle();
  if (error || !current) throw new Error('Comunicação não encontrada');
  if (current.status === 'sent') {
    await finishJob(client, job.id, 'completo', 1, 1, 'already_sent');
    return;
  }
  if (current.status !== 'approved') throw new Error('Comunicação não aprovada');
  let messageId = current.message_id;
  if (!messageId) {
    try { messageId = await getWahaNewMessageId(); }
    catch {
      await client.from('supplier_settlement_communications').update({ status: 'failed', error_code: 'waha_id_unavailable', updated_at: now() })
        .eq('id', communicationId).eq('status', 'approved');
      await finishJob(client, job.id, 'on_hold', 0, 1, 'waha_id_unavailable');
      return;
    }
    const { error: idError } = await client.from('supplier_settlement_communications')
      .update({ message_id: messageId, updated_at: now() }).eq('id', communicationId).eq('status', 'approved');
    if (idError) throw new Error('Falha ao reservar ID de mensagem');
  }
  const { data: claimed, error: claimError } = await client.from('supplier_settlement_communications')
    .update({ status: 'sending', attempts: current.attempts + 1, updated_at: now() })
    .eq('id', communicationId).eq('status', 'approved').select('id').maybeSingle();
  if (claimError || !claimed) throw new Error('Comunicação não pôde ser assumida');
  try {
    await sendWahaText({ chatId: normalizeWhatsappChatId(current.contact_phone), text: current.body, messageId });
  } catch {
    await client.from('supplier_settlement_communications').update({ status: 'uncertain', error_code: 'waha_outcome_unknown', updated_at: now() })
      .eq('id', communicationId).eq('status', 'sending');
    await finishJob(client, job.id, 'on_hold', 0, 1, 'waha_outcome_unknown');
    return;
  }
  const { error: sentError } = await client.from('supplier_settlement_communications')
    .update({ status: 'sent', sent_at: now(), error_code: null, updated_at: now() })
    .eq('id', communicationId).eq('status', 'sending');
  if (sentError) throw new Error('Envio aceito; checkpoint local pendente');
  await finishJob(client, job.id, 'completo', 1, 1, 'message_sent');
  const { data: members } = await client.from('supplier_settlement_communication_members')
    .select('settlement_id').eq('communication_id', communicationId);
  for (const member of members || []) {
    const { data: item } = await client.from('supplier_settlement_items')
      .select('pedido_id,ml_order_id_snapshot').eq('settlement_id', member.settlement_id).limit(1).maybeSingle();
    if (item?.pedido_id && item.ml_order_id_snapshot) await registrarEventoNfAuditoria({
      pedidoId: item.pedido_id, mlOrderId: item.ml_order_id_snapshot,
      evento: 'supplier_settlement_communication_sent',
      respostaMl: { communication_id: communicationId, settlement_id: member.settlement_id, message_id: messageId },
      statusResultante: 'sent',
    });
  }
}

export async function recoverStaleSupplierOracleJob(client: Client, job: { id: string; tipo: string; status: string }) {
  if (![ORACLE_POSTPROCESS_JOB, ORACLE_COMMUNICATION_JOB].includes(job.tipo)) return false;
  if (job.status !== 'rodando') return true;
  const { data: row } = await client.from('jobs')
    .select('dedupe_key,status,created_at,finished_at,log').eq('id', job.id).maybeSingle();
  if (!row || row.status !== 'rodando' || !isJobStale(row, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) return true;
  const target = String(row?.dedupe_key || '').match(UUID_SUFFIX)?.[1];
  let nextStatus: 'pendente' | 'on_hold' | 'completo' = 'on_hold';
  if (target && job.tipo === ORACLE_POSTPROCESS_JOB) {
    const { data: uncertain } = await client.from('supplier_settlement_resume_effects')
      .update({ status: 'uncertain', error_code: 'interrupted_dispatch', updated_at: now() })
      .eq('settlement_id', target).eq('status', 'dispatching').select('pedido_id');
    nextStatus = uncertain?.length ? 'on_hold' : 'pendente';
  }
  if (target && job.tipo === ORACLE_COMMUNICATION_JOB) {
    const { data: communication } = await client.from('supplier_settlement_communications')
      .select('status').eq('id', target).maybeSingle();
    if (communication?.status === 'sending') {
      await client.from('supplier_settlement_communications')
        .update({ status: 'uncertain', error_code: 'interrupted_send', updated_at: now() })
        .eq('id', target).eq('status', 'sending');
    } else if (communication?.status === 'approved') nextStatus = 'pendente';
    else if (communication?.status === 'sent') nextStatus = 'completo';
  }
  await client.from('jobs').update({ status: nextStatus, finished_at: nextStatus === 'completo' ? now() : null })
    .eq('id', job.id).eq('status', 'rodando');
  return true;
}

export async function processSupplierOracleQueue(client: Client) {
  if (!supplierOracleWritesEnabled()) return { processed: 0, disabled: true };
  let processed = 0;
  for (const type of [ORACLE_POSTPROCESS_JOB, ORACLE_COMMUNICATION_JOB]) {
    for (let i = 0; i < 3; i++) {
      const { data, error } = await client.rpc('supplier_oracle_claim_job', { p_type: type });
      if (error) throw new Error(`Falha ao assumir job ${type}: ${error.message}`);
      if (!data) break;
      const job = data as ClaimedJob;
      processed++;
      try {
        if (type === ORACLE_POSTPROCESS_JOB) await runPostprocess(client, job);
        else await runCommunication(client, job);
      } catch (cause) {
        const target = String(job.dedupe_key || '').match(UUID_SUFFIX)?.[1];
        if (target && type === ORACLE_COMMUNICATION_JOB) {
          const { data: current } = await client.from('supplier_settlement_communications')
            .select('status').eq('id', target).maybeSingle();
          if (current?.status === 'sent') {
            await finishJob(client, job.id, 'completo', 1, 1, 'message_sent_checkpoint_recovered');
            continue;
          }
        }
        if (target && type === ORACLE_POSTPROCESS_JOB) await client.from('supplier_settlement_resume_effects')
          .update({ status: 'uncertain', error_code: 'interrupted_dispatch', updated_at: now() })
          .eq('settlement_id', target).eq('status', 'dispatching');
        if (target && type === ORACLE_COMMUNICATION_JOB) await client.from('supplier_settlement_communications')
          .update({ status: 'uncertain', error_code: 'interrupted_send', updated_at: now() })
          .eq('id', target).eq('status', 'sending');
        await finishJob(client, job.id, 'on_hold', 0, 1,
          cause instanceof Error ? cause.message.slice(0, 100) : 'external_check_required');
      }
    }
  }
  return { processed, disabled: false };
}
