'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { ProgressStep } from '@/components/modals/ProgressModal';
import type { Order } from '@/types/order';
import { isValidDsliteId } from './usePedidosDsliteFlow';
import type { PedidosDsliteFlow } from './usePedidosDsliteFlow';

interface EtiquetaDuplicateDecision {
  pedidoId: string;
  dsid: string;
  mlOrderId: string;
  existingNfe: {
    chave: string;
    numero?: number | null;
    status?: number | null;
    dataEmissao?: string | null;
    linkInterno?: string | null;
  } | null;
  identificadorInterno?: string | null;
}

interface UsePedidosLabelWhatsappFlowOptions {
  messageApi: MessageInstance;
  refreshOrders: () => void | Promise<void>;
  updateOrder: (order: Order, patch: Partial<Order>) => void;
  openShippingSelection: PedidosDsliteFlow['openShippingSelection'];
}

function initWhatsappLabelSteps(): ProgressStep[] {
  return [
    { label: 'Validando pedido e WhatsApp', status: 'loading', detail: 'Validando número de destino e pedido de venda' },
    { label: 'Localizando envio Mercado Livre', status: 'pending' },
    { label: 'Buscando pedido de compra vinculado', status: 'pending' },
    { label: 'Localizando etiqueta salva', status: 'pending' },
    { label: 'Vinculando XML da NF no Mercado Livre', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Salvando etiqueta no sistema', status: 'pending' },
    { label: 'Gerando links públicos da etiqueta e NF', status: 'pending' },
    { label: 'Enviando mensagem pelo WhatsApp', status: 'pending' },
  ];
}

function initLabelSteps(): ProgressStep[] {
  return [
    { label: 'Verificando vínculo fiscal no Mercado Livre', status: 'pending', detail: 'Fonte fiscal única: Brasil NFe. ML é usado apenas para vínculo documental e etiqueta.' },
    { label: 'Garantindo NF na Brasil NFe', status: 'pending' },
    { label: 'Vinculando NF Brasil NFe no Mercado Livre', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Definindo transporte na DSLite', status: 'pending' },
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ];
}

export function usePedidosLabelWhatsappFlow({
  messageApi,
  refreshOrders,
  updateOrder,
  openShippingSelection,
}: UsePedidosLabelWhatsappFlowOptions) {
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [sendingWhatsappLabel, setSendingWhatsappLabel] = useState(false);
  const [whatsappOrder, setWhatsappOrder] = useState<Order | null>(null);
  const [whatsappUsePlaceholderLabel, setWhatsappUsePlaceholderLabel] = useState(false);
  const [whatsappProgressOpen, setWhatsappProgressOpen] = useState(false);
  const [whatsappSteps, setWhatsappSteps] = useState<ProgressStep[]>(initWhatsappLabelSteps());
  const whatsappPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [labelProgressOpen, setLabelProgressOpen] = useState(false);
  const [labelDownloadUrl, setLabelDownloadUrl] = useState<string | null>(null);
  const [labelZplDownloadUrl, setLabelZplDownloadUrl] = useState<string | null>(null);
  const [labelDuplicateDecision, setLabelDuplicateDecision] = useState<EtiquetaDuplicateDecision | null>(null);
  const [labelSteps, setLabelSteps] = useState<ProgressStep[]>(initLabelSteps());
  const labelOrderRef = useRef<Order | null>(null);

  const stopWhatsappPolling = useCallback(() => {
    if (!whatsappPollRef.current) return;
    clearTimeout(whatsappPollRef.current);
    whatsappPollRef.current = null;
  }, []);

  useEffect(() => stopWhatsappPolling, [stopWhatsappPolling]);

  const openWhatsappLabel = useCallback((order: Order, usePlaceholderLabel = false) => {
    setWhatsappOrder(order);
    setWhatsappUsePlaceholderLabel(usePlaceholderLabel);
    setWhatsappPhone(order.fornecedor_telefone || '');
    setWhatsappModalOpen(true);
  }, []);

  const closeWhatsappLabelModal = useCallback(() => {
    if (sendingWhatsappLabel) return;
    setWhatsappModalOpen(false);
    setWhatsappOrder(null);
    setWhatsappUsePlaceholderLabel(false);
    setWhatsappPhone('');
  }, [sendingWhatsappLabel]);

  const sendWhatsappLabel = useCallback(async () => {
    if (!whatsappOrder) return;
    const phoneNumber = whatsappPhone.replace(/\D/g, '');
    if (!phoneNumber) {
      messageApi.warning('Informe o número de WhatsApp do destinatário.');
      return;
    }

    setSendingWhatsappLabel(true);
    setWhatsappSteps(initWhatsappLabelSteps());
    setWhatsappProgressOpen(true);
    setWhatsappModalOpen(false);
    try {
      const res = await fetch(`/api/pedidos/${whatsappOrder.dbId}/enviar-etiqueta-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, usePlaceholderLabel: whatsappUsePlaceholderLabel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.jobId) throw new Error(json.error || 'Erro ao iniciar envio de etiqueta por WhatsApp');

      const poll = async (): Promise<void> => {
        const statusRes = await fetch(`/api/pedidos/${whatsappOrder.dbId}/enviar-etiqueta-whatsapp/status?jobId=${encodeURIComponent(json.jobId)}`);
        const statusData = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok || !statusData?.success) {
          throw new Error(statusData?.error || 'Falha ao consultar status do envio por WhatsApp');
        }

        const mapped: ProgressStep[] = (statusData.steps || []).map((step: any) => ({
          label: step.label,
          status: step.status,
          detail: step.detail,
          error: step.error,
        }));
        if (mapped.length) setWhatsappSteps(mapped);

        const state = String(statusData.state || '');
        if (state === 'running') {
          whatsappPollRef.current = setTimeout(() => {
            poll().catch((error) => {
              setWhatsappSteps((previous) => {
                const updated = [...previous];
                const firstActive = updated.findIndex((step) => step.status === 'loading' || step.status === 'pending');
                const index = firstActive >= 0 ? firstActive : updated.length - 1;
                updated[index] = { ...updated[index], status: 'error', error: error.message || 'Erro ao acompanhar envio por WhatsApp' };
                return updated;
              });
              setSendingWhatsappLabel(false);
            });
          }, 1200);
          return;
        }

        setSendingWhatsappLabel(false);
        if (state === 'success' || state === 'warning') {
          updateOrder(whatsappOrder, {
            whatsapp_label_status: whatsappUsePlaceholderLabel ? 'test_sent' : 'sent',
            whatsapp_label_updated_at: new Date().toISOString(),
            whatsapp_label_error: null,
            whatsapp_label_next_retry_at: null,
          });
          messageApi.success(statusData.data?.message || 'Etiqueta enviada por WhatsApp.');
          setWhatsappOrder(null);
          setWhatsappUsePlaceholderLabel(false);
          return;
        }

        if (state === 'on_hold') {
          const retryAt = statusData.nextRetryAt
            ? new Date(statusData.nextRetryAt).toLocaleString('pt-BR')
            : null;
          updateOrder(whatsappOrder, {
            whatsapp_label_status: 'on_hold',
            whatsapp_label_updated_at: new Date().toISOString(),
            whatsapp_label_error: statusData.data?.error || null,
            whatsapp_label_next_retry_at: statusData.nextRetryAt || null,
          });
          messageApi.warning(
            retryAt
              ? `Falha temporária. Envio mantido na fila para nova tentativa em ${retryAt}.`
              : 'Falha temporária. Envio mantido na fila para nova tentativa automática.',
          );
          return;
        }

        if (state === 'error') {
          throw new Error(statusData.data?.error || 'Erro ao enviar etiqueta por WhatsApp');
        }
      };

      await poll();
    } catch (error: any) {
      setWhatsappSteps((previous) => {
        const updated = [...previous];
        const firstActive = updated.findIndex((step) => step.status === 'loading' || step.status === 'pending');
        const index = firstActive >= 0 ? firstActive : updated.length - 1;
        updated[index] = { ...updated[index], status: 'error', error: error.message || 'Erro ao enviar etiqueta por WhatsApp' };
        return updated.map((step, stepIndex) => (
          stepIndex > index && step.status === 'pending'
            ? { ...step, status: 'warning', detail: 'Não executada por encerramento antecipado' }
            : step
        ));
      });
      messageApi.error(error.message || 'Erro ao enviar etiqueta por WhatsApp');
      setSendingWhatsappLabel(false);
    }
  }, [messageApi, updateOrder, whatsappOrder, whatsappPhone, whatsappUsePlaceholderLabel]);

  const closeWhatsappProgress = useCallback(() => {
    stopWhatsappPolling();
    setWhatsappProgressOpen(false);
    setSendingWhatsappLabel(false);
    setWhatsappSteps(initWhatsappLabelSteps());
    void refreshOrders();
  }, [refreshOrders, stopWhatsappPolling]);

  const completeDsliteLabel = useCallback(async (
    order: Order,
    duplicateAction?: 'use_existing' | 'reissue',
  ) => {
    if (!isValidDsliteId(order.dslite_id)) {
      messageApi.error('Crie o pedido na DSLite primeiro');
      return;
    }

    labelOrderRef.current = order;
    if (!duplicateAction) {
      setLabelDuplicateDecision(null);
      setLabelSteps([
        { label: 'Verificando vínculo fiscal no Mercado Livre', status: 'loading', detail: 'Fonte fiscal única: Brasil NFe. ML é usado apenas para vínculo documental e etiqueta.' },
        { label: 'Garantindo NF na Brasil NFe', status: 'pending' },
        { label: 'Vinculando NF Brasil NFe no Mercado Livre', status: 'pending' },
        { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
        { label: 'Definindo transporte na DSLite', status: 'pending' },
        { label: 'Enviando etiqueta para DSLite', status: 'pending' },
      ]);
      setLabelProgressOpen(true);
    } else {
      setLabelDuplicateDecision(null);
      setLabelSteps((previous) => previous.map((step) => {
        if (step.label === 'Garantindo NF na Brasil NFe') {
          return { ...step, status: 'loading', error: undefined };
        }
        if (
          step.label === 'Vinculando NF Brasil NFe no Mercado Livre'
          || step.label === 'Baixando etiqueta do Mercado Livre'
          || step.label === 'Definindo transporte na DSLite'
          || step.label === 'Enviando etiqueta para DSLite'
        ) {
          return { ...step, status: 'pending', error: undefined };
        }
        return { ...step, error: undefined };
      }));
    }

    try {
      const res = await fetch('/api/dslite/completar-etiqueta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          dsid: order.dslite_id,
          ...(duplicateAction ? { nfeDuplicateAction: duplicateAction } : {}),
        }),
      });
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        const isHtml = /^\s*</.test(responseText);
        throw new Error(isHtml
          ? `Servidor retornou HTML (${res.status}) em vez de JSON ao completar etiqueta DSLite.`
          : `Resposta inválida ao completar etiqueta DSLite (${res.status}).`);
      }

      if (data.success) {
        setLabelDuplicateDecision(null);
        const mappedSteps: ProgressStep[] = (data?.data?.steps || []).map((step: any) => ({
          label: String(step?.label || ''),
          status: step?.status === 'skipped' ? 'success' : (step?.status || 'pending'),
          detail: step?.status === 'skipped' ? (step?.detail || 'Etapa pulada') : step?.detail,
          error: step?.error,
        }));

        if (mappedSteps.length) setLabelSteps(mappedSteps);

        const sent = mappedSteps.some((step) => step.label === 'Enviando etiqueta para DSLite' && step.status === 'success');
        if (sent) updateOrder(order, { dslite_etiqueta_enviada: true });

        const operationStatus = String(data?.data?.operationStatus || '');
        if (operationStatus === 'label_sent') {
          messageApi.success(data?.data?.message || 'Etiqueta real enviada para DSLite.');
        } else if (operationStatus === 'placeholder_label_sent') {
          messageApi.warning(data?.data?.message || 'Etiqueta provisória do fornecedor enviada. Etiqueta real ainda ficará pendente.');
        } else if (operationStatus === 'waiting_ml_label') {
          messageApi.warning(data?.data?.message || 'Etiqueta ainda não liberada pelo Mercado Livre.');
        } else if (operationStatus === 'order_already_fulfilled') {
          messageApi.info(data?.data?.message || 'Venda já concluída no Mercado Livre.');
        } else if (operationStatus === 'already_done') {
          messageApi.info('Etiqueta já havia sido enviada anteriormente.');
        } else if (operationStatus === 'dslite_paid_shipping_ready') {
          messageApi.success(data?.data?.message || 'Frete pago confirmado na DSLite.');
        }
        return;
      }

      const step = String(data?.step || '');
      const actionRequired = String(data?.actionRequired || data?.details?.actionRequired || '');
      const errorMessage = data?.error || 'Falha ao completar etiqueta DSLite';
      if (
        actionRequired === 'choose_dslite_shipping'
        && data?.dsid
        && Array.isArray(data?.shippingOptions)
      ) {
        const shippingSteps: ProgressStep[] = (data?.data?.steps || []).map((item: any) => ({
          label: String(item?.label || ''),
          status: item?.status === 'skipped' ? 'success' : (item?.status || 'pending'),
          detail: item?.detail,
          error: item?.error,
        }));
        if (shippingSteps.length) setLabelSteps(shippingSteps);
        setLabelProgressOpen(false);
        openShippingSelection({
          order,
          pedidoId: String(order.dbId),
          dsid: String(data.dsid),
          options: data.shippingOptions,
        });
        return;
      }

      const errorType = String(data?.errorType || data?.details?.errorType || '');
      const dbCode = String(data?.details?.db_code || '');
      const isDbSchemaError = errorType === 'db_schema' || dbCode === '42703';
      const providerDetailRaw = data?.details?.errorDetails?.rawResponse
        || data?.details?.errorDetails?.error?.response?.data
        || data?.details?.errorDetails
        || null;
      const providerReason = providerDetailRaw?.Error
        || providerDetailRaw?.error
        || providerDetailRaw?.ReturnNF?.DsStatusRespostaSefaz
        || providerDetailRaw?.ReturnNF?.Mensagem
        || providerDetailRaw?.ReturnNF?.Msg
        || providerDetailRaw?.Mensagem
        || providerDetailRaw?.Message
        || providerDetailRaw?.erros?.[0]?.descricao
        || providerDetailRaw?.erros?.[0]?.mensagem
        || null;
      const ensureFriendly = isDbSchemaError
        ? 'Erro de configuração do banco (migration pendente). Contate suporte técnico.'
        : step === 'ensure_brasilnfe_invoice'
          ? `Falha ao emitir NF na Brasil NFe: ${String(providerReason || errorMessage)}`
          : errorMessage;
      const attempts = Array.isArray(data?.details?.attempts) ? data.details.attempts : [];
      const attemptsMethodChain = attempts.length
        ? attempts.map((attempt: any) => `${attempt.method}(${String(attempt.contentType || '').toLowerCase().includes('xml') ? 'xml' : 'json'})`).join('->')
        : '';
      const attemptsStatusChain = attempts.length
        ? attempts.map((attempt: any) => String(attempt.statusCode ?? 'n/a')).join(', ')
        : '';
      const uploadFriendly = step === 'upload_invoice_ml'
        ? `Falha ao subir NF no ML: ${String(data?.details?.error_message_ml || errorMessage)}`
        : ensureFriendly;
      const detailHint = data?.details?.providerError
        ? `${uploadFriendly} (${String(data.details.providerError)})`
        : uploadFriendly;
      const mappedFromServer: ProgressStep[] = (data?.data?.steps || []).map((item: any) => ({
        label: String(item?.label || ''),
        status: item?.status === 'skipped' ? 'success' : (item?.status || 'pending'),
        detail: item?.status === 'skipped' ? (item?.detail || 'Etapa pulada') : item?.detail,
        error: item?.error,
      }));

      if (mappedFromServer.length) {
        const hasExplicitError = mappedFromServer.some((item) => item.status === 'error');
        if (!hasExplicitError) {
          const stepToLabel: Record<string, string> = {
            check_ml_invoice_xml: 'Verificando vínculo fiscal no Mercado Livre',
            ensure_brasilnfe_invoice: 'Garantindo NF na Brasil NFe',
            upload_invoice_ml: 'Vinculando NF Brasil NFe no Mercado Livre',
            download_label_ml: 'Baixando etiqueta do Mercado Livre',
            set_carrier_dslite: 'Definindo transporte na DSLite',
            send_label_dslite: 'Enviando etiqueta para DSLite',
          };
          const labelToMark = stepToLabel[step];
          if (labelToMark) {
            const index = mappedFromServer.findIndex((item) => item.label === labelToMark);
            if (index >= 0) {
              const attemptsSuffix = step === 'upload_invoice_ml' && attempts.length
                ? ` [métodos: ${attemptsMethodChain}; retornos: ${attemptsStatusChain}]`
                : '';
              mappedFromServer[index] = { ...mappedFromServer[index], status: 'error', error: `${detailHint}${attemptsSuffix}` };
            }
          }
        }
        if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
          const existing = data?.existingNfe || data?.details?.existingNfe || null;
          const ensureIndex = mappedFromServer.findIndex((item) => item.label === 'Garantindo NF na Brasil NFe');
          if (ensureIndex >= 0 && existing?.chave) {
            mappedFromServer[ensureIndex] = {
              ...mappedFromServer[ensureIndex],
              detail: `NF encontrada: ${existing.numero ? `nº ${existing.numero} · ` : ''}chave ${existing.chave}`,
            };
          }
        }
        setLabelSteps(mappedFromServer);
        if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
          setLabelDuplicateDecision({
            pedidoId: String(order.dbId),
            dsid: String(order.dslite_id),
            mlOrderId: String(order.ml_order_id || ''),
            existingNfe: data?.existingNfe || data?.details?.existingNfe || null,
            identificadorInterno: data?.identificadorInterno || data?.details?.identificadorInterno || null,
          });
        }
        return;
      }

      if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
        setLabelDuplicateDecision({
          pedidoId: String(order.dbId),
          dsid: String(order.dslite_id),
          mlOrderId: String(order.ml_order_id || ''),
          existingNfe: data?.existingNfe || data?.details?.existingNfe || null,
          identificadorInterno: data?.identificadorInterno || data?.details?.identificadorInterno || null,
        });
      }

      setLabelSteps((previous) => {
        const updated = [...previous];
        const firstPending = updated.findIndex((item) => item.status === 'pending' || item.status === 'loading');
        const index = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[index] = { label: updated[index].label, status: 'error', error: ensureFriendly };
        return updated;
      });
    } catch (error: any) {
      setLabelSteps((previous) => {
        const updated = [...previous];
        const firstPending = updated.findIndex((step) => step.status === 'pending' || step.status === 'loading');
        const index = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[index] = { label: updated[index].label, status: 'error', error: error.message };
        return updated;
      });
    }
  }, [messageApi, openShippingSelection, updateOrder]);

  const downloadSavedLabel = useCallback(async (
    order: Order,
    format: 'pdf' | 'zpl2' | 'thermal_pdf' = 'pdf',
  ) => {
    try {
      const formatParam = format === 'pdf' ? '' : `?format=${format}`;
      if (format === 'thermal_pdf') {
        window.open(`/api/pedidos/${order.dbId}/etiqueta${formatParam}`, '_blank', 'noopener,noreferrer');
        return;
      }
      const res = await fetch(`/api/pedidos/${order.dbId}/etiqueta${formatParam}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) throw new Error(data?.error || 'Etiqueta não disponível');
      window.open(String(data.url), '_blank', 'noopener,noreferrer');
    } catch (error: any) {
      messageApi.error(error?.message || `Não foi possível baixar etiqueta ${format === 'zpl2' ? 'ZPL' : 'PDF'}`);
    }
  }, [messageApi]);

  const processInternalShipping = useCallback(async (order: Order) => {
    labelOrderRef.current = order;
    setLabelDuplicateDecision(null);
    setLabelDownloadUrl(null);
    setLabelZplDownloadUrl(null);
    setLabelSteps([
      { label: 'Verificando vínculo fiscal no Mercado Livre', status: 'loading', detail: 'Atualizando dados fiscais do pedido' },
      { label: 'Garantindo NF na Brasil NFe', status: 'pending' },
      { label: 'Vinculando NF Brasil NFe no Mercado Livre', status: 'pending' },
      { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
      { label: 'DSLite', status: 'pending' },
      { label: 'Preparando download da etiqueta', status: 'pending' },
    ]);
    setLabelProgressOpen(true);
    try {
      const res = await fetch('/api/dslite/etiqueta-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: order.dbId, directShipping: true }),
      });
      const data = await res.json().catch(() => ({}));
      const mapped: ProgressStep[] = (data?.data?.steps || []).map((step: any) => ({
        label: step.label,
        status: step.status === 'skipped' ? 'success' : step.status || 'pending',
        detail: step.detail,
        error: step.error,
      }));
      if (mapped.length) setLabelSteps(mapped);
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Falha ao processar envio próprio');
      const thermalUrl = String(data?.data?.thermalLabelDownloadUrl || data?.data?.pdfLabelDownloadUrl || data?.data?.labelDownloadUrl || '');
      const zplUrl = String(data?.data?.zplLabelDownloadUrl || '');
      if (!thermalUrl) throw new Error('Etiqueta foi baixada, mas link térmico não foi gerado');
      setLabelDownloadUrl(thermalUrl);
      setLabelZplDownloadUrl(zplUrl || null);
      messageApi.success('PDF térmico 100x150 pronto para download.');
      void refreshOrders();
    } catch (error: any) {
      setLabelSteps((previous) => {
        const next = [...previous];
        const index = next.findIndex((step) => step.status === 'loading' || step.status === 'pending');
        if (index >= 0) next[index] = { ...next[index], status: 'error', error: error?.message || 'Falha no envio próprio' };
        return next;
      });
    }
  }, [messageApi, refreshOrders]);

  const confirmInternalShipping = useCallback((order: Order) => {
    Modal.confirm({
      title: 'Enviar pelo estoque interno?',
      content: 'Ao iniciar, esta venda ficará vinculada ao estoque interno e não poderá criar pedido DSLite.',
      okText: 'Usar estoque interno',
      cancelText: 'Cancelar',
      onOk: () => processInternalShipping(order),
    });
  }, [processInternalShipping]);

  const runDuplicateAction = useCallback(async (action: 'use_existing' | 'reissue') => {
    if (!labelDuplicateDecision || !labelOrderRef.current) return;
    if (String(labelOrderRef.current.dbId) !== labelDuplicateDecision.pedidoId) {
      messageApi.error('Pedido não encontrado para continuar o fluxo da etiqueta.');
      return;
    }
    await completeDsliteLabel(labelOrderRef.current, action);
  }, [completeDsliteLabel, labelDuplicateDecision, messageApi]);

  const openDuplicateInvoice = useCallback(() => {
    const link = labelDuplicateDecision?.existingNfe?.linkInterno || null;
    if (link) {
      window.open(link, '_blank', 'noopener,noreferrer');
      return;
    }
    const chave = labelDuplicateDecision?.existingNfe?.chave || '';
    if (chave) {
      navigator.clipboard?.writeText(chave);
      messageApi.info('Chave da NF copiada para verificação.');
    }
  }, [labelDuplicateDecision, messageApi]);

  const closeLabelProgress = useCallback(() => {
    setLabelProgressOpen(false);
    setLabelDuplicateDecision(null);
    setLabelDownloadUrl(null);
    setLabelZplDownloadUrl(null);
    labelOrderRef.current = null;
    void refreshOrders();
  }, [refreshOrders]);

  return {
    openWhatsappLabel,
    whatsappModalOpen,
    whatsappOrder,
    whatsappUsePlaceholderLabel,
    whatsappPhone,
    setWhatsappPhone,
    sendingWhatsappLabel,
    closeWhatsappLabelModal,
    sendWhatsappLabel,
    whatsappProgressOpen,
    whatsappSteps,
    closeWhatsappProgress,
    completeDsliteLabel,
    downloadSavedLabel,
    confirmInternalShipping,
    labelProgressOpen,
    labelSteps,
    labelDownloadUrl,
    labelZplDownloadUrl,
    labelDuplicateDecision,
    closeLabelProgress,
    runDuplicateAction,
    openDuplicateInvoice,
  };
}

export type PedidosLabelWhatsappFlow = ReturnType<typeof usePedidosLabelWhatsappFlow>;
