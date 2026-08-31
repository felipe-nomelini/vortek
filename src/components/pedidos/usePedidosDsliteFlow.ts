'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { ProgressStep } from '@/components/modals/ProgressModal';
import type { Order } from '@/types/order';

export interface DsliteShippingOption {
  transportadoraId: string;
  serviceId: string | null;
  name: string;
  nickname: string;
  serviceName: string;
  price: number;
  deliveryDays: number;
  note: string | null;
  error: string | null;
  requiresLabel: boolean;
}

export interface DsliteShippingPrompt {
  order: Order;
  pedidoId: string;
  dsid: string;
  options: DsliteShippingOption[];
}

interface DslitePaymentPrompt {
  order: Order;
  compraId: string;
  dsid: string;
  resumeAfterConfirm?: boolean;
  fornecedorNome?: string | null;
  supplierPaymentAmount?: number | null;
  supplierPixKey?: string | null;
  supplierPixKeyMissing?: boolean;
  supplierPhoneMissing?: boolean;
}

interface UsePedidosDsliteFlowOptions {
  messageApi: MessageInstance;
  refreshOrders: () => void | Promise<void>;
  updateOrder: (order: Order, patch: Partial<Order>) => void;
}

function initDsliteOrderSteps(): ProgressStep[] {
  return [
    { label: 'Sincronizando pedido no Mercado Livre', status: 'loading', detail: 'Atualizando snapshot fiscal e itens do pedido' },
    { label: 'Emitindo NF na Brasil NFe', status: 'pending' },
    { label: 'Aguardando autorização da NF', status: 'pending' },
    { label: 'Baixando XML da NF na Brasil NFe', status: 'pending' },
    { label: 'Validando vínculo fiscal e pré-checagens', status: 'pending' },
    { label: 'Buscando produto no catálogo DSLite', status: 'pending' },
    { label: 'Criando pedido na DSLite', status: 'pending' },
    { label: 'Informando fornecedor', status: 'pending' },
    { label: 'Definindo transporte na DSLite', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ];
}

function formatSupplierWhatsappReason(reason: unknown): string {
  switch (String(reason || '')) {
    case 'supplier_phone_missing':
      return 'WhatsApp do fornecedor não cadastrado';
    case 'receipt_missing':
      return 'Comprovante não encontrado';
    case 'supplier_not_found':
      return 'Fornecedor não encontrado';
    default:
      return String(reason || 'motivo não informado');
  }
}

export function isValidDsliteId(val: string | null | undefined): string | null {
  if (!val || val === 'undefined' || val === 'null' || val.trim() === '') return null;
  return val;
}

export function usePedidosDsliteFlow({
  messageApi,
  refreshOrders,
  updateOrder,
}: UsePedidosDsliteFlowOptions) {
  const [progressOpen, setProgressOpen] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>(initDsliteOrderSteps());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [paymentPrompt, setPaymentPrompt] = useState<DslitePaymentPrompt | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const [shippingPrompt, setShippingPrompt] = useState<DsliteShippingPrompt | null>(null);
  const [shippingModalOpen, setShippingModalOpen] = useState(false);
  const [shippingSelection, setShippingSelection] = useState<string | null>(null);
  const [confirmingShipping, setConfirmingShipping] = useState(false);

  const stopPolling = useCallback(() => {
    if (!pollRef.current) return;
    clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const openShippingSelection = useCallback((prompt: DsliteShippingPrompt) => {
    setShippingPrompt(prompt);
    setShippingSelection(null);
    setShippingModalOpen(true);
  }, []);

  const pollDsliteJob = useCallback(async function pollJob(jobId: string, order: Order): Promise<void> {
    const res = await fetch(`/api/dslite/pedido/status?jobId=${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Falha ao consultar status do job DSLite');
    }

    const mapped: ProgressStep[] = (data.steps || []).map((step: any) => ({
      label: step.label,
      status: step.status,
      detail: step.detail,
      error: step.error,
    }));
    if (mapped.length) setSteps(mapped);

    const state = data.state as string;
    if (state === 'running') {
      pollRef.current = setTimeout(() => {
        pollJob(jobId, order).catch((error) => {
          setSteps((previous) => {
            const updated = [...previous];
            const firstPending = updated.findIndex((step) => step.status === 'pending' || step.status === 'loading');
            const index = firstPending >= 0 ? firstPending : updated.length - 1;
            updated[index] = { ...updated[index], status: 'error', error: error.message || 'Erro ao acompanhar job' };
            return updated;
          });
        });
      }, 1500);
      return;
    }

    if (state === 'success' || state === 'warning') {
      const payload = data.data || {};
      if (payload.dsid) {
        updateOrder(order, {
          dslite_id: String(payload.dsid),
          dslite_etiqueta_enviada: payload.etiquetaStatus === 'enviada',
        });
      }
      if (
        payload.stage === 'choose_dslite_shipping'
        && payload.actionRequired === 'choose_dslite_shipping'
        && payload.dsid
        && Array.isArray(payload.shippingOptions)
      ) {
        openShippingSelection({
          order,
          pedidoId: String(order.dbId),
          dsid: String(payload.dsid),
          options: payload.shippingOptions,
        });
        setProgressOpen(false);
        return;
      }
      if (state === 'warning' && payload.stage === 'await_supplier_payment' && payload.compra_id) {
        setPaymentPrompt({
          order,
          compraId: String(payload.compra_id),
          dsid: String(payload.dsid || order.dslite_id || ''),
          resumeAfterConfirm: true,
          fornecedorNome: payload.fornecedor_nome || null,
          supplierPaymentAmount: Number(payload.supplier_payment_amount || 0) || null,
          supplierPixKey: payload.supplier_pix_key || null,
          supplierPixKeyMissing: Boolean(payload.supplier_pix_key_missing),
          supplierPhoneMissing: Boolean(payload.supplier_phone_missing),
        });
        setPaymentReference('');
        setPaymentNotes('');
        setPaymentReceiptFile(null);
        setPaymentModalOpen(true);
      }
      return;
    }

    if (state === 'error') {
      setSteps((previous) => {
        const updated = [...previous];
        const index = updated.findIndex((step) => step.status === 'error');
        if (index === -1) {
          const fallback = updated.findIndex((step) => step.status === 'loading');
          const position = fallback >= 0 ? fallback : updated.length - 1;
          updated[position] = { ...updated[position], status: 'error', error: data.data?.error || 'Falha ao criar pedido DSLite' };
        }
        return updated;
      });
    }
  }, [openShippingSelection, updateOrder]);

  const createDsliteOrder = useCallback(async (order: Order, nfeProvider: 'brasilnfe' = 'brasilnfe') => {
    setSteps(initDsliteOrderSteps());
    setProgressOpen(true);
    setPaymentModalOpen(false);
    setPaymentPrompt(null);
    setPaymentReference('');
    setPaymentNotes('');
    setPaymentReceiptFile(null);

    try {
      const startRes = await fetch('/api/dslite/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          mlOrderId: order.ml_order_id,
          nfeProvider,
          fulfillmentMode: 'supplier',
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData?.jobId) {
        throw new Error(startData?.error || 'Falha ao iniciar criação do pedido DSLite');
      }

      await pollDsliteJob(startData.jobId, order);
    } catch (error: any) {
      setSteps((previous) => {
        const updated = [...previous];
        const firstPending = updated.findIndex((step) => step.status === 'pending' || step.status === 'loading');
        const index = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[index] = { label: updated[index].label, status: 'error', error: error.message };
        return updated;
      });
    }
  }, [pollDsliteJob]);

  const confirmSupplierFulfillment = useCallback((order: Order) => {
    if (!order.internal_stock_available) {
      void createDsliteOrder(order);
      return;
    }
    Modal.confirm({
      title: 'Enviar pelo fornecedor DSLite?',
      content: 'Existe estoque interno disponível. Ao iniciar pela DSLite, esta venda ficará vinculada ao fornecedor e não poderá usar o estoque interno.',
      okText: 'Usar fornecedor',
      cancelText: 'Cancelar',
      onOk: () => createDsliteOrder(order),
    });
  }, [createDsliteOrder]);

  const openSupplierPayment = useCallback((order: Order) => {
    if (!order.compra_id || !order.dslite_id) {
      messageApi.error('Compra DSLite vinculada não encontrada para confirmar PIX.');
      return;
    }
    setPaymentPrompt({
      order,
      compraId: order.compra_id,
      dsid: order.dslite_id,
      resumeAfterConfirm: true,
      fornecedorNome: order.fornecedor_nome || null,
      supplierPaymentAmount: order.supplier_payment_amount ?? null,
      supplierPixKey: order.supplier_pix_key || null,
      supplierPixKeyMissing: !order.supplier_pix_key,
      supplierPhoneMissing: !String(order.fornecedor_telefone || '').replace(/\D/g, ''),
    });
    setPaymentReference(order.supplier_payment_reference || '');
    setPaymentNotes(order.supplier_payment_notes || '');
    setPaymentReceiptFile(null);
    setPaymentModalOpen(true);
  }, [messageApi]);

  const confirmSupplierPayment = useCallback(async () => {
    if (!paymentPrompt) return;
    const hasSavedReceipt = Boolean(paymentPrompt.order.supplier_payment_receipt_path);
    const resumeOnly = Boolean(
      paymentPrompt.resumeAfterConfirm
      && paymentPrompt.order.supplier_payment_status === 'paid'
      && hasSavedReceipt
      && !paymentReceiptFile,
    );
    if (!paymentReceiptFile && !hasSavedReceipt && !resumeOnly) {
      messageApi.warning('Anexe o comprovante do PIX para continuar o fluxo.');
      return;
    }

    setConfirmingPayment(true);
    try {
      const form = new FormData();
      form.append('resume_dslite_flow', paymentPrompt.resumeAfterConfirm ? 'true' : 'false');
      form.append('pedido_id', String(paymentPrompt.order.dbId));
      form.append('ml_order_id', String(paymentPrompt.order.ml_order_id));
      if (resumeOnly) form.append('resume_only', 'true');
      if (paymentReceiptFile) form.append('receipt', paymentReceiptFile);
      if (paymentReference.trim()) form.append('supplier_payment_reference', paymentReference.trim());
      if (paymentNotes.trim()) form.append('supplier_payment_notes', paymentNotes.trim());

      const res = await fetch(`/api/compras/${paymentPrompt.compraId}/confirmar-pagamento`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Falha ao confirmar PIX e retomar fluxo DSLite');
      }

      setPaymentModalOpen(false);
      setPaymentPrompt(null);
      setPaymentReceiptFile(null);
      setPaymentReference('');
      setPaymentNotes('');
      if (paymentPrompt.resumeAfterConfirm && json.jobId) {
        setSteps(initDsliteOrderSteps());
        setProgressOpen(true);
        messageApi.success('PIX confirmado. Fluxo DSLite retomado.');
        await pollDsliteJob(String(json.jobId), paymentPrompt.order);
      } else if (paymentPrompt.resumeAfterConfirm && json.resume?.error) {
        messageApi.warning(`PIX confirmado, mas o fluxo não foi retomado: ${json.resume.error}`);
        void refreshOrders();
      } else {
        const whatsappDetail = json.whatsapp?.sent
          ? 'WhatsApp enviado.'
          : `WhatsApp não enviado${json.whatsapp?.reason ? `: ${formatSupplierWhatsappReason(json.whatsapp.reason)}` : ''}.`;
        messageApi.success(`Comprovante processado. ${whatsappDetail}`);
        void refreshOrders();
      }
    } catch (error: any) {
      messageApi.error(error?.message || 'Erro ao confirmar PIX');
    } finally {
      setConfirmingPayment(false);
    }
  }, [messageApi, paymentNotes, paymentPrompt, paymentReceiptFile, paymentReference, pollDsliteJob, refreshOrders]);

  const closeShippingModal = useCallback(() => {
    setShippingModalOpen(false);
    setShippingPrompt(null);
    setShippingSelection(null);
  }, []);

  const confirmShipping = useCallback(async () => {
    if (!shippingPrompt || !shippingSelection) {
      messageApi.warning('Escolha uma opção de frete.');
      return;
    }

    setConfirmingShipping(true);
    try {
      const res = await fetch('/api/dslite/frete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: shippingPrompt.pedidoId,
          dsid: shippingPrompt.dsid,
          transportadoraId: shippingSelection,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Falha ao selecionar frete na DSLite.');
      }

      closeShippingModal();
      setProgressOpen(false);
      messageApi.success(data?.data?.message || 'Frete selecionado na DSLite.');
      void refreshOrders();
    } catch (error: any) {
      messageApi.error(error?.message || 'Erro ao selecionar frete na DSLite.');
    } finally {
      setConfirmingShipping(false);
    }
  }, [closeShippingModal, messageApi, refreshOrders, shippingPrompt, shippingSelection]);

  const unlinkDslitePurchase = useCallback((order: Order) => {
    Modal.confirm({
      title: 'Desvincular compra DSLite',
      content: 'Isso remove apenas o vínculo local do pedido com a DSLite. Nenhum dado será apagado na DSLite.',
      okText: 'Desvincular',
      okButtonProps: { danger: true },
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const res = await fetch('/api/dslite/desvincular-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pedidoId: order.dbId,
              mlOrderId: order.ml_order_id,
              motivo: 'desvinculo_local_para_correcao_de_estado',
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.success) {
            throw new Error(data?.error || 'Falha ao desvincular compra DSLite');
          }

          updateOrder(order, {
            dslite_id: null,
            dslite_status: null,
            dslite_etiqueta_enviada: false,
          });
          messageApi.success('Vínculo local com DSLite removido com sucesso');
        } catch (error: any) {
          messageApi.error(error?.message || 'Erro ao desvincular compra DSLite');
        }
      },
    });
  }, [messageApi, updateOrder]);

  const closeProgress = useCallback(() => {
    stopPolling();
    setProgressOpen(false);
    setPaymentModalOpen(false);
    void refreshOrders();
  }, [refreshOrders, stopPolling]);

  const retryProgress = useCallback(() => {
    stopPolling();
    setProgressOpen(false);
  }, [stopPolling]);

  const copySupplierPixKey = useCallback(() => {
    if (!paymentPrompt?.supplierPixKey) return;
    navigator.clipboard?.writeText(paymentPrompt.supplierPixKey);
    messageApi.success('Chave PIX copiada');
  }, [messageApi, paymentPrompt]);

  return {
    confirmSupplierFulfillment,
    openSupplierPayment,
    unlinkDslitePurchase,
    openShippingSelection,
    progressOpen,
    steps,
    closeProgress,
    retryProgress,
    paymentPrompt,
    paymentModalOpen,
    closePaymentModal: () => setPaymentModalOpen(false),
    confirmSupplierPayment,
    confirmingPayment,
    paymentReference,
    setPaymentReference,
    paymentNotes,
    setPaymentNotes,
    paymentReceiptFile,
    setPaymentReceiptFile,
    copySupplierPixKey,
    shippingPrompt,
    shippingModalOpen,
    closeShippingModal,
    confirmShipping,
    confirmingShipping,
    shippingSelection,
    setShippingSelection,
  };
}

export type PedidosDsliteFlow = ReturnType<typeof usePedidosDsliteFlow>;
