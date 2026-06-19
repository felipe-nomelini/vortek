import { NextResponse } from 'next/server';
import { consultarPedido, definirTransportadoraPedido, enviarEtiqueta } from '@/services/dslite';
import {
  baixarEtiquetaML,
  consultarInvoiceDataPorShipmentML,
  upsertInvoiceDataMLByShipment,
} from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { ensureBrasilNfeInvoice } from '@/lib/fiscal/ensure-brasilnfe-invoice';
import { cancelarNotaBrasilNfePorChave } from '@/services/fiscal-provider';
import {
  DSLITE_PLACEHOLDER_LABEL_FILE_NAME,
  DSLITE_PLACEHOLDER_LABEL_SOURCE,
  loadDslitePlaceholderLabel,
} from '@/lib/dslite/placeholder-label';
import { storeShippingLabelForPedido } from '@/lib/shipping-label-storage';
import { HAYAMAX_FORNECEDOR_ID } from '@/lib/supplier-balance';

const LABEL_RETRY_INTERVAL_MS = 5000;
const LABEL_WAIT_TIMEOUT_MS = 60000;
const TRANSPORTADORA_PADRAO_CORREIOS = 31;

export const maxDuration = 90;

type StepKey =
  | 'check_ml_invoice_xml'
  | 'ensure_brasilnfe_invoice'
  | 'upload_invoice_ml'
  | 'download_label_ml'
  | 'set_carrier_dslite'
  | 'send_label_dslite';

type NfeDuplicateAction = 'use_existing' | 'reissue';

type StepStatus = 'pending' | 'loading' | 'success' | 'warning' | 'error' | 'skipped';

type StepState = {
  key: StepKey;
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
};

const STEP_LABELS: Record<StepKey, string> = {
  check_ml_invoice_xml: 'Verificando vínculo fiscal no Mercado Livre',
  ensure_brasilnfe_invoice: 'Garantindo NF na Brasil NFe',
  upload_invoice_ml: 'Vinculando NF Brasil NFe no Mercado Livre',
  download_label_ml: 'Baixando etiqueta do Mercado Livre',
  set_carrier_dslite: 'Definindo transportadora (Correios)',
  send_label_dslite: 'Enviando etiqueta para DSLite',
};

function createSteps(): StepState[] {
  return (Object.keys(STEP_LABELS) as StepKey[]).map((key) => ({
    key,
    label: STEP_LABELS[key],
    status: 'pending',
  }));
}

function updateStep(steps: StepState[], key: StepKey, patch: Partial<StepState>) {
  const idx = steps.findIndex((s) => s.key === key);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...patch, key, label: STEP_LABELS[key] };
}

function extractTag(xml: string | null | undefined, tag: string): string | null {
  const raw = String(xml || '');
  if (!raw) return null;
  try {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = raw.match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`));
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function parseInvoiceDateFromXml(xml: string | null | undefined): string | null {
  const dhEmi = extractTag(xml, 'dhEmi');
  if (dhEmi) {
    const d = new Date(dhEmi);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const dEmi = extractTag(xml, 'dEmi');
  if (!dEmi) return null;
  const d = new Date(`${dEmi}T00:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseInvoiceAmountFromXml(xml: string | null | undefined): number | null {
  const vNf = extractTag(xml, 'vNF');
  if (!vNf) return null;
  const num = Number(String(vNf).replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function finalizeSuccess(steps: StepState[], data: Record<string, any> = {}) {
  const labelSent = steps.some((step) => step.key === 'send_label_dslite' && step.status === 'success');
  const waitingMl = steps.some((step) => step.key === 'download_label_ml' && step.status === 'warning');
  const operationStatus = labelSent ? 'label_sent' : waitingMl ? 'waiting_ml_label' : 'completed';
  const nextAction = labelSent ? 'done' : waitingMl ? 'wait_ml_label' : 'review';
  return NextResponse.json({
    success: true,
    data: {
      steps,
      operation: 'complete_dslite_label',
      operationStatus,
      nextAction,
      ...data,
    },
  });
}

function stepError(
  steps: StepState[],
  step: StepKey,
  error: string,
  details?: Record<string, any>,
  status = 502,
  errorType: 'db_schema' | 'not_found' | 'business' | 'technical' = 'technical',
) {
  updateStep(steps, step, { status: 'error', error });
  return NextResponse.json(
    {
      success: false,
      step,
      errorType,
      error,
      details: details || null,
      data: { steps },
    },
    { status },
  );
}

export async function POST(req: Request) {
  const steps = createSteps();
  try {
    const { pedidoId, dsid, nfeDuplicateAction } = await req.json() as {
      pedidoId: string;
      dsid: string | number;
      nfeDuplicateAction?: NfeDuplicateAction;
    };
    if (!pedidoId || !dsid) {
      return stepError(steps, 'check_ml_invoice_xml', 'pedidoId e dsid são obrigatórios', undefined, 400);
    }

    const client = createServiceClient();
    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,ml_shipment_id,nfe_xml,nfe_chave,nfe_protocolo,nota_fiscal_numero,total,nfe_cfop,dslite_etiqueta_enviada,ml_pack_id')
      .eq('id', pedidoId)
      .maybeSingle();

    if (pedidoError) {
      const isSchemaMissing = String((pedidoError as any)?.code || '') === '42703';
      const infraMessage = isSchemaMissing
        ? 'Migration pendente: colunas fiscais de liberação ML não encontradas.'
        : 'Falha de infraestrutura ao consultar pedido (schema/configuração do banco).';

      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId: null,
        evento: 'etiqueta_auto_pedido_lookup_failed',
        respostaMl: {
          route: '/api/dslite/etiqueta-auto',
          db_code: (pedidoError as any)?.code || null,
          db_message: (pedidoError as any)?.message || null,
          db_hint: (pedidoError as any)?.hint || null,
          db_details: (pedidoError as any)?.details || null,
        },
        statusResultante: 'failed',
      });

      if (isSchemaMissing) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId: null,
          evento: 'db_schema_migration_missing_detected',
          respostaMl: {
            route: '/api/dslite/etiqueta-auto',
            db_code: (pedidoError as any)?.code || null,
            db_message: (pedidoError as any)?.message || null,
          },
          statusResultante: 'migration_missing',
        });
      }

      return stepError(
        steps,
        'check_ml_invoice_xml',
        infraMessage,
        {
          route: '/api/dslite/etiqueta-auto',
          db_code: (pedidoError as any)?.code || null,
          db_message: (pedidoError as any)?.message || null,
          db_hint: (pedidoError as any)?.hint || null,
          db_details: (pedidoError as any)?.details || null,
        },
        isSchemaMissing ? 503 : 500,
        isSchemaMissing ? 'db_schema' : 'technical',
      );
    }

    if (!pedido) {
      return stepError(steps, 'check_ml_invoice_xml', 'Pedido não encontrado', undefined, 404, 'not_found');
    }

    const mlOrderId = String((pedido as any).ml_order_id || '').trim();
    const shipmentId = String((pedido as any).ml_shipment_id || '').trim();
    if (!mlOrderId) {
      return stepError(steps, 'check_ml_invoice_xml', 'Pedido sem ml_order_id para verificação fiscal no ML', undefined, 400);
    }
    let releaseAtRaw = '';
    let releaseReasonRaw = '';
    const releaseWindowRead = await client
      .from('pedidos')
      .select('ml_fiscal_release_at,ml_fiscal_release_reason')
      .eq('id', pedidoId)
      .maybeSingle();
    if (!releaseWindowRead.error) {
      releaseAtRaw = String((releaseWindowRead.data as any)?.ml_fiscal_release_at || '').trim();
      releaseReasonRaw = String((releaseWindowRead.data as any)?.ml_fiscal_release_reason || '').trim();
    } else if (String((releaseWindowRead.error as any)?.code || '') === '42703') {
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId: mlOrderId || null,
        evento: 'db_schema_migration_missing_detected',
        respostaMl: {
          route: '/api/dslite/etiqueta-auto',
          db_code: (releaseWindowRead.error as any)?.code || null,
          db_message: (releaseWindowRead.error as any)?.message || null,
          missing_fields: ['ml_fiscal_release_at', 'ml_fiscal_release_reason'],
        },
        statusResultante: 'migration_missing_ignored',
      });
    }
    const releaseAt = releaseAtRaw ? new Date(releaseAtRaw) : null;
    if (releaseAt && !Number.isNaN(releaseAt.getTime()) && releaseAt.getTime() > Date.now()) {
      const releaseLabel = releaseAt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const { data: compraVinculada } = await client
        .from('compras')
        .select('fornecedor_id,fornecedor_nome')
        .eq('dsid', String(dsid))
        .maybeSingle();
      const fornecedorId = String((compraVinculada as any)?.fornecedor_id || '').trim();
      if (fornecedorId !== HAYAMAX_FORNECEDOR_ID) {
        const msg = `Etiqueta ML ainda não liberada até ${releaseLabel}; etiqueta genérica permitida apenas para Hayamax.`;
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          mlPackId: (pedido as any).ml_pack_id ? String((pedido as any).ml_pack_id) : null,
          evento: 'placeholder_label_blocked_non_hayamax',
          respostaMl: {
            release_at: releaseAt.toISOString(),
            reason: releaseReasonRaw || null,
            fornecedor_id: fornecedorId || null,
            fornecedor_nome: (compraVinculada as any)?.fornecedor_nome || null,
            allowed_fornecedor_id: HAYAMAX_FORNECEDOR_ID,
            stage: 'etiqueta_auto_precheck',
            label_source: DSLITE_PLACEHOLDER_LABEL_SOURCE,
          },
          statusResultante: 'blocked',
        });
        updateStep(steps, 'check_ml_invoice_xml', {
          status: 'warning',
          detail: msg,
        });
        updateStep(steps, 'ensure_brasilnfe_invoice', {
          status: 'skipped',
          detail: 'Etapa pulada: etiqueta real ainda não liberada',
        });
        updateStep(steps, 'upload_invoice_ml', {
          status: 'skipped',
          detail: 'Etapa pulada: etiqueta real ainda não liberada',
        });
        updateStep(steps, 'download_label_ml', {
          status: 'warning',
          detail: msg,
        });
        updateStep(steps, 'set_carrier_dslite', {
          status: 'skipped',
          detail: 'Etapa pulada: aguardando etiqueta real do Mercado Livre',
        });
        updateStep(steps, 'send_label_dslite', {
          status: 'warning',
          detail: 'Etapa não executada: etiqueta genérica bloqueada para fornecedor diferente da Hayamax',
        });
        return finalizeSuccess(steps, {
          partial: true,
          labelSource: 'mercado_livre_pending',
          blockedPlaceholder: true,
          fornecedorId: fornecedorId || null,
          operationStatus: 'waiting_ml_label',
          nextAction: 'wait_ml_label',
          message: msg,
        });
      }
      const msg = `Etiqueta ML ainda não liberada até ${releaseLabel}; usando etiqueta padrão Hayamax.`;
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        mlPackId: (pedido as any).ml_pack_id ? String((pedido as any).ml_pack_id) : null,
        evento: 'ml_fiscal_release_window_placeholder_label_selected',
        respostaMl: {
          release_at: releaseAt.toISOString(),
          reason: releaseReasonRaw || null,
          checked_at: new Date().toISOString(),
          now_utc: new Date().toISOString(),
          blocked_now: true,
          stage: 'etiqueta_auto_precheck',
          label_source: DSLITE_PLACEHOLDER_LABEL_SOURCE,
        },
        statusResultante: 'placeholder_label',
      });
      updateStep(steps, 'check_ml_invoice_xml', {
        status: 'warning',
        detail: msg,
      });
      updateStep(steps, 'ensure_brasilnfe_invoice', {
        status: 'skipped',
        detail: 'Etapa pulada: etiqueta padrão não altera a NF',
      });
      updateStep(steps, 'upload_invoice_ml', {
        status: 'skipped',
        detail: 'Etapa pulada: etiqueta ML ainda não liberada',
      });
      updateStep(steps, 'download_label_ml', {
        status: 'warning',
        detail: msg,
      });

      const etiquetaPdf = await loadDslitePlaceholderLabel().catch((err: any) => {
        updateStep(steps, 'download_label_ml', {
          status: 'error',
          error: err?.message || 'Falha ao carregar etiqueta padrão DSLite',
        });
        return null;
      });
      if (!etiquetaPdf) {
        return stepError(
          steps,
          'download_label_ml',
          'Falha ao carregar etiqueta padrão DSLite',
          { reason: 'placeholder_label_load_failed', releaseAt: releaseAt.toISOString() },
        );
      }

      updateStep(steps, 'set_carrier_dslite', { status: 'loading' });
      const pedidoDslite = await consultarPedido(dsid);
      const carrierId = Number((pedidoDslite as any)?.transportadora?.transportadoraid || 0);
      if (carrierId > 0) {
        updateStep(steps, 'set_carrier_dslite', {
          status: 'skipped',
          detail: `Etapa pulada: transportadora já definida (id ${carrierId})`,
        });
      } else {
        const transportadoraResult = await definirTransportadoraPedido(dsid, TRANSPORTADORA_PADRAO_CORREIOS);
        if (!transportadoraResult?.success) {
          return stepError(
            steps,
            'set_carrier_dslite',
            transportadoraResult?.message || 'Falha ao definir transportadora na DSLite',
            { reason: 'set_carrier_failed', dsid: String(dsid) },
          );
        }
        updateStep(steps, 'set_carrier_dslite', { status: 'success', detail: 'Transportadora definida com sucesso' });
      }

      updateStep(steps, 'send_label_dslite', { status: 'loading' });
      const envioResult = await enviarEtiqueta(dsid, etiquetaPdf, DSLITE_PLACEHOLDER_LABEL_FILE_NAME);
      if (!envioResult?.success) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'placeholder_label_send_failed',
          respostaMl: {
            release_at: releaseAt.toISOString(),
            label_source: DSLITE_PLACEHOLDER_LABEL_SOURCE,
            error: envioResult?.message || 'Falha ao enviar etiqueta padrão para DSLite',
          },
          statusResultante: 'failed',
        });
        return stepError(
          steps,
          'send_label_dslite',
          envioResult?.message || 'Falha ao enviar etiqueta padrão para DSLite',
          { reason: 'placeholder_label_send_failed', releaseAt: releaseAt.toISOString() },
        );
      }

      await client
        .from('pedidos')
        .update({ dslite_etiqueta_enviada: true } as any)
        .eq('id', pedidoId);

      updateStep(steps, 'send_label_dslite', { status: 'success', detail: 'Etiqueta padrão Hayamax enviada com sucesso para DSLite' });
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'placeholder_label_send_success',
        respostaMl: {
          release_at: releaseAt.toISOString(),
          label_source: DSLITE_PLACEHOLDER_LABEL_SOURCE,
          file_name: DSLITE_PLACEHOLDER_LABEL_FILE_NAME,
          bytes: etiquetaPdf.length,
        },
        statusResultante: 'success',
      });
      return finalizeSuccess(steps, {
        partial: true,
        labelSource: DSLITE_PLACEHOLDER_LABEL_SOURCE,
        operationStatus: 'placeholder_label_sent',
        nextAction: 'wait_real_ml_label',
        message: 'Etiqueta padrão Hayamax enviada porque a etiqueta ML ainda não foi liberada.',
      });
    }

    if (Boolean((pedido as any).dslite_etiqueta_enviada)) {
      (Object.keys(STEP_LABELS) as StepKey[]).forEach((stepKey) => {
        updateStep(steps, stepKey, { status: 'skipped', detail: 'Etapa pulada: etiqueta já enviada anteriormente' });
      });
      return finalizeSuccess(steps, {
        partial: false,
        skippedBecauseAlreadyDone: true,
        operationStatus: 'already_done',
        nextAction: 'done',
      });
    }

    // 1) Verificar vínculo fiscal no ML (shipment invoice_data)
    updateStep(steps, 'check_ml_invoice_xml', { status: 'loading' });
    await registrarEventoNfAuditoria({
      pedidoId: String(pedidoId),
      mlOrderId,
      evento: 'ml_invoice_xml_check_start',
      payloadEnviado: {
        ml_order_id: mlOrderId,
        ml_shipment_id: shipmentId || null,
        policy: 'brasilnfe_only_sem_invoice_order_ml',
      },
      statusResultante: 'starting',
    });

    let mlHasXml = false;
    let mlFiscalKeyDetected: string | null = null;
    let xmlParaUso = String((pedido as any).nfe_xml || '').trim() || null;
    let fiscalKeyLocal = String((pedido as any).nfe_chave || '').trim() || null;
    if (shipmentId) {
      const shipmentInvoiceData = await consultarInvoiceDataPorShipmentML(shipmentId, 'MLB');
      const shipmentFiscalKey = shipmentInvoiceData.ok
        ? String(shipmentInvoiceData.data?.fiscal_key || '').trim()
        : '';
      const localFiscalKey = String(fiscalKeyLocal || '').trim();

      if (shipmentInvoiceData.ok && shipmentFiscalKey && localFiscalKey && shipmentFiscalKey === localFiscalKey) {
        mlHasXml = true;
        mlFiscalKeyDetected = shipmentFiscalKey;
        updateStep(steps, 'check_ml_invoice_xml', {
          status: 'success',
          detail: `NF já vinculada no shipment ML (${shipmentId}) por fiscal_key`,
        });
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_xml_check_success',
          respostaMl: {
            has_fiscal_key_on_shipment: true,
            shipment_id: shipmentId,
            fiscal_key: shipmentFiscalKey,
            fiscal_key_local: localFiscalKey,
            match_local_key: true,
          },
          statusResultante: 'success',
        });
      } else {
        updateStep(steps, 'check_ml_invoice_xml', {
          status: 'warning',
          detail: shipmentInvoiceData.error || 'Pedido ainda sem vínculo fiscal no shipment do ML',
        });
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_xml_check_failed',
          respostaMl: {
            shipment_id: shipmentId,
            shipment_fiscal_key: shipmentFiscalKey || null,
            fiscal_key_local: localFiscalKey || null,
            match_local_key: Boolean(shipmentFiscalKey && localFiscalKey && shipmentFiscalKey === localFiscalKey),
            shipment_invoice_data_ok: shipmentInvoiceData.ok,
            shipment_invoice_data_error: shipmentInvoiceData.error || null,
            shipment_invoice_data_status: shipmentInvoiceData.statusCode || null,
          },
          statusResultante: 'warning',
        });
      }
    } else {
      updateStep(steps, 'check_ml_invoice_xml', {
        status: 'warning',
        detail: 'Pedido sem shipment no ML para verificação de vínculo fiscal',
      });
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'ml_invoice_xml_check_failed',
        respostaMl: {
          error: 'shipment_ausente',
          has_fiscal_key_on_shipment: false,
        },
        statusResultante: 'warning',
      });
    }

    // 2) Garantir NF na Brasil NFe (sempre obrigatório para manter Brasil NFe como fonte fiscal única)
    updateStep(steps, 'ensure_brasilnfe_invoice', { status: 'loading' });
    await registrarEventoNfAuditoria({
      pedidoId: String(pedidoId),
      mlOrderId,
      evento: 'brasilnfe_invoice_ensure_start',
      payloadEnviado: { pedido_id: String(pedidoId) },
      statusResultante: 'starting',
    });

    let ensured = await ensureBrasilNfeInvoice({ pedidoId: String(pedidoId) });
      if (!ensured.ok) {
        if (ensured.issueType === 'duplicate_identifier') {
          const existingNfe = ensured.existingNfe || null;
          if (!nfeDuplicateAction) {
            updateStep(steps, 'ensure_brasilnfe_invoice', {
              status: 'error',
              error: 'NF já existente para este pedido na Brasil NFe',
              detail: existingNfe?.chave
                ? `NF encontrada: ${existingNfe.numero ? `nº ${existingNfe.numero} · ` : ''}chave ${existingNfe.chave}`
                : 'NF existente encontrada na Brasil NFe',
            });
            return NextResponse.json(
              {
                success: false,
                step: 'ensure_brasilnfe_invoice',
                error: 'NF já existente para este pedido na Brasil NFe',
                actionRequired: 'choose_existing_or_reissue',
                existingNfe,
                identificadorInterno: ensured.identificadorInterno || null,
                details: {
                  provider: 'brasilnfe',
                  reason: 'duplicate_identifier',
                  errorDetails: ensured.errorDetails || null,
                  pedidoId: String(pedidoId),
                  mlOrderId,
                },
                data: { steps },
              },
              { status: 409 },
            );
          }

          if (nfeDuplicateAction === 'use_existing') {
            await registrarEventoNfAuditoria({
              pedidoId: String(pedidoId),
              mlOrderId,
              evento: 'brasilnfe_duplicate_user_decision_use_existing',
              respostaMl: {
                identificador_interno: ensured.identificadorInterno || null,
                nfe_chave_encontrada: existingNfe?.chave || null,
              },
              statusResultante: 'use_existing',
            });
            ensured = await ensureBrasilNfeInvoice({
              pedidoId: String(pedidoId),
              skipDuplicateLookup: true,
            });
            if (!ensured.ok) {
              return stepError(
                steps,
                'ensure_brasilnfe_invoice',
                ensured.error || 'Falha ao carregar NF existente para prosseguir',
                {
                  provider: 'brasilnfe',
                  reason: 'use_existing_failed',
                  errorDetails: ensured.errorDetails || null,
                },
              );
            }
          } else if (nfeDuplicateAction === 'reissue') {
            if (!existingNfe?.chave) {
              return stepError(
                steps,
                'ensure_brasilnfe_invoice',
                'Não foi possível localizar a NF existente para cancelar e reemitir.',
                {
                  provider: 'brasilnfe',
                  reason: 'duplicate_note_not_found_for_reissue',
                  identificadorInterno: ensured.identificadorInterno || null,
                },
              );
            }

            await registrarEventoNfAuditoria({
              pedidoId: String(pedidoId),
              mlOrderId,
              evento: 'brasilnfe_duplicate_user_decision_reissue',
              respostaMl: {
                identificador_interno: ensured.identificadorInterno || null,
                nfe_chave_encontrada: existingNfe.chave,
              },
              statusResultante: 'reissue',
            });
            await registrarEventoNfAuditoria({
              pedidoId: String(pedidoId),
              mlOrderId,
              evento: 'brasilnfe_duplicate_cancel_start',
              respostaMl: {
                nfe_chave_encontrada: existingNfe.chave,
                numero_protocolo: existingNfe.numeroProtocolo || (pedido as any)?.nfe_protocolo || null,
              },
              statusResultante: 'starting',
            });

            const cancel = await cancelarNotaBrasilNfePorChave({
              chave: existingNfe.chave,
              protocolo: existingNfe.numeroProtocolo || (pedido as any)?.nfe_protocolo || null,
              justificativa: 'Cancelamento para reemissão operacional da etiqueta DSLite',
            });
            if (!cancel.ok) {
              await registrarEventoNfAuditoria({
                pedidoId: String(pedidoId),
                mlOrderId,
                evento: 'brasilnfe_duplicate_cancel_failed',
                respostaMl: {
                  nfe_chave_encontrada: existingNfe.chave,
                  error: cancel.error || null,
                  provider_error_raw: cancel.raw || null,
                },
                statusResultante: 'failed',
              });
              return stepError(
                steps,
                'ensure_brasilnfe_invoice',
                'Não foi possível cancelar a nota atual para reemitir.',
                {
                  provider: 'brasilnfe',
                  reason: 'cancel_before_reissue_failed',
                  errorDetails: cancel.raw || null,
                  error: cancel.error || null,
                },
              );
            }

            await registrarEventoNfAuditoria({
              pedidoId: String(pedidoId),
              mlOrderId,
              evento: 'brasilnfe_duplicate_cancel_success',
              respostaMl: {
                nfe_chave_encontrada: existingNfe.chave,
                cancel_status: 'success',
                provider_raw: cancel.raw || null,
              },
              statusResultante: 'success',
            });

            await client
              .from('pedidos')
              .update({
                nfe_xml: null,
                nfe_chave: null,
                nfe_status: null,
                nfe_external_id: null,
                nfe_protocolo: null,
                nota_fiscal_numero: null,
                nfe_danfe_url: null,
                nfe_cfop: null,
                nfe_last_sync_at: new Date().toISOString(),
              } as any)
              .eq('id', pedidoId);

            const newIdentifier = `VORTEK-${String((pedido as any)?.numero || pedidoId)}-R${Date.now()}`;
            ensured = await ensureBrasilNfeInvoice({
              pedidoId: String(pedidoId),
              identifierInternoOverride: newIdentifier,
              skipDuplicateLookup: true,
            });
            if (!ensured.ok) {
              return stepError(
                steps,
                'ensure_brasilnfe_invoice',
                ensured.error || 'Falha ao reemitir NF após cancelamento',
                {
                  provider: 'brasilnfe',
                  reason: 'reissue_after_cancel_failed',
                  errorDetails: ensured.errorDetails || null,
                },
              );
            }
            await registrarEventoNfAuditoria({
              pedidoId: String(pedidoId),
              mlOrderId,
              evento: 'brasilnfe_duplicate_reissue_success',
              respostaMl: {
                identificador_interno: newIdentifier,
                nfe_chave_nova: ensured.chave || null,
                nfe_numero_novo: ensured.numero || null,
              },
              statusResultante: 'success',
            });
          }
        }

      if (!ensured.ok) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'brasilnfe_invoice_ensure_failed',
          respostaMl: {
            error: ensured.error || 'Falha ao garantir NF na Brasil NFe',
            errorDetails: ensured.errorDetails || null,
            consistency: ensured.consistency || null,
          },
          statusResultante: 'failed',
        });
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'brasilnfe_emit_failed_detailed',
          respostaMl: {
            error: ensured.error || 'Falha ao garantir NF na Brasil NFe',
            provider_error_raw: ensured.errorDetails || null,
          },
          statusResultante: 'failed',
        });
        return stepError(
          steps,
          'ensure_brasilnfe_invoice',
          ensured.error || 'Falha ao garantir NF na Brasil NFe',
          {
            provider: 'brasilnfe',
            reason: 'brasilnfe_ensure_failed',
            errorDetails: ensured.errorDetails || null,
            pedidoId: String(pedidoId),
            mlOrderId,
          },
        );
      }
    }

    xmlParaUso = ensured.xml || xmlParaUso;
    fiscalKeyLocal = ensured.chave || fiscalKeyLocal;
    updateStep(steps, 'ensure_brasilnfe_invoice', {
      status: ensured.alreadyExisted ? 'skipped' : 'success',
      detail: ensured.alreadyExisted
        ? 'Etapa pulada: NF já existia autorizada na Brasil NFe'
        : 'NF garantida com sucesso na Brasil NFe',
    });
    await registrarEventoNfAuditoria({
      pedidoId: String(pedidoId),
      mlOrderId,
      evento: 'brasilnfe_invoice_ensure_success',
      respostaMl: {
        already_existed: ensured.alreadyExisted || false,
        nfe_chave: ensured.chave || null,
        nfe_numero: ensured.numero || null,
        nfe_external_id: ensured.externalId || null,
      },
      statusResultante: 'success',
    });

    // 3) Subir NF no ML via shipment invoice_data (somente vínculo; nunca emissão fiscal)
    if (mlHasXml && mlFiscalKeyDetected && fiscalKeyLocal && mlFiscalKeyDetected === fiscalKeyLocal) {
      updateStep(steps, 'upload_invoice_ml', {
        status: 'skipped',
        detail: 'Etapa pulada: pedido já possui vínculo fiscal no ML',
      });
    } else {
      updateStep(steps, 'upload_invoice_ml', { status: 'loading' });
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'ml_invoice_data_upload_start',
        payloadEnviado: {
          ml_shipment_id: shipmentId || null,
          endpoint_ml: '/shipments/{shipment_id}/invoice_data?siteId=MLB',
        },
        statusResultante: 'starting',
      });

      if (!shipmentId) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: { error: 'Pedido sem ml_shipment_id para upload fiscal no ML' },
          statusResultante: 'failed',
        });
        return stepError(steps, 'upload_invoice_ml', 'Pedido sem ml_shipment_id para subir NF no ML', undefined, 400);
      }
      if (!xmlParaUso) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: { error: 'NF sem XML para upload fiscal no ML' },
          statusResultante: 'failed',
        });
        return stepError(steps, 'upload_invoice_ml', 'NF sem XML para subir no ML');
      }

      const nfNumber = extractTag(xmlParaUso, 'nNF') || String(ensured.numero || (pedido as any).nota_fiscal_numero || '').trim();
      const nfSerie = extractTag(xmlParaUso, 'serie') || '1';
      const nfDateIso = parseInvoiceDateFromXml(xmlParaUso) || new Date().toISOString();
      const nfAmount = parseInvoiceAmountFromXml(xmlParaUso) || Number((pedido as any).total || 0);
      const cfop = extractTag(xmlParaUso, 'CFOP') || String((pedido as any).nfe_cfop || '').trim() || undefined;
      const fiscalKey = fiscalKeyLocal || extractTag(xmlParaUso, 'chNFe');

      if (!fiscalKey || !nfNumber || !(nfAmount > 0)) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: {
            error: 'Campos mínimos da NF ausentes para upload ML',
            fiscal_key: fiscalKey || null,
            invoice_number: nfNumber || null,
            invoice_amount: nfAmount || null,
          },
          statusResultante: 'failed',
        });
        return stepError(steps, 'upload_invoice_ml', 'NF incompleta para subir no ML (chave/número/valor)');
      }

      const uploadRes = await upsertInvoiceDataMLByShipment({
        shipmentId,
        fiscalKey,
        invoiceNumber: nfNumber,
        invoiceSerie: nfSerie,
        invoiceDate: nfDateIso,
        invoiceAmount: nfAmount,
        nfeXml: xmlParaUso,
        cfop,
      });

      for (const [idx, attempt] of (uploadRes.attempts || []).entries()) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_attempt',
          respostaMl: {
            ml_shipment_id: shipmentId,
            method: attempt.method,
            endpoint: attempt.endpoint,
            content_type: attempt.contentType,
            status_http: attempt.statusCode ?? null,
            error_code: attempt.code || null,
            error_message: attempt.message || null,
            attempt_index: idx + 1,
            attempts_total: (uploadRes.attempts || []).length,
            content_mode_selected: uploadRes.contentMode || null,
          },
          statusResultante: 'attempt',
        });
      }

      if (!uploadRes.ok) {
        const attempts = uploadRes.attempts || [];
        const friendlyError = uploadRes.error || 'Falha ao subir dados fiscais da NF no ML';
        if (uploadRes.errorCode === 'ml_fiscal_endpoint_blocked') {
          await registrarEventoNfAuditoria({
            pedidoId: String(pedidoId),
            mlOrderId,
            evento: 'ml_fiscal_runtime_call_denied',
            respostaMl: {
              endpoint_ml: uploadRes.endpoint || null,
              method: uploadRes.method || uploadRes.lastMethodTried || null,
              blocked_reason: 'fiscal_ml_desativado_por_politica',
              reason: uploadRes.reason || null,
            },
            statusResultante: 'denied',
          });
        }
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: {
            endpoint_ml: uploadRes.endpoint || null,
            method: uploadRes.method || null,
            last_method_tried: uploadRes.lastMethodTried || null,
            content_mode: uploadRes.contentMode || null,
            status_http: uploadRes.statusCode || null,
            error_code: uploadRes.errorCode || null,
            error: uploadRes.error || null,
            reason: uploadRes.reason || null,
            attempts,
          },
          statusResultante: 'failed',
        });
        return stepError(
          steps,
          'upload_invoice_ml',
          friendlyError,
          {
            reason: uploadRes.reason || 'ml_invoice_data_upload_failed',
            status_http: uploadRes.statusCode || null,
            error_code_ml: uploadRes.errorCode || null,
            error_message_ml: uploadRes.error || null,
            endpoint_ml: uploadRes.endpoint || null,
            contentMode: uploadRes.contentMode || null,
            lastMethodTried: uploadRes.lastMethodTried || uploadRes.method || null,
            attempts,
          },
        );
      }

      const verify = await consultarInvoiceDataPorShipmentML(shipmentId, 'MLB');
      const mlFiscalKey = verify.ok ? String(verify.data?.fiscal_key || '').trim() : '';
      if (verify.ok && mlFiscalKey && mlFiscalKey === fiscalKey) {
        updateStep(steps, 'upload_invoice_ml', {
          status: 'success',
          detail: `NF vinculada no ML (shipment ${shipmentId})`,
        });
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_success',
          respostaMl: {
            endpoint_ml: uploadRes.endpoint || null,
            method: uploadRes.method || null,
            last_method_tried: uploadRes.lastMethodTried || null,
            status_http: uploadRes.statusCode || null,
            fiscal_key_local: fiscalKey,
            fiscal_key_ml: mlFiscalKey,
            reason: uploadRes.reason || null,
            content_mode_selected: uploadRes.contentMode || null,
            attempts: uploadRes.attempts || [],
          },
          statusResultante: 'success',
        });
      } else {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: {
            endpoint_ml: uploadRes.endpoint || null,
            method: uploadRes.method || null,
            status_http: uploadRes.statusCode || null,
            fiscal_key_local: fiscalKey,
            fiscal_key_ml: mlFiscalKey || null,
            verify_error: verify.error || null,
          },
          statusResultante: 'failed_verify',
        });
        return stepError(
          steps,
          'upload_invoice_ml',
          'Não foi possível confirmar o vínculo fiscal da NF no ML após upload.',
          {
            fiscal_key_local: fiscalKey,
            fiscal_key_ml: mlFiscalKey || null,
            verify_error: verify.error || null,
          },
        );
      }
    }

    // 4) Baixar etiqueta do ML (retry 5s por 1 min)
    if (!shipmentId) {
      updateStep(steps, 'download_label_ml', {
        status: 'warning',
        detail: 'Pedido sem shipment no ML. Etiqueta indisponível.',
      });
      updateStep(steps, 'set_carrier_dslite', {
        status: 'warning',
        detail: 'Etapa não executada por etiqueta indisponível',
      });
      updateStep(steps, 'send_label_dslite', {
        status: 'warning',
        detail: 'Etapa não executada por etiqueta indisponível',
      });
      return finalizeSuccess(steps, {
        partial: true,
        operationStatus: 'waiting_ml_label',
        nextAction: 'wait_ml_label',
        message: 'Etiqueta ainda indisponível no ML. A NF foi emitida somente na Brasil NFe.',
      });
    }

    updateStep(steps, 'download_label_ml', { status: 'loading' });
    let attempts = 0;
    const startedAt = Date.now();
    let etiquetaPdf: Buffer | null = null;
    let lastError = 'Falha ao baixar etiqueta do ML';
    let lastReason: string | null = null;
    let lastStatusCode: number | null = null;
    let stoppedByNonRetryable = false;

    while (Date.now() - startedAt <= LABEL_WAIT_TIMEOUT_MS) {
      attempts += 1;
      const elapsedMs = Date.now() - startedAt;
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'ml_label_download_attempt',
        payloadEnviado: {
          ml_shipment_id: shipmentId,
          tentativa: attempts,
          elapsed_ms: elapsedMs,
        },
        statusResultante: 'attempt',
      });

      const etiquetaResult = await baixarEtiquetaML(shipmentId);
      if (etiquetaResult.pdf) {
        etiquetaPdf = etiquetaResult.pdf;
        await storeShippingLabelForPedido({
          client,
          pedidoId: String(pedidoId),
          pedidoNumero: (pedido as any).numero,
          mlOrderId: mlOrderId || null,
          shipmentId,
          pdf: etiquetaResult.pdf,
          source: 'dslite_etiqueta_auto',
        });
        updateStep(steps, 'download_label_ml', {
          status: 'success',
          detail: `${etiquetaResult.pdf.length.toLocaleString('pt-BR')} bytes`,
        });
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_label_download_success',
          respostaMl: {
            ml_shipment_id: shipmentId,
            tentativa: attempts,
            elapsed_ms: Date.now() - startedAt,
            status_http: etiquetaResult.statusCode || null,
            reason: etiquetaResult.reason || null,
            bytes: etiquetaResult.pdf.length,
          },
          statusResultante: 'success',
        });
        break;
      }

      lastError = etiquetaResult.error || lastError;
      lastReason = etiquetaResult.reason || null;
      lastStatusCode = etiquetaResult.statusCode ?? null;

      const elapsedNow = Date.now() - startedAt;
      const canRetry = Boolean(etiquetaResult.retryable);
      const wouldExceed = elapsedNow + LABEL_RETRY_INTERVAL_MS > LABEL_WAIT_TIMEOUT_MS;
      if (canRetry && !wouldExceed) {
        await registrarEventoNfAuditoria({
          pedidoId: String(pedidoId),
          mlOrderId,
          evento: 'ml_label_download_retry',
          respostaMl: {
            ml_shipment_id: shipmentId,
            tentativa: attempts,
            elapsed_ms: elapsedNow,
            status_http: lastStatusCode,
            reason: lastReason,
            error: lastError,
            retry_in_ms: LABEL_RETRY_INTERVAL_MS,
          },
          statusResultante: 'retrying',
        });
        await new Promise((resolve) => setTimeout(resolve, LABEL_RETRY_INTERVAL_MS));
        continue;
      }

      if (!canRetry) stoppedByNonRetryable = true;
      break;
    }

    if (!etiquetaPdf) {
      const elapsedMs = Date.now() - startedAt;
      const timeoutError = 'Etiqueta ainda não disponível no ML após 1 minuto.';
      const nonRetryableError = 'Etiqueta indisponível no ML (erro não temporário).';
      const message = stoppedByNonRetryable ? nonRetryableError : timeoutError;
      updateStep(steps, 'download_label_ml', {
        status: 'warning',
        detail: message,
      });
      updateStep(steps, 'set_carrier_dslite', {
        status: 'warning',
        detail: 'Etapa não executada por etiqueta indisponível',
      });
      updateStep(steps, 'send_label_dslite', {
        status: 'warning',
        detail: 'Etapa não executada por etiqueta indisponível',
      });
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'ml_label_download_timeout',
        respostaMl: {
          ml_shipment_id: shipmentId,
          attempts,
          elapsed_ms: elapsedMs,
          status_http: lastStatusCode,
          reason: lastReason,
          error: lastError,
          stopped_by_non_retryable: stoppedByNonRetryable,
        },
        statusResultante: stoppedByNonRetryable ? 'failed' : 'timeout',
      });
      return finalizeSuccess(steps, {
        partial: true,
        operationStatus: 'waiting_ml_label',
        nextAction: 'wait_ml_label',
        message: 'Etiqueta ainda indisponível no ML. A NF foi emitida somente na Brasil NFe.',
        details: {
          reason: lastReason,
          statusCode: lastStatusCode,
          attempts,
          elapsedMs,
          providerError: lastError,
        },
      });
    }

    // 5) Definir transportadora na DSLite (skip se já definida)
    updateStep(steps, 'set_carrier_dslite', { status: 'loading' });
    const pedidoDslite = await consultarPedido(dsid);
    const carrierId = Number((pedidoDslite as any)?.transportadora?.transportadoraid || 0);
    if (carrierId > 0) {
      updateStep(steps, 'set_carrier_dslite', {
        status: 'skipped',
        detail: `Etapa pulada: transportadora já definida (id ${carrierId})`,
      });
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'dslite_carrier_skipped_existing',
        respostaMl: {
          dsid: String(dsid),
          carrier_id: carrierId,
        },
        statusResultante: 'skipped',
      });
    } else {
      const transportadoraResult = await definirTransportadoraPedido(dsid, TRANSPORTADORA_PADRAO_CORREIOS);
      if (!transportadoraResult?.success) {
        return stepError(
          steps,
          'set_carrier_dslite',
          transportadoraResult?.message || 'Falha ao definir transportadora na DSLite',
          {
            reason: 'set_carrier_failed',
            dsid: String(dsid),
          },
        );
      }
      updateStep(steps, 'set_carrier_dslite', { status: 'success', detail: 'Transportadora definida com sucesso' });
    }

    // 6) Enviar etiqueta para DSLite
    updateStep(steps, 'send_label_dslite', { status: 'loading' });
    const envioResult = await enviarEtiqueta(dsid, etiquetaPdf, 'etiqueta_ml.pdf');
    if (!envioResult?.success) {
      await registrarEventoNfAuditoria({
        pedidoId: String(pedidoId),
        mlOrderId,
        evento: 'ml_label_send_failed',
        respostaMl: {
          ml_shipment_id: shipmentId,
          error: envioResult?.message || 'Falha ao enviar etiqueta para DSLite',
        },
        statusResultante: 'failed',
      });
      return stepError(
        steps,
        'send_label_dslite',
        envioResult?.message || 'Falha ao enviar etiqueta para DSLite',
        { reason: 'label_send_failed' },
      );
    }

    await client
      .from('pedidos')
      .update({ dslite_etiqueta_enviada: true } as any)
      .eq('id', pedidoId);

    updateStep(steps, 'send_label_dslite', { status: 'success', detail: 'Etiqueta enviada com sucesso para DSLite' });
    await registrarEventoNfAuditoria({
      pedidoId: String(pedidoId),
      mlOrderId,
      evento: 'ml_label_send_success',
      respostaMl: {
        ml_shipment_id: shipmentId,
        attempts,
        elapsed_ms: Date.now() - startedAt,
      },
      statusResultante: 'success',
    });

    return finalizeSuccess(steps, {
      partial: false,
      etiquetaBaixada: true,
      etiquetaBytes: etiquetaPdf.length,
      etiquetaEnviada: true,
      operationStatus: 'label_sent',
      nextAction: 'done',
      message: 'Etiqueta real enviada para DSLite.',
    });
  } catch (err: any) {
    return stepError(steps, 'check_ml_invoice_xml', err?.message || 'Erro interno ao enviar etiqueta', undefined, 500);
  }
}
