'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space, message, Spin, Statistic, Tabs } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { MenuProps, TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import ProgressModal, { type ProgressStep } from '@/components/modals/ProgressModal';

const { Title } = Typography;
const PAGE_SIZE = 100;
const NO_CATALOGO_REFRESH_JOB_STORAGE_KEY = 'catalogo_no_catalogo_refresh_job_id';

export type CatalogoMode = 'no_catalogo' | 'elegiveis';

type NoCatalogoRow = {
  anuncio_id: string;
  ml_item_id: string;
  relacionado_id: string | null;
  related_permalink?: string | null;
  title: string;
  seller_sku: string | null;
  sku_local: string | null;
  produto_id: string | null;
  catalog_product_id: string | null;
  status: string | null;
  buy_box_status: string | null;
  price_to_win: number | null;
  price: number;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  domain_id: string | null;
  catalog_listing: boolean;
  item_relations: any[] | null;
  last_updated: string | null;
};

type ElegivelRow = {
  ml_item_id: string;
  title: string;
  seller_sku: string | null;
  status: string | null;
  price: number;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  domain_id: string | null;
  catalog_product_id: string | null;
  eligibility_status: string | null;
  buy_box_eligible: boolean;
  eligibility_reason: string | null;
  variation_eligibility: Array<{ id?: number; status?: string; buy_box_eligible?: boolean }>;
  last_updated: string | null;
};

const statusMlOptions = [
  { value: 'all', label: 'Todos os status ML' },
  { value: 'active', label: 'Ativo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'closed', label: 'Fechado' },
];

const buyBoxOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'ganhando', label: 'Ganhando' },
  { value: 'perdendo', label: 'Perdendo' },
];

const eligibilityStatusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'READY_FOR_OPTIN', label: 'Ready for opt-in' },
  { value: 'ALREADY_OPTED_IN', label: 'Already opted-in' },
  { value: 'NOT_ELIGIBLE', label: 'Not eligible' },
  { value: 'PRODUCT_INACTIVE', label: 'Product inactive' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'COMPETING', label: 'Competing' },
];

const eligibilityColor: Record<string, string> = {
  READY_FOR_OPTIN: 'green',
  ALREADY_OPTED_IN: 'blue',
  NOT_ELIGIBLE: 'red',
  PRODUCT_INACTIVE: 'orange',
  CLOSED: 'default',
  COMPETING: 'gold',
};

interface CatalogoViewProps {
  mode: CatalogoMode;
}

interface NoCatalogoResumo {
  total: number;
  ativos: number;
  pausados: number;
  ganhando: number;
  perdendo: number;
}

type RefreshJobStatus = 'idle' | 'running' | 'done' | 'error';

type RefreshStatusPayload = {
  success?: boolean;
  error?: string;
  job?: {
    id: string;
    status: string;
    last_event?: {
      message?: string | null;
    } | null;
  } | null;
  failures?: string[];
};

type AnaliseClasse =
  | 'ajustar_para_ganhar_sem_prejuizo'
  | 'nao_viavel_ganhar_sem_prejuizo'
  | 'dados_insuficientes';

type AnalisePrecoRow = {
  ml_item_id: string;
  permalink?: string | null;
  titulo: string;
  sku_local: string | null;
  produto_id?: string | null;
  preco_atual: number;
  price_to_win: number | null;
  preco_piso_sem_prejuizo: number | null;
  preco_recomendado: number | null;
  delta_preco: number | null;
  lucro_unitario_estimado: number | null;
  classe: AnaliseClasse;
  motivo: string;
};

type AnalisePrecoResponse = {
  success: boolean;
  total_analisado?: number;
  top_n?: number;
  classes?: Partial<Record<AnaliseClasse, number>>;
  refresh?: {
    status?: string;
  };
  data?: AnalisePrecoRow[];
  erro?: string;
};

type MlPublishStatusResponse = {
  success: boolean;
  status?: 'pending' | 'processing' | 'retry' | 'failed' | 'done';
  phase?: 'enfileirado' | 'processando' | 'erro' | 'concluido';
  last_error?: string | null;
  outboxId?: string;
  result?: {
    item_price?: number | null;
    has_quantity_pricing?: boolean;
    quantity_pricing_state?: 'active' | 'absent' | 'failed_validation' | 'provider_rejected';
    quantity_pricing_last_error?: string | null;
    quantity_pricing?: Array<{
      min_purchase_unit: number;
      amount: number;
      currency_id: string;
    }>;
    suggested_quantity_pricing?: Array<{
      min_purchase_unit: number;
      discount_percent: number;
      amount: number;
      currency_id: string;
    }>;
    warnings?: string[];
  } | null;
  progress?: {
    last_operation?: string | null;
  } | null;
  error?: string;
};

type PublishActionContext = {
  produtoId: string;
  targetPrice: number;
  source: 'catalog_price_to_win';
  itemKey: string;
};

const ML_PUBLISH_POLLING_INTERVAL_MS = 2000;

function mapStatusMlToPt(status: string | null | undefined): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'paused') return 'Pausado';
  if (normalized === 'closed') return 'Encerrado';
  if (normalized === 'under_review') return 'Em revisão';
  if (normalized === 'inactive') return 'Inativo';
  return status || '—';
}

function classLabel(classe: AnaliseClasse): string {
  if (classe === 'ajustar_para_ganhar_sem_prejuizo') return 'Ajustar para ganhar';
  if (classe === 'nao_viavel_ganhar_sem_prejuizo') return 'Não viável sem prejuízo';
  return 'Dados insuficientes';
}

function classColor(classe: AnaliseClasse): string {
  if (classe === 'ajustar_para_ganhar_sem_prejuizo') return 'green';
  if (classe === 'nao_viavel_ganhar_sem_prejuizo') return 'orange';
  return 'default';
}

function parseOutboxStepLabel(operation: string | null | undefined): string {
  const op = String(operation || '').trim().toLowerCase();
  if (!op) return 'Aguardando worker';
  if (op === 'processing_start') return 'Iniciando publicação';
  if (op === 'validate') return 'Validando item no outbox';
  if (op === 'price') return 'Publicando preço base';
  if (op === 'quantity_pricing') return 'Publicando preços de atacado';
  if (op === 'quantity') return 'Publicando estoque';
  if (op === 'status') return 'Publicando status do anúncio';
  return op;
}

function buildMlPublishSteps(statusPayload: MlPublishStatusResponse | null): ProgressStep[] {
  const currentStatus = statusPayload?.status || 'pending';
  const lastError = statusPayload?.last_error || null;
  const phase = statusPayload?.phase || 'enfileirado';
  const lastOperation = statusPayload?.progress?.last_operation || null;
  const result = statusPayload?.result || null;
  const quantityPricing = Array.isArray(result?.quantity_pricing) ? result?.quantity_pricing : [];
  const hasQuantityPricing = quantityPricing.length > 0;
  const quantityPricingState = String(result?.quantity_pricing_state || (hasQuantityPricing ? 'active' : 'absent'));
  const quantityPricingLastError = String(result?.quantity_pricing_last_error || '').trim();
  const suggestedQuantityPricing = Array.isArray(result?.suggested_quantity_pricing) ? result.suggested_quantity_pricing : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  const atacadoAtivoDetail = quantityPricing.length > 0
    ? quantityPricing.map((tier) => `${tier.min_purchase_unit}+ = ${formatCurrency(Number(tier.amount || 0))}`).join(' | ')
    : 'Sem preços de atacado ativos no anúncio.';
  const atacadoSugeridoDetail = suggestedQuantityPricing.length > 0
    ? `Sugestão: ${suggestedQuantityPricing.map((tier) => `${tier.min_purchase_unit}+ (-${tier.discount_percent}%) = ${formatCurrency(Number(tier.amount || 0))}`).join(' | ')}`
    : 'Sem sugestões disponíveis.';
  const diagnosticReason = quantityPricingState === 'failed_validation'
    ? 'Diagnóstico: o ML aceitou a chamada, mas as faixas não ficaram ativas.'
    : quantityPricingState === 'provider_rejected'
      ? 'Diagnóstico: o ML rejeitou a aplicação de atacado para este anúncio.'
      : quantityPricingState === 'absent' && !hasQuantityPricing
        ? 'Diagnóstico: anúncio sem faixas de atacado ativas no momento.'
        : '';
  const technicalReason = quantityPricingLastError ? ` Detalhe técnico: ${quantityPricingLastError}` : '';

  return [
    {
      label: 'Enfileirado',
      status: phase === 'enfileirado' ? 'loading' : 'success',
      detail: currentStatus === 'pending' ? 'Aguardando início do processamento no worker.' : 'Publicação recebida na fila.',
    },
    {
      label: 'Processando publicação no ML',
      status: currentStatus === 'failed'
        ? 'error'
        : currentStatus === 'done'
          ? 'success'
          : 'loading',
      detail: currentStatus === 'done'
        ? 'Preço base e atacado processados pelo worker.'
        : parseOutboxStepLabel(lastOperation),
      error: currentStatus === 'failed' ? (lastError || 'Falha ao processar publicação no ML.') : undefined,
    },
    {
      label: 'Preço final do anúncio',
      status: currentStatus === 'done'
        ? 'success'
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `Preço atual no ML: ${result?.item_price !== null && result?.item_price !== undefined ? formatCurrency(Number(result.item_price)) : 'não disponível'}`
        : 'Aguardando confirmação final do ML.',
    },
    {
      label: 'Preços de atacado',
      status: currentStatus === 'done'
        ? (hasQuantityPricing ? 'success' : 'warning')
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `${atacadoAtivoDetail} ${atacadoSugeridoDetail}${diagnosticReason ? ` ${diagnosticReason}` : ''}${technicalReason}${warnings.length > 0 ? ` | Aviso: ${warnings.join(' | ')}` : ''}`
        : 'Aguardando confirmação final do ML.',
    },
  ];
}

export default function CatalogoView({ mode }: CatalogoViewProps) {
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  const [search, setSearch] = useState('');
  const [statusMl, setStatusMl] = useState('all');
  const [buyBoxFilter, setBuyBoxFilter] = useState('all');
  const [eligibilityStatus, setEligibilityStatus] = useState('all');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshJobStatus, setRefreshJobStatus] = useState<RefreshJobStatus>('idle');
  const [activeNoCatalogTab, setActiveNoCatalogTab] = useState<'anuncios' | 'reanalisar'>('anuncios');

  const [noCatalogoData, setNoCatalogoData] = useState<NoCatalogoRow[]>([]);
  const [elegiveisData, setElegiveisData] = useState<ElegivelRow[]>([]);
  const [analiseData, setAnaliseData] = useState<AnalisePrecoRow[]>([]);
  const [analiseLoading, setAnaliseLoading] = useState(false);
  const [analiseErro, setAnaliseErro] = useState<string | null>(null);
  const [analiseTopN, setAnaliseTopN] = useState<number>(50);
  const [analiseTotal, setAnaliseTotal] = useState(0);
  const [analiseClasses, setAnaliseClasses] = useState<Partial<Record<AnaliseClasse, number>>>({});
  const [analiseRefreshStatus, setAnaliseRefreshStatus] = useState<string | null>(null);
  const [analiseUltimaExecucao, setAnaliseUltimaExecucao] = useState<string | null>(null);
  const [updatingPriceByItem, setUpdatingPriceByItem] = useState<Record<string, boolean>>({});
  const [mlPublishModalOpen, setMlPublishModalOpen] = useState(false);
  const [mlPublishModalSteps, setMlPublishModalSteps] = useState<ProgressStep[]>(buildMlPublishSteps(null));
  const [mlPublishOutboxId, setMlPublishOutboxId] = useState<string | null>(null);
  const [mlPublishLastStatus, setMlPublishLastStatus] = useState<MlPublishStatusResponse | null>(null);
  const [mlPublishRetryContext, setMlPublishRetryContext] = useState<PublishActionContext | null>(null);
  const [mlPublishApplyingWholesale, setMlPublishApplyingWholesale] = useState(false);
  const mlPublishPollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resumoNoCatalogo, setResumoNoCatalogo] = useState<NoCatalogoResumo>({
    total: 0,
    ativos: 0,
    pausados: 0,
    ganhando: 0,
    perdendo: 0,
  });
  const [loadingResumoNoCatalogo, setLoadingResumoNoCatalogo] = useState(false);
  const refreshPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTerminalResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPollingInFlightRef = useRef(false);
  const refreshPollingStartedAtRef = useRef<number | null>(null);
  const refreshJobIdRef = useRef<string | null>(null);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search.trim()) params.set('search', search.trim());
    if (statusMl !== 'all') params.set('statusMl', statusMl);
    if (mode === 'no_catalogo' && buyBoxFilter !== 'all') params.set('buyBox', buyBoxFilter);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    if (mode === 'elegiveis' && eligibilityStatus !== 'all') params.set('eligibilityStatus', eligibilityStatus);
    return params.toString();
  }, [buyBoxFilter, eligibilityStatus, mode, page, priceMax, priceMin, search, statusMl]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    if (mode === 'no_catalogo') setLoadingResumoNoCatalogo(true);
    try {
      const endpoint = mode === 'no_catalogo' ? '/api/catalogo/no-catalogo' : '/api/catalogo/elegiveis';
      const params = buildParams();
      const requests: Promise<Response>[] = [fetch(`${endpoint}?${params}`)];
      if (mode === 'no_catalogo') {
        requests.push(fetch(`/api/catalogo/no-catalogo/resumo?${params}`));
      }
      const [res, resumoRes] = await Promise.all(requests);
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(json?.erro || 'Falha ao carregar catálogo');
        if (mode === 'no_catalogo') setNoCatalogoData([]);
        else setElegiveisData([]);
        setTotal(0);
        return;
      }

      if (mode === 'no_catalogo') setNoCatalogoData(json.data || []);
      else setElegiveisData(json.data || []);

      setTotal(Number(json.total || 0));

      if (mode === 'no_catalogo' && resumoRes) {
        const resumoJson = await resumoRes.json().catch(() => ({}));
        if (resumoRes.ok) {
          setResumoNoCatalogo({
            total: Number(resumoJson.total || 0),
            ativos: Number(resumoJson.ativos || 0),
            pausados: Number(resumoJson.pausados || 0),
            ganhando: Number(resumoJson.ganhando || 0),
            perdendo: Number(resumoJson.perdendo || 0),
          });
        } else {
          messageApi.warning(resumoJson?.erro || 'Falha ao carregar resumo do catálogo');
        }
      }
    } catch {
      messageApi.error('Erro de conexão ao carregar catálogo');
    } finally {
      setLoading(false);
      if (mode === 'no_catalogo') setLoadingResumoNoCatalogo(false);
    }
  }, [buildParams, messageApi, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [mode, search, statusMl, buyBoxFilter, eligibilityStatus, priceMin, priceMax]);

  const clearRefreshPolling = useCallback(() => {
    if (refreshPollTimeoutRef.current) {
      clearTimeout(refreshPollTimeoutRef.current);
      refreshPollTimeoutRef.current = null;
    }
    if (refreshTerminalResetTimeoutRef.current) {
      clearTimeout(refreshTerminalResetTimeoutRef.current);
      refreshTerminalResetTimeoutRef.current = null;
    }
    refreshPollingInFlightRef.current = false;
    refreshPollingStartedAtRef.current = null;
    refreshJobIdRef.current = null;
  }, []);

  const clearRefreshTracking = useCallback(() => {
    clearRefreshPolling();
    refreshJobIdRef.current = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(NO_CATALOGO_REFRESH_JOB_STORAGE_KEY);
    }
  }, [clearRefreshPolling]);

  const getAdaptiveRefreshPollingInterval = useCallback(() => {
    const startedAt = refreshPollingStartedAtRef.current;
    if (!startedAt) return 2000;
    const elapsed = Date.now() - startedAt;
    if (elapsed > 180000) return 5000;
    if (elapsed > 60000) return 4000;
    return 2000;
  }, []);

  const fetchRefreshStatus = useCallback(async (jobId?: string): Promise<RefreshStatusPayload> => {
    const url = jobId
      ? `/api/catalogo/no-catalogo/refresh/status?jobId=${encodeURIComponent(jobId)}`
      : '/api/catalogo/no-catalogo/refresh/status';
    const res = await fetch(url);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || 'Falha ao consultar status do refresh do catálogo.');
    }
    return payload as RefreshStatusPayload;
  }, []);

  const concludeRefreshTracking = useCallback((status: RefreshJobStatus, errorMessage?: string) => {
    clearRefreshTracking();
    setRefreshJobStatus(status);
    if (status === 'error') {
      messageApi.error(errorMessage || 'Falha ao atualizar snapshot do catálogo.');
    }
    if (status === 'done') {
      void fetchData();
    }
    refreshTerminalResetTimeoutRef.current = setTimeout(() => {
      setRefreshJobStatus('idle');
      refreshTerminalResetTimeoutRef.current = null;
    }, 800);
  }, [clearRefreshTracking, fetchData, messageApi]);

  const pollRefreshJob = useCallback(async (jobId: string) => {
    const payload = await fetchRefreshStatus(jobId);
    if (!payload.success || !payload.job?.id) {
      throw new Error(payload.error || 'Job de refresh não encontrado.');
    }

    const status = payload.job.status;
    if (status === 'pendente' || status === 'rodando') {
      setRefreshJobStatus('running');
      return;
    }

    if (status === 'completo' || status === 'completo_parcial') {
      concludeRefreshTracking('done');
      return;
    }

    const errorMessage = payload.failures?.[0] || payload.job.last_event?.message || 'Falha ao atualizar snapshot do catálogo.';
    concludeRefreshTracking('error', errorMessage);
  }, [concludeRefreshTracking, fetchRefreshStatus]);

  const scheduleNextRefreshPoll = useCallback(() => {
    const jobId = refreshJobIdRef.current;
    if (!jobId) return;
    const delay = getAdaptiveRefreshPollingInterval();
    refreshPollTimeoutRef.current = setTimeout(() => {
      const runningJobId = refreshJobIdRef.current;
      if (!runningJobId) return;
      if (refreshPollingInFlightRef.current) {
        scheduleNextRefreshPoll();
        return;
      }

      refreshPollingInFlightRef.current = true;
      pollRefreshJob(runningJobId)
        .catch((err: any) => {
          concludeRefreshTracking('error', err?.message || 'Erro ao consultar refresh do catálogo.');
        })
        .finally(() => {
          refreshPollingInFlightRef.current = false;
          if (refreshJobIdRef.current === runningJobId) {
            scheduleNextRefreshPoll();
          }
        });
    }, delay);
  }, [concludeRefreshTracking, getAdaptiveRefreshPollingInterval, pollRefreshJob]);

  const startRefreshPolling = useCallback((jobId: string) => {
    clearRefreshPolling();
    refreshJobIdRef.current = jobId;
    refreshPollingStartedAtRef.current = Date.now();
    setRefreshJobStatus('running');
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NO_CATALOGO_REFRESH_JOB_STORAGE_KEY, jobId);
    }
    scheduleNextRefreshPoll();
  }, [clearRefreshPolling, scheduleNextRefreshPoll]);

  const resumeRefreshIfRunning = useCallback(async () => {
    if (mode !== 'no_catalogo') return;
    try {
      const persistedJobId = typeof window !== 'undefined'
        ? window.localStorage.getItem(NO_CATALOGO_REFRESH_JOB_STORAGE_KEY)
        : null;

      if (persistedJobId) {
        const persistedPayload = await fetchRefreshStatus(persistedJobId);
        if (persistedPayload.success && persistedPayload.job?.id) {
          const status = persistedPayload.job.status;
          if (status === 'pendente' || status === 'rodando') {
            startRefreshPolling(persistedPayload.job.id);
            await pollRefreshJob(persistedPayload.job.id);
            return;
          }
          if (status === 'erro' || status === 'cancelado' || status === 'failed_auth') {
            const errorMessage = persistedPayload.failures?.[0]
              || persistedPayload.job.last_event?.message
              || 'Falha ao atualizar snapshot do catálogo.';
            concludeRefreshTracking('error', errorMessage);
            return;
          }
          clearRefreshTracking();
          setRefreshJobStatus('idle');
          return;
        }
      }

      const payload = await fetchRefreshStatus();
      if (!payload.success || !payload.job?.id) {
        setRefreshJobStatus('idle');
        return;
      }

      const status = payload.job.status;
      if (status === 'pendente' || status === 'rodando') {
        startRefreshPolling(payload.job.id);
        await pollRefreshJob(payload.job.id);
        return;
      }

      setRefreshJobStatus('idle');
    } catch {
      setRefreshJobStatus('idle');
    }
  }, [clearRefreshTracking, concludeRefreshTracking, fetchRefreshStatus, mode, pollRefreshJob, startRefreshPolling]);

  useEffect(() => {
    if (mode !== 'no_catalogo') {
      clearRefreshPolling();
      setRefreshJobStatus('idle');
      return;
    }
    void resumeRefreshIfRunning();
  }, [clearRefreshPolling, mode, resumeRefreshIfRunning]);

  useEffect(() => {
    return () => {
      clearRefreshPolling();
    };
  }, [clearRefreshPolling]);

  const clearMlPublishPolling = useCallback(() => {
    if (mlPublishPollingRef.current) {
      clearTimeout(mlPublishPollingRef.current);
      mlPublishPollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearMlPublishPolling();
    };
  }, [clearMlPublishPolling]);

  const pollMlPublishStatus = useCallback(async (outboxId: string) => {
    const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(outboxId)}`);
    const payload = await response.json().catch(() => ({})) as MlPublishStatusResponse;
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha ao consultar status da publicação.');
    }
    return payload;
  }, []);

  const scheduleMlPublishPolling = useCallback((outboxId: string) => {
    clearMlPublishPolling();
    mlPublishPollingRef.current = setTimeout(async () => {
      try {
        const payload = await pollMlPublishStatus(outboxId);
        setMlPublishLastStatus(payload);
        setMlPublishModalSteps(buildMlPublishSteps(payload));
        if (payload.status === 'done' || payload.status === 'failed') {
          clearMlPublishPolling();
          return;
        }
        scheduleMlPublishPolling(outboxId);
      } catch (error: any) {
        const mensagem = error?.message || 'Erro ao consultar status da publicação no ML.';
        setMlPublishLastStatus({
          success: false,
          status: 'failed',
          phase: 'erro',
          last_error: mensagem,
          error: mensagem,
          outboxId,
          result: null,
        });
        setMlPublishModalSteps(buildMlPublishSteps({
          success: false,
          status: 'failed',
          phase: 'erro',
          last_error: mensagem,
          outboxId,
          result: null,
        }));
        clearMlPublishPolling();
      }
    }, ML_PUBLISH_POLLING_INTERVAL_MS);
  }, [clearMlPublishPolling, pollMlPublishStatus]);

  const startMlPublishTracking = useCallback((outboxId: string) => {
    setMlPublishOutboxId(outboxId);
    setMlPublishLastStatus({
      success: true,
      status: 'pending',
      phase: 'enfileirado',
      outboxId,
      result: null,
    });
    setMlPublishModalSteps(buildMlPublishSteps({
      success: true,
      status: 'pending',
      phase: 'enfileirado',
      outboxId,
      result: null,
    }));
    setMlPublishModalOpen(true);
    scheduleMlPublishPolling(outboxId);
  }, [scheduleMlPublishPolling]);

  const refreshNoCatalogoSnapshot = useCallback(async () => {
    if (mode !== 'no_catalogo' || refreshJobStatus === 'running') return;
    try {
      const res = await fetch('/api/catalogo/no-catalogo/refresh/job', {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success || !json?.jobId) {
        messageApi.error(json?.error || json?.erro || 'Falha ao iniciar atualização do snapshot.');
        return;
      }
      startRefreshPolling(String(json.jobId));
      await pollRefreshJob(String(json.jobId));
    } catch {
      messageApi.error('Erro de conexão ao iniciar atualização do snapshot.');
    }
  }, [messageApi, mode, pollRefreshJob, refreshJobStatus, startRefreshPolling]);

  const handleOptin = useCallback(async (row: ElegivelRow) => {
    const catalogProductId = row.catalog_product_id || '';
    if (!catalogProductId) {
      messageApi.error('Item sem catalog_product_id. Opt-in não pode ser feito automaticamente.');
      return;
    }

    const variationId = Array.isArray(row.variation_eligibility)
      ? row.variation_eligibility.find((v) => String(v.status || '').toUpperCase() === 'READY_FOR_OPTIN' && v.buy_box_eligible)?.id
      : undefined;

    const res = await fetch('/api/catalogo/optin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: row.ml_item_id, catalogProductId, variationId }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      messageApi.error(json?.erro || 'Falha ao criar anúncio de catálogo');
      return;
    }

    messageApi.success('Opt-in de catálogo executado com sucesso');
    fetchData();
  }, [fetchData, messageApi]);

  const executeMlPriceUpdate = useCallback(async (context: PublishActionContext) => {
    if (mode !== 'no_catalogo') return;
    if (mlPublishModalOpen && mlPublishOutboxId) {
      messageApi.warning('Já existe uma publicação em acompanhamento. Aguarde finalizar para iniciar outra.');
      return;
    }

    setUpdatingPriceByItem((prev) => ({ ...prev, [context.itemKey]: true }));
    try {
      const res = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: context.produtoId,
          targetPrice: context.targetPrice,
          source: context.source,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(data?.error || 'Falha ao atualizar preço do anúncio no ML.');
        return;
      }

      const queued = Boolean(data?.queued_publish);
      const outboxId = String(data?.outboxId || '').trim();
      if (!queued || !outboxId) {
        const errors = Array.isArray(data?.errors) ? data.errors.filter(Boolean).join(' | ') : '';
        messageApi.error(errors || 'Não foi possível enfileirar a atualização de preço do anúncio.');
        return;
      }

      setMlPublishRetryContext(context);
      startMlPublishTracking(outboxId);
      messageApi.success('Atualização enfileirada. Acompanhe o processamento no modal.');
      fetchData();
    } catch {
      messageApi.error('Erro de conexão ao atualizar preço do anúncio.');
    } finally {
      setUpdatingPriceByItem((prev) => ({ ...prev, [context.itemKey]: false }));
    }
  }, [fetchData, messageApi, mlPublishModalOpen, mlPublishOutboxId, mode, startMlPublishTracking]);

  const runAnalisePreco = useCallback(async () => {
    if (mode !== 'no_catalogo' || analiseLoading) return;
    setAnaliseLoading(true);
    setAnaliseErro(null);
    try {
      const res = await fetch('/api/catalogo/no-catalogo/analise-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topN: Number.isFinite(analiseTopN) ? Math.max(1, Math.floor(analiseTopN)) : 50,
          refreshMode: 'incremental',
        }),
      });
      const json = await res.json().catch(() => ({})) as AnalisePrecoResponse;
      if (!res.ok || !json?.success) {
        const erro = json?.erro || 'Falha ao executar reanálise de preço.';
        setAnaliseErro(erro);
        messageApi.error(erro);
        return;
      }

      setAnaliseData(Array.isArray(json.data) ? json.data : []);
      setAnaliseTotal(Number(json.total_analisado || 0));
      setAnaliseClasses(json.classes || {});
      setAnaliseRefreshStatus(json.refresh?.status || null);
      setAnaliseUltimaExecucao(new Date().toISOString());
      messageApi.success('Reanálise de preço concluída.');
    } catch {
      const erro = 'Erro de conexão ao executar reanálise de preço.';
      setAnaliseErro(erro);
      messageApi.error(erro);
    } finally {
      setAnaliseLoading(false);
    }
  }, [analiseLoading, analiseTopN, messageApi, mode]);

  const handleAtualizarPrecoParaGanhar = useCallback(async (row: NoCatalogoRow) => {
    if (mode !== 'no_catalogo') return;
    if (!row.produto_id) {
      messageApi.error('Anúncio sem vínculo com produto local. Vincule o produto para atualizar preço.');
      return;
    }
    const targetPrice = Number(row.price_to_win);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      messageApi.error('ML não retornou preço para ganhar Buy Box nesse anúncio.');
      return;
    }
    const itemKey = String(row.ml_item_id || row.anuncio_id || row.produto_id);
    await executeMlPriceUpdate({
      produtoId: row.produto_id,
      targetPrice,
      source: 'catalog_price_to_win',
      itemKey,
    });
  }, [executeMlPriceUpdate, messageApi, mode]);

  const handleAtualizarPrecoReanalise = useCallback(async (row: AnalisePrecoRow) => {
    if (mode !== 'no_catalogo') return;
    if (!row.produto_id) {
      messageApi.error('Anúncio sem vínculo com produto local. Vincule o produto para atualizar preço.');
      return;
    }
    const targetPrice = Number(row.price_to_win);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      messageApi.error('ML não retornou preço para ganhar Buy Box nesse anúncio.');
      return;
    }
    const itemKey = String(row.ml_item_id || row.produto_id || '');
    await executeMlPriceUpdate({
      produtoId: row.produto_id,
      targetPrice,
      source: 'catalog_price_to_win',
      itemKey,
    });
  }, [executeMlPriceUpdate, messageApi, mode]);

  const closeMlPublishModal = useCallback(() => {
    clearMlPublishPolling();
    setMlPublishModalOpen(false);
    setMlPublishOutboxId(null);
    setMlPublishLastStatus(null);
    setMlPublishApplyingWholesale(false);
    setMlPublishModalSteps(buildMlPublishSteps(null));
  }, [clearMlPublishPolling]);

  const retryMlPublish = useCallback(() => {
    const retry = mlPublishRetryContext;
    closeMlPublishModal();
    if (!retry) return;
    void executeMlPriceUpdate(retry);
  }, [closeMlPublishModal, executeMlPriceUpdate, mlPublishRetryContext]);

  const applyWholesaleFromModal = useCallback(async () => {
    if (mlPublishApplyingWholesale) return;
    if (mode !== 'no_catalogo') return;
    const produtoId = mlPublishRetryContext?.produtoId;
    const itemPrice = Number(mlPublishLastStatus?.result?.item_price);
    const outboxProcessing = Boolean(
      mlPublishModalOpen
      && mlPublishOutboxId
      && mlPublishLastStatus?.status !== 'done'
      && mlPublishLastStatus?.status !== 'failed',
    );
    if (outboxProcessing) {
      messageApi.warning('Já existe uma publicação em acompanhamento. Aguarde finalizar.');
      return;
    }
    if (!produtoId || !Number.isFinite(itemPrice) || itemPrice <= 0) {
      messageApi.error('Não foi possível identificar preço base válido para aplicar atacado.');
      return;
    }

    setMlPublishApplyingWholesale(true);
    try {
      const response = await fetch('/api/ml/anuncio/aplicar-atacado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId,
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

      startMlPublishTracking(outboxId);
      messageApi.success('Aplicação de atacado enfileirada. Acompanhe no modal.');
    } catch {
      messageApi.error('Erro de conexão ao aplicar atacado.');
    } finally {
      setMlPublishApplyingWholesale(false);
    }
  }, [
    messageApi,
    mlPublishApplyingWholesale,
    mlPublishLastStatus?.result?.item_price,
    mlPublishLastStatus?.status,
    mlPublishModalOpen,
    mlPublishOutboxId,
    mlPublishRetryContext?.produtoId,
    mode,
    startMlPublishTracking,
  ]);

  const canApplyWholesaleFromModal = Boolean(
    mlPublishLastStatus?.status === 'done'
    && !mlPublishApplyingWholesale
    && !(mlPublishLastStatus?.result?.has_quantity_pricing)
    && Number(mlPublishLastStatus?.result?.item_price || 0) > 0
    && mlPublishRetryContext?.produtoId,
  );

  const columnsAnalisePreco: TableProps<AnalisePrecoRow>['columns'] = useMemo(() => ([
    {
      title: 'Anúncio',
      dataIndex: 'ml_item_id',
      key: 'ml_item_id',
      width: 140,
      render: (v, record) => record.permalink
        ? <a href={record.permalink} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace' }}>{v || '—'}</a>
        : <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    { title: 'Título', dataIndex: 'titulo', key: 'titulo', width: 280, render: (v) => v || '—' },
    { title: 'SKU', dataIndex: 'sku_local', key: 'sku_local', width: 120, render: (v) => v || '—' },
    { title: 'Preço Atual', dataIndex: 'preco_atual', key: 'preco_atual', width: 120, render: (v) => formatCurrency(Number(v || 0)) },
    { title: 'Preço p/ Ganhar', dataIndex: 'price_to_win', key: 'price_to_win', width: 130, render: (v) => (v === null ? '—' : formatCurrency(Number(v))) },
    {
      title: 'Diferença',
      dataIndex: 'delta_preco',
      key: 'delta_preco',
      width: 120,
      render: (v) => {
        if (v === null) return '—';
        const n = Number(v || 0);
        const color = n > 0 ? '#faad14' : n < 0 ? '#52c41a' : '#a0a0a0';
        return <span style={{ color }}>{formatCurrency(n)}</span>;
      },
    },
    { title: 'Lucro Estimado', dataIndex: 'lucro_unitario_estimado', key: 'lucro_unitario_estimado', width: 130, render: (v) => (v === null ? '—' : formatCurrency(Number(v))) },
    {
      title: 'Classe',
      dataIndex: 'classe',
      key: 'classe',
      width: 200,
      render: (v) => <Tag color={classColor(v)}>{classLabel(v)}</Tag>,
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 70,
      fixed: 'right',
      render: (_, record) => {
        const itemKey = String(record.ml_item_id || record.produto_id || '');
        const updating = Boolean(updatingPriceByItem[itemKey]);
        const noPriceToWin = !(Number.isFinite(Number(record.price_to_win)) && Number(record.price_to_win) > 0);
        const noProduto = !record.produto_id;
        const updateDisabled = updating || noPriceToWin || noProduto;
        return (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'updatePriceToWin',
                  disabled: updateDisabled,
                  label: updating
                    ? 'Atualizando...'
                    : noPriceToWin
                      ? 'Atualizar preço p/ ganhar (sem preço sugerido)'
                      : noProduto
                        ? 'Atualizar preço p/ ganhar (sem produto vinculado)'
                        : 'Atualizar preço p/ ganhar',
                },
              ],
              onClick: ({ key }) => {
                if (key === 'updatePriceToWin') handleAtualizarPrecoReanalise(record);
              },
            }}
            trigger={['click']}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ]), [handleAtualizarPrecoReanalise, updatingPriceByItem]);

  const columnsNoCatalogo: TableProps<NoCatalogoRow>['columns'] = useMemo(() => ([
    { title: 'SKU', dataIndex: 'sku_local', key: 'sku_local', width: 130, render: (v) => v || '—' },
    {
      title: 'Anúncio',
      dataIndex: 'anuncio_id',
      key: 'anuncio_id',
      width: 140,
      render: (v, record) => record.permalink
        ? <a href={record.permalink} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace' }}>{v}</a>
        : <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    {
      title: 'Relacionado',
      dataIndex: 'relacionado_id',
      key: 'relacionado_id',
      width: 140,
      render: (v, record) => {
        if (!v) return '—';
        if (record.related_permalink) {
          return <a href={record.related_permalink} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace' }}>{v}</a>;
        }
        return <span style={{ fontFamily: 'monospace' }}>{v}</span>;
      },
    },
    { title: 'Título', dataIndex: 'title', key: 'title', width: 300 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (v) => <Tag color={v === 'active' ? 'green' : v === 'paused' ? 'orange' : 'default'}>{mapStatusMlToPt(v)}</Tag>,
    },
    {
      title: 'Buy Box?',
      dataIndex: 'buy_box_status',
      key: 'buy_box_status',
      width: 120,
      render: (v) => {
        if (!v) return '—';
        const normalized = String(v).toLowerCase();
        const ganhando = normalized === 'winning' || normalized === 'sharing_first_place';
        return <Tag color={ganhando ? 'green' : 'red'}>{ganhando ? 'Ganhando' : 'Perdendo'}</Tag>;
      },
    },
    { title: 'Preço', dataIndex: 'price', key: 'price', width: 110, render: (v) => formatCurrency(Number(v || 0)) },
    { title: 'Preço p/ Ganhar', dataIndex: 'price_to_win', key: 'price_to_win', width: 140, render: (v) => (v === null || v === undefined ? '—' : formatCurrency(Number(v))) },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const itemKey = String(record.ml_item_id || record.anuncio_id || record.produto_id || '');
        const updating = Boolean(updatingPriceByItem[itemKey]);
        const noPriceToWin = !(Number.isFinite(Number(record.price_to_win)) && Number(record.price_to_win) > 0);
        const noProduto = !record.produto_id;
        const updateDisabled = updating || noPriceToWin || noProduto;

        const menuItems: MenuProps['items'] = [
          {
            key: 'updatePriceToWin',
            disabled: updateDisabled,
            label: updating
              ? 'Atualizando...'
              : noPriceToWin
                ? 'Atualizar preço p/ ganhar (sem preço sugerido)'
                : noProduto
                  ? 'Atualizar preço p/ ganhar (sem produto vinculado)'
                  : 'Atualizar preço p/ ganhar',
          },
        ];

        return (
          <Dropdown
            menu={{
              items: menuItems,
              onClick: ({ key }) => {
                if (key === 'updatePriceToWin') handleAtualizarPrecoParaGanhar(record);
              },
            }}
            trigger={['click']}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ]), [handleAtualizarPrecoParaGanhar, updatingPriceByItem]);

  const columnsElegiveis: TableProps<ElegivelRow>['columns'] = useMemo(() => ([
    { title: 'Seller SKU', dataIndex: 'seller_sku', key: 'seller_sku', width: 130, render: (v) => v || '—' },
    { title: 'ML Item', dataIndex: 'ml_item_id', key: 'ml_item_id', width: 130, render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: 'Título', dataIndex: 'title', key: 'title', width: 300 },
    { title: 'Status ML', dataIndex: 'status', key: 'status', width: 110, render: (v) => <Tag color={v === 'active' ? 'green' : v === 'paused' ? 'orange' : 'default'}>{v || '—'}</Tag> },
    { title: 'Preço', dataIndex: 'price', key: 'price', width: 110, render: (v) => formatCurrency(Number(v || 0)) },
    { title: 'Category', dataIndex: 'category_id', key: 'category_id', width: 110, render: (v) => v || '—' },
    { title: 'Domain', dataIndex: 'domain_id', key: 'domain_id', width: 120, render: (v) => v || '—' },
    { title: 'Catalog Product', dataIndex: 'catalog_product_id', key: 'catalog_product_id', width: 160, render: (v) => v || '—' },
    {
      title: 'Elegibilidade', dataIndex: 'eligibility_status', key: 'eligibility_status', width: 170,
      render: (v) => <Tag color={eligibilityColor[String(v || '').toUpperCase()] || 'default'}>{v || '—'}</Tag>,
    },
    { title: 'Buy Box', dataIndex: 'buy_box_eligible', key: 'buy_box_eligible', width: 90, render: (v) => <Tag color={v ? 'green' : 'red'}>{v ? 'SIM' : 'NÃO'}</Tag> },
    { title: 'Motivo', dataIndex: 'eligibility_reason', key: 'eligibility_reason', width: 220, render: (v) => v || '—' },
    { title: 'Variações aptas', dataIndex: 'variation_eligibility', key: 'variation_eligibility', width: 120, render: (v) => Array.isArray(v) ? v.filter((x) => String(x?.status || '').toUpperCase() === 'READY_FOR_OPTIN').length : 0 },
    { title: 'Atualizado', dataIndex: 'last_updated', key: 'last_updated', width: 160, render: (v) => v ? new Date(v).toLocaleString('pt-BR') : '—' },
    {
      title: 'Link', dataIndex: 'permalink', key: 'permalink', width: 90,
      render: (v) => v ? <a href={v} target="_blank" rel="noopener noreferrer">Abrir</a> : '—',
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Ver no ML' },
              { key: 'optin', label: 'Criar anúncio de catálogo' },
            ],
            onClick: ({ key }) => {
              if (key === 'view' && record.permalink) window.open(record.permalink, '_blank');
              if (key === 'optin') handleOptin(record);
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ]), [handleOptin]);

  const anunciosTabContent = (
    <>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Spin spinning={loadingResumoNoCatalogo} indicator={<LoadingOutlined style={{ fontSize: 20, color: '#1677ff' }} spin />}>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title={<span style={{ color: '#a0a0a0' }}>Total</span>} value={resumoNoCatalogo.total} valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title={<span style={{ color: '#a0a0a0' }}>Ativos</span>} value={resumoNoCatalogo.ativos} valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title={<span style={{ color: '#a0a0a0' }}>Pausados</span>} value={resumoNoCatalogo.pausados} valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title={<span style={{ color: '#a0a0a0' }}>Ganhando</span>} value={resumoNoCatalogo.ganhando} valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title={<span style={{ color: '#a0a0a0' }}>Perdendo</span>} value={resumoNoCatalogo.perdendo} valueStyle={{ color: '#ff4d4f', fontWeight: 700, fontSize: 24 }} />
            </Col>
          </Row>
        </Spin>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (SKU, título, IDs)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              value={statusMl}
              onChange={setStatusMl}
              options={statusMlOptions}
              style={{ width: 180 }}
            />
          </Col>
          <Col>
            <Select
              placeholder="Buy Box"
              value={buyBoxFilter === 'all' ? undefined : buyBoxFilter}
              onChange={setBuyBoxFilter}
              options={buyBoxOptions}
              style={{ width: 140 }}
              allowClear
              onClear={() => setBuyBoxFilter('all')}
            />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Preço mín" value={priceMin} onChange={(v) => setPriceMin(v ?? null)} style={{ width: 120 }} />
              <InputNumber placeholder="Preço máx" value={priceMax} onChange={(v) => setPriceMax(v ?? null)} style={{ width: 120 }} />
            </Space.Compact>
          </Col>
          <Col>
            <Button
              icon={refreshJobStatus === 'running' ? <LoadingOutlined spin /> : <ReloadOutlined />}
              onClick={refreshNoCatalogoSnapshot}
              loading={refreshJobStatus === 'running'}
            >
              Atualizar agora
            </Button>
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
          <ResizableTable<NoCatalogoRow>
            storageKey="catalogo-no-catalogo"
            rowKey="ml_item_id"
            dataSource={noCatalogoData}
            columns={columnsNoCatalogo}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: (p) => {
                setPage(p);
              },
              showTotal: (t) => `${t} anúncios`,
            }}
            scroll={{ x: 1400 }}
            size="small"
            style={{ background: 'transparent' }}
          />
        </Spin>
      </div>
    </>
  );

  const reanaliseTabContent = (
    <>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col>
            <Space>
              <span style={{ color: '#a0a0a0' }}>Top N</span>
              <InputNumber
                min={1}
                max={500}
                value={analiseTopN}
                onChange={(v) => setAnaliseTopN(Number(v || 50))}
                style={{ width: 120 }}
              />
            </Space>
          </Col>
          <Col>
            <Button type="primary" onClick={runAnalisePreco} loading={analiseLoading}>
              Reanalisar
            </Button>
          </Col>
          <Col>
            <span style={{ color: '#a0a0a0', fontSize: 12 }}>
              {analiseUltimaExecucao ? `Última execução: ${new Date(analiseUltimaExecucao).toLocaleString('pt-BR')}` : 'Ainda não executado'}
            </span>
          </Col>
          <Col>
            <span style={{ color: '#a0a0a0', fontSize: 12 }}>
              Refresh: {analiseRefreshStatus || '—'}
            </span>
          </Col>
        </Row>
        {analiseErro && (
          <div style={{ marginTop: 12 }}>
            <Tag color="red">{analiseErro}</Tag>
          </div>
        )}
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Total analisado</span>} value={analiseTotal} valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Ajustar para ganhar</span>} value={Number(analiseClasses.ajustar_para_ganhar_sem_prejuizo || 0)} valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Não viável sem prejuízo</span>} value={Number(analiseClasses.nao_viavel_ganhar_sem_prejuizo || 0)} valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Dados insuficientes</span>} value={Number(analiseClasses.dados_insuficientes || 0)} valueStyle={{ color: '#d9d9d9', fontWeight: 700, fontSize: 24 }} />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Spin spinning={analiseLoading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
          <ResizableTable<AnalisePrecoRow>
            storageKey="catalogo-no-catalogo-reanalise"
            rowKey="ml_item_id"
            dataSource={analiseData}
            columns={columnsAnalisePreco}
            pagination={false}
            scroll={{ x: 1900 }}
            size="small"
            style={{ background: 'transparent' }}
          />
        </Spin>
      </div>
    </>
  );

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Catálogo - Mercado Livre</Title>

      {mode === 'no_catalogo' ? (
        <Tabs
          activeKey={activeNoCatalogTab}
          onChange={(key) => setActiveNoCatalogTab(key as 'anuncios' | 'reanalisar')}
          items={[
            { key: 'anuncios', label: 'Anúncios', children: anunciosTabContent },
            { key: 'reanalisar', label: 'Reanálise de Preço', children: reanaliseTabContent },
          ]}
        />
      ) : (
        <>
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <Row gutter={[8, 8]} align="middle">
              <Col>
                <Input
                  placeholder="Buscar (SKU, título, IDs)"
                  prefix={<SearchOutlined />}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 280 }}
                  allowClear
                />
              </Col>
              <Col>
                <Select
                  value={statusMl}
                  onChange={setStatusMl}
                  options={statusMlOptions}
                  style={{ width: 180 }}
                />
              </Col>
              <Col>
                <Select
                  value={eligibilityStatus}
                  onChange={setEligibilityStatus}
                  options={eligibilityStatusOptions}
                  style={{ width: 210 }}
                />
              </Col>
              <Col>
                <Space.Compact>
                  <InputNumber placeholder="Preço mín" value={priceMin} onChange={(v) => setPriceMin(v ?? null)} style={{ width: 120 }} />
                  <InputNumber placeholder="Preço máx" value={priceMax} onChange={(v) => setPriceMax(v ?? null)} style={{ width: 120 }} />
                </Space.Compact>
              </Col>
            </Row>
          </div>

          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
            <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
              <ResizableTable<ElegivelRow>
                storageKey="catalogo-elegiveis"
                rowKey="ml_item_id"
                dataSource={elegiveisData}
                columns={columnsElegiveis}
                pagination={{
                  current: page,
                  pageSize: PAGE_SIZE,
                  total,
                  showSizeChanger: false,
                  onChange: (p) => {
                    setPage(p);
                  },
                  showTotal: (t) => `${t} anúncios`,
                }}
                scroll={{ x: 2200 }}
                size="small"
                style={{ background: 'transparent' }}
              />
            </Spin>
          </div>
        </>
      )}

      <ProgressModal
        open={mlPublishModalOpen}
        title="Atualizando preço no Mercado Livre"
        steps={mlPublishModalSteps}
        onClose={closeMlPublishModal}
        onCancel={retryMlPublish}
        showCloseButton={mlPublishLastStatus?.status === 'failed' || mlPublishLastStatus?.status === 'done'}
        customActions={canApplyWholesaleFromModal ? [{
          key: 'apply_wholesale',
          label: mlPublishApplyingWholesale ? 'Criando atacado...' : 'Criar preços de atacado',
          onClick: () => { void applyWholesaleFromModal(); },
          primary: true,
        }] : []}
      />
    </div>
  );
}
