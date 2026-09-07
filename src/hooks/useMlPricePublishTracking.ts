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

export function useMlPricePublishTracking(_messageApi: MessageApi): UseMlPricePublishTrackingResult {
  const [modalOpen, setModalOpen] = useState(false);
  const [trackingContext, setTrackingContext] = useState<MlPublishTrackingContext | null>(null);
  const [lastStatus, setLastStatus] = useState<MlPublishStatusResponse | null>(null);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setTrackingContext(null);
    setLastStatus(null);
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
          if (payload.status === 'done' || payload.status === 'failed' || payload.status === 'cancelled') {
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
    if (lastStatus?.status !== 'cancelled') retryAction?.();
  }, [closeModal, trackingContext, lastStatus]);

  const steps = useMemo(() => buildMlPublishSteps(lastStatus), [lastStatus]);

  return {
    hasOpenTracking: modalOpen && Boolean(trackingContext?.outboxId),
    startTracking,
    progressModalProps: {
      open: modalOpen,
      title: 'Atualizando preço no Mercado Livre',
      steps,
      onClose: closeModal,
      onCancel: retry,
      showCloseButton: lastStatus?.status === 'failed' || lastStatus?.status === 'done' || lastStatus?.status === 'cancelled',
      customActions: [],
    },
  };
}
