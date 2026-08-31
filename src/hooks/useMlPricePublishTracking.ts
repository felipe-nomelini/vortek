'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProgressStep } from '@/components/modals/ProgressModal';
import {
  buildMlPublishSteps,
  type MlPublishStatusResponse,
} from '@/lib/ml/price-publish-tracking';

const ML_PUBLISH_POLLING_INTERVAL_MS = 2000;

interface MessageApi {
  success: (content: string) => unknown;
  warning: (content: string) => unknown;
  error: (content: string) => unknown;
}

interface MlPublishTrackingContext {
  outboxId: string;
  produtoId: string;
  retry: () => void;
  onTerminal?: (status: MlPublishStatusResponse) => void;
}

interface ProgressModalProps {
  open: boolean;
  title: string;
  steps: ProgressStep[];
  onClose: () => void;
  onCancel: () => void;
  showCloseButton: boolean;
  customActions: Array<{
    key: string;
    label: string;
    onClick: () => void;
    primary: boolean;
  }>;
}

interface UseMlPricePublishTrackingResult {
  hasOpenTracking: boolean;
  startTracking: (context: MlPublishTrackingContext) => void;
  progressModalProps: ProgressModalProps;
}

function failedStatus(outboxId: string, error: string): MlPublishStatusResponse {
  return {
    success: false,
    status: 'failed',
    phase: 'erro',
    last_error: error,
    error,
    outboxId,
    result: null,
  };
}

export function useMlPricePublishTracking(messageApi: MessageApi): UseMlPricePublishTrackingResult {
  const [modalOpen, setModalOpen] = useState(false);
  const [trackingContext, setTrackingContext] = useState<MlPublishTrackingContext | null>(null);
  const [lastStatus, setLastStatus] = useState<MlPublishStatusResponse | null>(null);
  const [applyingWholesale, setApplyingWholesale] = useState(false);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setTrackingContext(null);
    setLastStatus(null);
    setApplyingWholesale(false);
  }, []);

  const startTracking = useCallback((context: MlPublishTrackingContext) => {
    const pendingStatus: MlPublishStatusResponse = {
      success: true,
      status: 'pending',
      phase: 'enfileirado',
      outboxId: context.outboxId,
      result: null,
    };
    setTrackingContext(context);
    setLastStatus(pendingStatus);
    setModalOpen(true);
  }, []);

  useEffect(() => {
    if (!modalOpen || !trackingContext?.outboxId) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextPoll = () => {
      timeout = setTimeout(async () => {
        try {
          const response = await fetch(
            `/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(trackingContext.outboxId)}`,
          );
          const payload = await response.json().catch(() => ({})) as MlPublishStatusResponse;
          if (!response.ok) {
            throw new Error(payload?.error || 'Falha ao consultar status da publicação.');
          }
          if (cancelled) return;

          setLastStatus(payload);
          if (payload.status === 'done' || payload.status === 'failed') {
            trackingContext.onTerminal?.(payload);
            return;
          }
          scheduleNextPoll();
        } catch (error: unknown) {
          if (cancelled) return;
          const message = error instanceof Error
            ? error.message
            : 'Erro ao consultar status da publicação no ML.';
          setLastStatus(failedStatus(trackingContext.outboxId, message));
        }
      }, ML_PUBLISH_POLLING_INTERVAL_MS);
    };

    scheduleNextPoll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [modalOpen, trackingContext]);

  const retry = useCallback(() => {
    const retryAction = trackingContext?.retry;
    closeModal();
    retryAction?.();
  }, [closeModal, trackingContext]);

  const applyWholesale = useCallback(async () => {
    if (applyingWholesale || !trackingContext) return;
    const itemPrice = Number(lastStatus?.result?.item_price);
    const outboxProcessing = lastStatus?.status !== 'done' && lastStatus?.status !== 'failed';
    if (outboxProcessing) {
      messageApi.warning('Já existe uma publicação em acompanhamento. Aguarde finalizar.');
      return;
    }
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
      messageApi.error('Não foi possível identificar preço base válido para aplicar atacado.');
      return;
    }

    setApplyingWholesale(true);
    try {
      const response = await fetch('/api/ml/anuncio/aplicar-atacado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: trackingContext.produtoId,
          basePrice: itemPrice,
          source: 'modal_result_sem_atacado',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(payload?.error || 'Falha ao enfileirar aplicação de atacado.');
        return;
      }
      const outboxId = String(payload?.outboxId || '').trim();
      if (!payload?.queued_publish || !outboxId) {
        messageApi.error('Não foi possível enfileirar aplicação de atacado.');
        return;
      }

      startTracking({ ...trackingContext, outboxId });
      messageApi.success('Aplicação de atacado enfileirada. Acompanhe no modal.');
    } catch {
      messageApi.error('Erro de conexão ao aplicar atacado.');
    } finally {
      setApplyingWholesale(false);
    }
  }, [applyingWholesale, lastStatus, messageApi, startTracking, trackingContext]);

  const steps = useMemo(() => buildMlPublishSteps(lastStatus), [lastStatus]);
  const canApplyWholesale = Boolean(
    lastStatus?.status === 'done'
    && !applyingWholesale
    && !lastStatus?.result?.has_quantity_pricing
    && Number(lastStatus?.result?.item_price || 0) > 0
    && trackingContext?.produtoId,
  );

  return {
    hasOpenTracking: modalOpen && Boolean(trackingContext?.outboxId),
    startTracking,
    progressModalProps: {
      open: modalOpen,
      title: 'Atualizando preço no Mercado Livre',
      steps,
      onClose: closeModal,
      onCancel: retry,
      showCloseButton: lastStatus?.status === 'failed' || lastStatus?.status === 'done',
      customActions: canApplyWholesale ? [{
        key: 'apply_wholesale',
        label: applyingWholesale ? 'Criando atacado...' : 'Criar preços de atacado',
        onClick: () => { void applyWholesale(); },
        primary: true,
      }] : [],
    },
  };
}
