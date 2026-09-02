'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import {
  BarChartOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  EllipsisOutlined,
  EyeOutlined,
  FilePdfOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ResizableTable from '@/components/ResizableTable';
import ProgressModal from '@/components/modals/ProgressModal';
import { formatCurrency } from '@/lib/format';
import type {
  MlCatalogStatus,
  MlListingDashboardRow,
  MlListingMetrics,
  MlListingQueueCounts,
  MlListingsFocus,
} from '@/lib/ml/listings-dashboard';
import {
  appendRemoteSortParams,
  getRemoteSortOrder,
  resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import { useMlPricePublishTracking } from '@/hooks/useMlPricePublishTracking';
import styles from './anuncios.module.css';

const { Title, Text } = Typography;

type ListingRow = MlListingDashboardRow & {
  publishEligibility?: {
    eligible: boolean;
    kind: string;
    reason: string | null;
    retryAt: string | null;
  };
};

type PricingDetails = {
  currentPrice: number;
  currentProfit: number;
  quantityPricing: Array<{
    min_purchase_unit: number;
    discount_percent: number;
    amount: number;
    currency_id: string;
    pricing_model: 'percentage' | 'absolute';
  }>;
  quantityPricingWarning: string | null;
  calculator: { cost: number; shipping: number; mlFee: number; taxRate: number };
  automaticPricing: { active: boolean; tag: string };
  catalog: {
    status: MlCatalogStatus;
    rawStatus: string | null;
    priceToWin: number | null;
    catalogProductId: string | null;
    currentPrice: number;
    currencyId: string;
    consistent: boolean | null;
    visitShare: string | null;
    competitorsSharingFirstPlace: number | null;
    winner: { itemId: string | null; price: number | null; currencyId: string } | null;
    boosts: Array<{ id: string; status: string; description: string }>;
    reasons: string[];
    warning: string | null;
    syncedAt: string | null;
  } | null;
};

type PriceResult = {
  mlItemId: string;
  type: 'standard' | 'catalog';
  success: boolean;
  price_updated: boolean;
  queued_publish: boolean;
  outboxId: string | null;
  warnings: string[];
  errors: string[];
  trackingStatus?: string;
  trackingError?: string | null;
};

type BatchResult = {
  produtoId: string;
  sku: string;
  mlItemId: string | null;
  outcome: string;
  outboxId: string | null;
  error: string | null;
  trackingStatus?: string;
};

type SyncJob = {
  id: string;
  status: string;
  progresso: number;
  processados: number;
  total: number;
  progressUnit?: string | null;
  last_event?: { message?: string | null; timestamp?: string | null } | null;
};

type VisualReviewMetadata = {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  itemCount: number;
};

const EMPTY_METRICS: MlListingMetrics = { total: 0, active: 0, paused: 0, qualityRisk: 0, priceReview: 0 };
const EMPTY_QUEUES: MlListingQueueCounts = { ...EMPTY_METRICS };
const TERMINAL_JOB_STATUSES = new Set(['completo', 'completo_parcial', 'erro', 'cancelado', 'failed_auth']);

const qualityOptions = [
  { value: 'all', label: 'Qualquer qualidade' },
  { value: 'risk', label: 'Em risco (< 80)' },
  { value: 'good', label: 'Boa (80–99)' },
  { value: 'perfect', label: 'Completa (100)' },
  { value: 'unavailable', label: 'Sem leitura disponível' },
];

const catalogOptions = [
  { value: 'all', label: 'Padrão e catálogo' },
  { value: 'standard', label: 'Somente padrão' },
  { value: 'catalog', label: 'Somente catálogo' },
  { value: 'winning', label: 'Ganhando Buy Box' },
  { value: 'competing', label: 'Competindo' },
  { value: 'losing', label: 'Perdendo' },
];

const profitabilityOptions = [
  { value: 'all', label: 'Qualquer rentabilidade' },
  { value: 'positive', label: 'Lucro positivo' },
  { value: 'negative', label: 'Prejuízo' },
  { value: 'unknown', label: 'Sem cálculo' },
];

const statusPresentation: Record<string, { color: string; label: string }> = {
  active: { color: 'success', label: 'Ativo' },
  paused: { color: 'warning', label: 'Pausado' },
  under_review: { color: 'processing', label: 'Em revisão' },
  closed: { color: 'default', label: 'Encerrado' },
  inactive: { color: 'default', label: 'Inativo' },
};

const catalogPresentation: Record<MlCatalogStatus, { label: string; tone: string }> = {
  ganhando: { label: 'Ganhando a Buy Box', tone: styles.catalogWinning },
  competindo: { label: 'Competindo pela Buy Box', tone: styles.catalogCompeting },
  perdendo: { label: 'Fora da Buy Box', tone: styles.catalogLosing },
  sem_catalogo: { label: 'Anúncio padrão', tone: styles.catalogStandard },
};

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatDateTime(value: string | null) {
  if (!value) return 'Não sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function calculateProfit(price: number, calculator: PricingDetails['calculator']) {
  return Math.round((price - calculator.cost - calculator.shipping - (price * calculator.taxRate) - (price * calculator.mlFee)) * 100) / 100;
}

function batchOutcomeLabel(outcome: string) {
  if (outcome === 'done') return 'Concluído no ML';
  if (outcome === 'processing') return 'Processando no ML';
  if (outcome === 'queued') return 'Enfileirado';
  if (outcome === 'already_target') return 'Já estava no estado';
  if (outcome === 'unchanged') return 'Fila já existente';
  if (outcome === 'skipped_no_item') return 'Sem anúncio operacional';
  if (outcome === 'skipped_ineligible') return 'Estado não modificável';
  return 'Falhou';
}

export default function AnunciosPage() {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState<MlListingMetrics>(EMPTY_METRICS);
  const [queueCounts, setQueueCounts] = useState<MlListingQueueCounts>(EMPTY_QUEUES);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'product', sortOrder: 'asc' });
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [focus, setFocus] = useState<MlListingsFocus>('all');
  const [quality, setQuality] = useState('all');
  const [catalog, setCatalog] = useState('all');
  const [profitability, setProfitability] = useState('all');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [analysis, setAnalysis] = useState<{ open: boolean; row: ListingRow | null }>({ open: false, row: null });
  const [details, setDetails] = useState<PricingDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceResults, setPriceResults] = useState<PriceResult[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchTarget, setBatchTarget] = useState<'ativo' | 'pausado' | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const [syncFailures, setSyncFailures] = useState<string[]>([]);
  const [syncStarting, setSyncStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestRef = useRef(0);
  const {
    startTracking: startPriceTracking,
    progressModalProps,
  } = useMlPricePublishTracking(message);

  const fetchListings = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), focus, quality, catalog, profitability });
      appendRemoteSortParams(params, sort);
      if (committedSearch) params.set('search', committedSearch);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      const response = await fetch(`/api/anuncios?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.erro || payload?.error || 'Falha ao carregar anúncios');
      if (requestRef.current !== requestId) return;
      setRows(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total || 0));
      setMetrics({ ...EMPTY_METRICS, ...(payload.metrics || {}) });
      setQueueCounts({ ...EMPTY_QUEUES, ...(payload.queueCounts || {}) });
      setLastSyncedAt(payload.lastSyncedAt || null);
      setVisualReview(payload?.visualReview?.enabled === true ? payload.visualReview : null);
      setSelectedRowKeys([]);
    } catch (fetchError: any) {
      if (requestRef.current !== requestId) return;
      setRows([]);
      setTotal(0);
      setError(fetchError?.message || 'Falha ao carregar anúncios');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [catalog, committedSearch, focus, page, priceMax, priceMin, profitability, quality, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = search.trim();
      if (nextSearch !== committedSearch) {
        setPage(1);
        setCommittedSearch(nextSearch);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [committedSearch, search]);

  useEffect(() => { setPage(1); }, [catalog, focus, priceMax, priceMin, profitability, quality]);
  useEffect(() => { void fetchListings(); }, [fetchListings]);

  const loadPriceDetails = useCallback(async (row: ListingRow) => {
    if (row.isHomologationFixture) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    if (!row.productId) {
      setDetailsError('Este anúncio não possui vínculo com um produto Bentevi.');
      return;
    }
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const params = new URLSearchParams({ produtoId: row.productId, mlItemId: row.itemId });
      const response = await fetch(`/api/ml/anuncio/preco-detalhe?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Falha ao analisar preço e catálogo');
      setDetails(payload as PricingDetails);
      setNewPrice(Number(payload.currentPrice));
    } catch (loadError: any) {
      setDetailsError(loadError?.message || 'Falha ao analisar preço e catálogo');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const openAnalysis = useCallback((row: ListingRow) => {
    setAnalysis({ open: true, row });
    setDetails(null);
    setDetailsError(null);
    setNewPrice(row.price);
    setPriceResults([]);
    void loadPriceDetails(row);
  }, [loadPriceDetails]);

  const closeAnalysis = () => {
    if (savingPrice) return;
    setAnalysis({ open: false, row: null });
    setDetails(null);
    setDetailsError(null);
    setPriceResults([]);
  };

  useEffect(() => {
    const queued = priceResults.filter((result) => (
      result.outboxId && !['done', 'failed'].includes(String(result.trackingStatus || ''))
    ));
    if (queued.length <= 1) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const statuses = await Promise.all(queued.map(async (result) => {
          const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(result.outboxId || '')}`);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || `Falha ao acompanhar ${result.mlItemId}`);
          return { outboxId: result.outboxId, status: payload.status, error: payload.last_error || null };
        }));
        if (cancelled) return;
        setPriceResults((current) => current.map((result) => {
          const status = statuses.find((item) => item.outboxId === result.outboxId);
          return status ? { ...result, trackingStatus: status.status, trackingError: status.error } : result;
        }));
        if (statuses.every((status) => ['done', 'failed'].includes(status.status))) void fetchListings();
      } catch (pollError: any) {
        if (!cancelled) message.error(pollError?.message || 'Falha ao acompanhar publicação de preço');
      }
    }, 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fetchListings, message, priceResults]);

  const savePrice = useCallback(async () => {
    const row = analysis.row;
    const targetPrice = Number(newPrice);
    if (!row?.productId || !details) return;
    if (details.automaticPricing?.active) {
      message.warning('A edição está bloqueada porque o Mercado Livre controla automaticamente o preço deste anúncio.');
      return;
    }
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      message.warning('Informe um preço maior que zero.');
      return;
    }
    setSavingPrice(true);
    setPriceResults([]);
    try {
      const response = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: row.productId,
          mlItemId: row.itemId,
          targetPrice,
          scope: 'linked',
          source: row.catalogStatus !== 'sem_catalogo' ? 'catalog_price_to_win' : 'default',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) {
        throw new Error(payload?.error || 'Falha ao atualizar preço dos anúncios vinculados');
      }
      const results: PriceResult[] = (Array.isArray(payload.results) ? payload.results : []).map((result: any) => ({
        ...result,
        outboxId: String(result.outboxId || '').trim() || null,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        errors: Array.isArray(result.errors) ? result.errors : [],
        trackingStatus: result.queued_publish ? 'pending' : (result.success ? 'done' : 'failed'),
      }));
      setPriceResults(results);
      const queued = results.filter((result) => result.queued_publish && result.outboxId);
      if (queued.length === 1) {
        startPriceTracking({
          outboxId: queued[0].outboxId || '',
          produtoId: row.productId,
          retry: () => { void savePrice(); },
          onTerminal: (status) => {
            setPriceResults((current) => current.map((result) => (
              result.outboxId === queued[0].outboxId
                ? { ...result, trackingStatus: status.status, trackingError: status.last_error || null }
                : result
            )));
            void fetchListings();
          },
        });
      }
      if (results.every((result) => !result.queued_publish)) await fetchListings();
      if (payload.partial) message.warning('Preço aplicado parcialmente. Confira o resultado de cada anúncio.');
      else message.success('Preço processado para os anúncios padrão e catálogo vinculados.');
    } catch (saveError: any) {
      message.error(saveError?.message || 'Falha ao atualizar preço');
    } finally {
      setSavingPrice(false);
    }
  }, [analysis.row, details, fetchListings, message, newPrice, startPriceTracking]);

  const selectedRows = useMemo(() => {
    const keys = new Set(selectedRowKeys.map(String));
    return rows.filter((row) => keys.has(row.itemId));
  }, [rows, selectedRowKeys]);

  const runStatusBatch = useCallback(async (records: ListingRow[], targetStatus: 'ativo' | 'pausado') => {
    const productIds = [...new Set(records.filter((row) => row.isOperational && row.productId).map((row) => row.productId as string))];
    if (visualReview) {
      message.warning('Alterações operacionais estão bloqueadas na amostra real protegida.');
      return;
    }
    if (productIds.length === 0) {
      message.warning('Selecione anúncios operacionais com produto vinculado.');
      return;
    }
    setBatchOpen(true);
    setBatchTarget(targetStatus);
    setBatchResults([]);
    try {
      const response = await fetch('/api/anuncios/status-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoIds: productIds, targetStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) throw new Error(payload?.error || 'Falha ao alterar estado dos anúncios');
      setBatchResults((Array.isArray(payload.items) ? payload.items : []).map((item: BatchResult) => ({
        ...item,
        trackingStatus: item.outboxId && item.outcome === 'queued' ? 'pending' : undefined,
      })));
      setSelectedRowKeys([]);
      if (payload?.records?.failed > 0) message.warning('Parte do lote falhou. Confira os resultados.');
      else message.success('Alteração enviada para os anúncios operacionais.');
      await fetchListings();
    } catch (batchError: any) {
      setBatchResults([{ produtoId: '', sku: '', mlItemId: null, outcome: 'failed', outboxId: null, error: batchError?.message || 'Falha no lote' }]);
      message.error(batchError?.message || 'Falha ao alterar estado dos anúncios');
    } finally {
      setBatchTarget(null);
    }
  }, [fetchListings, message, visualReview]);

  useEffect(() => {
    const pending = batchResults.filter((result) => (
      result.outboxId && !['done', 'failed'].includes(String(result.trackingStatus || ''))
    ));
    if (pending.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const statuses = await Promise.all(pending.map(async (result) => {
          const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(result.outboxId || '')}`);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || `Falha ao acompanhar ${result.mlItemId || result.sku}`);
          return { outboxId: result.outboxId, status: String(payload.status || 'pending'), error: payload.last_error || null };
        }));
        if (cancelled) return;
        setBatchResults((current) => current.map((result) => {
          const status = statuses.find((item) => item.outboxId === result.outboxId);
          if (!status) return result;
          return {
            ...result,
            trackingStatus: status.status,
            outcome: status.status === 'done' ? 'done' : status.status === 'failed' ? 'failed' : 'processing',
            error: status.error,
          };
        }));
        if (statuses.every((status) => ['done', 'failed'].includes(status.status))) await fetchListings();
      } catch (trackingError: any) {
        if (!cancelled) message.error(trackingError?.message || 'Falha ao acompanhar o lote de status');
      }
    }, 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [batchResults, fetchListings, message]);

  const confirmStatus = useCallback((records: ListingRow[], targetStatus: 'ativo' | 'pausado') => {
    const operational = records.filter((row) => row.isOperational && row.productId);
    modal.confirm({
      title: targetStatus === 'ativo' ? 'Ativar anúncios operacionais?' : 'Pausar anúncios operacionais?',
      content: `${operational.length} produto${operational.length === 1 ? '' : 's'} será${operational.length === 1 ? '' : 'ão'} enviado${operational.length === 1 ? '' : 's'} à fila do Mercado Livre. Anúncios irmãos de catálogo não serão alterados diretamente.`,
      okText: targetStatus === 'ativo' ? 'Ativar' : 'Pausar',
      okButtonProps: { danger: targetStatus === 'pausado' },
      cancelText: 'Cancelar',
      onOk: () => runStatusBatch(operational, targetStatus),
    });
  }, [modal, runStatusBatch]);

  const pollSyncJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/sync/anuncios/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Falha ao acompanhar atualização dos anúncios');
    setSyncJob(payload.job || null);
    setSyncFailures(Array.isArray(payload.failures) ? payload.failures : []);
    return payload.job as SyncJob | null;
  }, []);

  useEffect(() => {
    if (!syncJob?.id || TERMINAL_JOB_STATUSES.has(syncJob.status)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const current = await pollSyncJob(syncJob.id);
        if (!cancelled && current && TERMINAL_JOB_STATUSES.has(current.status)) await fetchListings();
      } catch (syncError: any) {
        if (!cancelled) message.error(syncError?.message || 'Falha ao acompanhar atualização');
      }
    }, 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fetchListings, message, pollSyncJob, syncJob]);

  const startSync = async () => {
    if (visualReview) {
      message.warning('A sincronização externa está bloqueada enquanto a amostra protegida estiver ativa.');
      return;
    }
    setSyncStarting(true);
    setSyncFailures([]);
    try {
      const response = await fetch('/api/sync/anuncios/job', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar atualização');
      const job = await pollSyncJob(String(payload.jobId || ''));
      if (!job) throw new Error('O job foi criado, mas não pôde ser acompanhado.');
      message.success(payload.reused ? 'Atualização existente retomada.' : 'Atualização dos anúncios iniciada.');
    } catch (syncError: any) {
      message.error(syncError?.message || 'Falha ao iniciar atualização dos anúncios');
    } finally {
      setSyncStarting(false);
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ focus, quality, catalog, profitability });
      appendRemoteSortParams(params, sort);
      if (committedSearch) params.set('search', committedSearch);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      const response = await fetch(`/api/anuncios/exportar-pdf?${params}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.erro || payload?.error || 'Falha ao gerar relatório');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `anuncios-mercado-livre-${new Date().toISOString().slice(0, 10)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError: any) {
      message.error(exportError?.message || 'Falha ao exportar relatório');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setSearch(''); setCommittedSearch(''); setFocus('all'); setQuality('all'); setCatalog('all');
    setProfitability('all'); setPriceMin(null); setPriceMax(null); setSort({ sortBy: 'product', sortOrder: 'asc' }); setPage(1);
  };

  const queueOptions = useMemo(() => ([
    { value: 'all', label: <span className={styles.quickViewLabel}>Todos <strong className={styles.quickViewCount}>{queueCounts.total}</strong></span> },
    { value: 'active', label: <span className={styles.quickViewLabel}>Ativos <strong className={styles.quickViewCount}>{queueCounts.active}</strong></span> },
    { value: 'paused', label: <span className={styles.quickViewLabel}>Pausados <strong className={styles.quickViewCount}>{queueCounts.paused}</strong></span> },
    { value: 'quality_risk', label: <span className={styles.quickViewLabel}>Qualidade em risco <strong className={styles.quickViewCount}>{queueCounts.qualityRisk}</strong></span> },
    { value: 'price_review', label: <span className={styles.quickViewLabel}>Preço em revisão <strong className={styles.quickViewCount}>{queueCounts.priceReview}</strong></span> },
  ]), [queueCounts]);

  const columns: TableProps<ListingRow>['columns'] = [
    {
      title: 'Anúncio', key: 'item', width: 255, sorter: true, sortOrder: getRemoteSortOrder('item', sort),
      render: (_value, row) => <div className={styles.listingCell}>
        <Image className={styles.listingImage} width={52} height={52} preview={false} src={row.thumbnail || '/branding/bentevi/bentevi-mark.png'} fallback="/branding/bentevi/bentevi-mark.png" alt="" />
        <div><strong>{row.itemId}</strong><span>{row.listingType === 'catalog' ? 'Anúncio de catálogo' : 'Anúncio padrão'}{row.isOperational ? ' · operacional' : ''}</span></div>
      </div>,
    },
    {
      title: 'Produto', key: 'product', width: 295, sorter: true, sortOrder: getRemoteSortOrder('product', sort),
      render: (_value, row) => <div className={styles.productCell}>
        {row.productId && !row.isHomologationFixture ? <Link href={`/produtos/${row.productId}`}>{row.productName}</Link> : <strong>{row.productName}</strong>}
        <span>SKU Bentevi {row.productSku || 'não informado'}</span>
      </div>,
    },
    {
      title: 'Preço e resultado', key: 'price', width: 170, sorter: true, sortOrder: getRemoteSortOrder('price', sort),
      render: (_value, row) => <div className={styles.valueCell}><strong>{formatCurrency(row.price)}</strong><span className={row.profit === null ? '' : row.profit >= 0 ? styles.positive : styles.negative}>{row.profit === null ? 'Lucro indisponível' : `${formatCurrency(row.profit)} · ${Number(row.marginPercent || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</span></div>,
    },
    {
      title: 'Desempenho', key: 'sold', width: 135, sorter: true, sortOrder: getRemoteSortOrder('sold', sort),
      render: (_value, row) => <div className={styles.performanceCell}><strong>{formatInteger(row.sold)} vendidos</strong><span>{formatInteger(row.visits)} visitas</span></div>,
    },
    {
      title: 'Qualidade', key: 'quality', width: 205, sorter: true, sortOrder: getRemoteSortOrder('quality', sort),
      render: (_value, row) => row.qualityAvailable && row.qualityScore !== null ? <div className={styles.qualityCell}>
        <div><strong>{Number(row.qualityScore).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</strong><span>{row.qualityScore >= 80 ? 'Boa' : 'Requer atenção'}</span></div>
        <Progress percent={Math.max(0, Math.min(100, Number(row.qualityScore)))} showInfo={false} strokeColor={row.qualityScore >= 80 ? '#21d482' : '#ffbd0e'} trailColor="rgba(255,255,255,.08)" size="small" />
        <small>{row.qualityPrimaryIssue || 'Nenhuma melhoria prioritária'}</small>
      </div> : <div className={styles.mutedCell}>Leitura não disponível<small>Sincronize para consultar o desempenho</small></div>,
    },
    {
      title: 'Estado', key: 'status', width: 165, sorter: true, sortOrder: getRemoteSortOrder('status', sort),
      render: (_value, row) => {
        const current = statusPresentation[row.observedStatus] || { color: 'default', label: row.observedStatus || 'Desconhecido' };
        return <div className={styles.statusCell}><Tag color={current.color}>{current.label}</Tag>{row.blockReason || row.lastError ? <small className={styles.negative}>Publicação bloqueada</small> : row.latestPublish && ['pending', 'processing', 'retry'].includes(row.latestPublish.status) ? <small>Alteração em processamento</small> : <small>{row.isOperational ? 'Anúncio operacional' : 'Anúncio vinculado'}</small>}</div>;
      },
    },
    {
      title: 'Catálogo', key: 'catalog', width: 210, sorter: true, sortOrder: getRemoteSortOrder('catalog', sort),
      render: (_value, row) => {
        const view = catalogPresentation[row.catalogStatus] || catalogPresentation.sem_catalogo;
        return <div className={`${styles.catalogCell} ${view.tone}`}><strong>{view.label}</strong>{row.priceToWin ? <span>Preço para ganhar {formatCurrency(row.priceToWin)}</span> : row.catalogProductId ? <span>{row.catalogProductId}</span> : <span>Sem disputa de catálogo</span>}</div>;
      },
    },
    {
      title: 'Ações', key: 'actions', width: 158, fixed: 'right',
      render: (_value, row) => {
        const canChangeStatus = row.isOperational && row.productId && row.publishEligibility?.eligible !== false && !visualReview;
        const menuItems: MenuProps['items'] = [
          { key: 'open', label: 'Abrir no Mercado Livre', disabled: !row.permalink || Boolean(visualReview) },
          { key: 'product', label: 'Ver produto Bentevi', disabled: !row.productId || Boolean(row.isHomologationFixture) },
          { type: 'divider' },
          row.observedStatus === 'active'
            ? { key: 'pause', label: 'Pausar anúncio operacional', icon: <PauseCircleOutlined />, danger: true, disabled: !canChangeStatus }
            : { key: 'activate', label: 'Ativar anúncio operacional', icon: <PlayCircleOutlined />, disabled: !canChangeStatus },
        ];
        return <Space size={6}><Button icon={<BarChartOutlined />} onClick={() => openAnalysis(row)}>Analisar</Button><Dropdown menu={{ items: menuItems, onClick: ({ key }) => {
          if (key === 'open' && row.permalink) window.open(row.permalink, '_blank', 'noopener,noreferrer');
          if (key === 'product' && row.productId) router.push(`/produtos/${row.productId}`);
          if (key === 'pause') confirmStatus([row], 'pausado');
          if (key === 'activate') confirmStatus([row], 'ativo');
        } }} trigger={['click']}><Button icon={<EllipsisOutlined />} aria-label="Mais ações" /></Dropdown></Space>;
      },
    },
  ];

  const handleTableChange: TableProps<ListingRow>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'product', sortOrder: 'asc' });
    const changed = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(changed ? 1 : (pagination.current || 1));
  };

  const activeAnalysis = analysis.row;
  const nextProfit = details && newPrice && newPrice > 0 ? calculateProfit(newPrice, details.calculator) : null;
  const qualityItems = Array.isArray((activeAnalysis?.qualityInfo as any)?.itens) ? (activeAnalysis?.qualityInfo as any).itens : [];
  const syncing = Boolean(syncJob && !TERMINAL_JOB_STATUSES.has(syncJob.status));

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><Title level={2} className={styles.title}>Anúncios</Title><Text type="secondary">Preço, qualidade, estado e competição no Mercado Livre em uma leitura operacional.</Text><small className={styles.lastSync}>Última leitura: {formatDateTime(lastSyncedAt)}</small></div>
      <Space wrap>
        <Button icon={<FilePdfOutlined />} loading={exporting} onClick={() => void exportPdf()} title="Exportar o conjunto filtrado em PDF">Exportar PDF</Button>
        <Button type="primary" icon={<ReloadOutlined />} loading={syncStarting || syncing} disabled={Boolean(visualReview)} onClick={() => void startSync()}>Atualizar dados</Button>
      </Space>
    </header>

    {visualReview && <Alert className={styles.visualReviewAlert} type="warning" showIcon message="Amostra real de produção, somente leitura" description="Lista e análise usam os dados protegidos já disponíveis em homologação. Sincronização, preço, status e links externos permanecem bloqueados." />}
    {syncJob && <Alert className={styles.syncAlert} type={syncJob.status === 'erro' || syncFailures.length > 0 ? 'error' : TERMINAL_JOB_STATUSES.has(syncJob.status) ? 'success' : 'info'} showIcon message={syncing ? 'Atualizando anúncios do Mercado Livre' : `Atualização ${syncJob.status}`} description={<div className={styles.syncDescription}><Progress percent={Number(syncJob.progresso || 0)} status={syncJob.status === 'erro' ? 'exception' : undefined} /><span>{syncJob.processados} de {syncJob.total} {syncJob.progressUnit || 'itens'} · {syncJob.last_event?.message || 'Aguardando próximo evento'}</span>{syncFailures.length > 0 && <small>{syncFailures.slice(0, 3).join(' • ')}</small>}</div>} />}

    <section className={styles.summaryBand}>
      <div><span>Total monitorado</span><strong>{formatInteger(metrics.total)}</strong><small>anúncios vinculados</small></div>
      <div className={styles.summaryPositive}><span>Ativos</span><strong>{formatInteger(metrics.active)}</strong><small>publicados agora</small></div>
      <div><span>Pausados</span><strong>{formatInteger(metrics.paused)}</strong><small>fora de venda</small></div>
      <div className={metrics.qualityRisk > 0 ? styles.summaryWarning : ''}><span>Qualidade em risco</span><strong>{formatInteger(metrics.qualityRisk)}</strong><small>score disponível abaixo de 80</small></div>
      <div className={metrics.priceReview > 0 ? styles.summaryHighlight : ''}><span>Preço em revisão</span><strong>{formatInteger(metrics.priceReview)}</strong><small>catálogo com preço para ganhar</small></div>
    </section>

    <Segmented className={styles.quickViews} options={queueOptions} value={focus} onChange={(value) => setFocus(value as MlListingsFocus)} />

    <section className={styles.filterBar}>
      <Input className={styles.searchInput} prefix={<SearchOutlined />} placeholder="Buscar produto, SKU Bentevi ou ID do anúncio" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
      <Select value={quality} options={qualityOptions} onChange={setQuality} />
      <Select value={catalog} options={catalogOptions} onChange={setCatalog} />
      <Select value={profitability} options={profitabilityOptions} onChange={setProfitability} />
      <Space.Compact className={styles.priceFilter}><InputNumber value={priceMin} onChange={(value) => setPriceMin(value ?? null)} min={0} prefix="R$" placeholder="Preço mín." /><InputNumber value={priceMax} onChange={(value) => setPriceMax(value ?? null)} min={0} prefix="R$" placeholder="Preço máx." /></Space.Compact>
      <Button onClick={clearFilters}>Limpar</Button>
    </section>

    {selectedRows.length > 0 && <section className={styles.bulkBar}><strong>{selectedRows.length} anúncio{selectedRows.length === 1 ? '' : 's'} operacional{selectedRows.length === 1 ? '' : 'is'}</strong><span>As ações alteram somente o anúncio operacional de cada produto.</span><Space><Button icon={<PlayCircleOutlined />} onClick={() => confirmStatus(selectedRows, 'ativo')}>Ativar</Button><Button danger icon={<PauseCircleOutlined />} onClick={() => confirmStatus(selectedRows, 'pausado')}>Pausar</Button></Space></section>}

    <section className={styles.tableCard}>
      {error && <Alert type="error" showIcon message="Não foi possível carregar os anúncios" description={error} action={<Button onClick={() => void fetchListings()}>Tentar novamente</Button>} />}
      <Spin spinning={loading} indicator={<LoadingOutlined spin className={styles.loadingIcon} />}>
        {!error && !loading && rows.length === 0 ? <Empty className={styles.emptyState} description="Nenhum anúncio encontrado com estes filtros"><Button onClick={clearFilters}>Limpar filtros</Button></Empty> : <ResizableTable<ListingRow> className={styles.desktopTable} storageKey="bnt-d11-anuncios" dataSource={rows} columns={columns} rowKey="itemId" rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, getCheckboxProps: (row) => ({ disabled: !row.isOperational || !row.productId || Boolean(visualReview) }) }} pagination={{ current: page, pageSize: 100, total, showSizeChanger: false, showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} onChange={handleTableChange} scroll={{ x: 1600 }} size="small" />}
      </Spin>
    </section>

    <Drawer open={analysis.open} onClose={closeAnalysis} width="min(96vw, 920px)" destroyOnClose title={activeAnalysis ? <div className={styles.drawerTitle}><span>Análise do anúncio</span><strong>{activeAnalysis.itemId}</strong></div> : 'Análise do anúncio'} extra={activeAnalysis?.permalink && !visualReview ? <Button icon={<EyeOutlined />} onClick={() => window.open(activeAnalysis.permalink || '', '_blank', 'noopener,noreferrer')}>Abrir no ML</Button> : null}>
      {activeAnalysis && <div className={styles.drawerContent}>
        {activeAnalysis.isHomologationFixture && <Alert type="warning" showIcon message="Amostra protegida" description="A análise visual está disponível, mas nenhuma consulta ou mutação externa será executada." />}
        {detailsError && <Alert type="error" showIcon message="Análise externa indisponível" description={detailsError} action={<Button onClick={() => void loadPriceDetails(activeAnalysis)}>Tentar novamente</Button>} />}
        <section className={styles.drawerHero}>
          <Image width={76} height={76} preview={false} src={activeAnalysis.thumbnail || '/branding/bentevi/bentevi-mark.png'} fallback="/branding/bentevi/bentevi-mark.png" alt="" />
          <div><span>{activeAnalysis.listingType === 'catalog' ? 'Anúncio de catálogo' : 'Anúncio padrão'}{activeAnalysis.isOperational ? ' · operacional' : ' · vinculado'}</span><Title level={4}>{activeAnalysis.productName}</Title><small>SKU Bentevi {activeAnalysis.productSku}</small></div>
          <Tag color={(statusPresentation[activeAnalysis.observedStatus] || statusPresentation.closed).color}>{(statusPresentation[activeAnalysis.observedStatus] || { label: activeAnalysis.observedStatus }).label}</Tag>
        </section>

        <Spin spinning={detailsLoading}>
          <section className={styles.analysisGrid}>
            <article><DollarOutlined /><span>Preço atual</span><strong>{formatCurrency(details?.currentPrice ?? activeAnalysis.price)}</strong><small className={(details?.currentProfit ?? activeAnalysis.profit ?? 0) >= 0 ? styles.positive : styles.negative}>Lucro {details ? formatCurrency(details.currentProfit) : activeAnalysis.profit === null ? 'indisponível' : formatCurrency(activeAnalysis.profit)}</small></article>
            <article><ShopOutlined /><span>Catálogo / Buy Box</span><strong>{catalogPresentation[activeAnalysis.catalogStatus].label}</strong><small>{(details?.catalog?.priceToWin ?? activeAnalysis.priceToWin) ? `Preço para ganhar ${formatCurrency(details?.catalog?.priceToWin ?? activeAnalysis.priceToWin ?? 0)}` : 'Sem preço-alvo disponível'}</small></article>
            <article><BarChartOutlined /><span>Desempenho</span><strong>{formatInteger(activeAnalysis.sold)} vendidos</strong><small>{formatInteger(activeAnalysis.visits)} visitas acumuladas</small></article>
            <article><CheckCircleOutlined /><span>Qualidade</span><strong>{activeAnalysis.qualityAvailable ? `${activeAnalysis.qualityScore}%` : 'Sem leitura'}</strong><small>{activeAnalysis.qualityPrimaryIssue || 'Nenhuma melhoria prioritária'}</small></article>
          </section>

          <section className={styles.drawerSection}><div className={styles.sectionHeading}><div><span>Preço e rentabilidade</span><strong>Um preço para os anúncios vinculados</strong></div></div>
            {details?.automaticPricing?.active && <Alert type="warning" showIcon message="Preço automático ativo no Mercado Livre" description="A edição manual está bloqueada para evitar uma rejeição do provedor. Desative a automação no Mercado Livre antes de alterar aqui." />}
            <div className={styles.priceEditor}><div><label>Novo preço de venda</label><InputNumber value={newPrice} onChange={(value) => setNewPrice(value ?? null)} min={0.01} precision={2} prefix="R$" disabled={!details || details.automaticPricing?.active || Boolean(visualReview)} /></div><div><label>Novo lucro unitário</label><strong className={(nextProfit || 0) >= 0 ? styles.positive : styles.negative}>{nextProfit === null ? '—' : formatCurrency(nextProfit)}</strong></div>{details?.catalog?.priceToWin && <Button onClick={() => setNewPrice(details.catalog?.priceToWin || null)}>Usar preço para ganhar</Button>}<Button type="primary" loading={savingPrice} disabled={!details || details.automaticPricing?.active || Boolean(visualReview)} onClick={() => void savePrice()}>Aplicar nos anúncios</Button></div>
            <small className={styles.scopeNotice}>O mesmo preço será aplicado ao anúncio padrão e ao anúncio de catálogo ativos ou pausados vinculados a este produto. O resultado aparece separadamente por item.</small>
            {priceResults.length > 0 && <div className={styles.resultList}>{priceResults.map((result) => <div key={result.mlItemId}><span className={styles.typeMark}>{result.type === 'catalog' ? 'CATÁLOGO' : 'PADRÃO'}</span><strong>{result.mlItemId}</strong><span>{result.trackingStatus === 'pending' || result.trackingStatus === 'processing' || result.trackingStatus === 'retry' ? 'Publicação em processamento' : result.success ? 'Preço processado' : 'Falhou'}</span>{result.trackingError && <small className={styles.negative}>{result.trackingError}</small>}{[...result.warnings, ...result.errors].map((notice, index) => <small key={`${result.mlItemId}-${index}`}>{notice}</small>)}</div>)}</div>}
            {details?.quantityPricing?.length ? <div className={styles.wholesale}><span>Atacado atual</span>{details.quantityPricing.map((tier) => <small key={`${tier.min_purchase_unit}-${tier.amount}`}>{tier.min_purchase_unit}+ unidades · {tier.pricing_model === 'percentage' ? `${tier.discount_percent}% de desconto` : formatCurrency(tier.amount)}</small>)}</div> : null}
          </section>

          <section className={styles.drawerSection}><div className={styles.sectionHeading}><div><span>Qualidade e performance</span><strong>O que priorizar neste anúncio</strong></div></div>{activeAnalysis.qualityAvailable ? <><Progress percent={Number(activeAnalysis.qualityScore || 0)} strokeColor="#ffbd0e" trailColor="rgba(255,255,255,.08)" /><div className={styles.qualityItems}>{qualityItems.length > 0 ? qualityItems.map((item: any, index: number) => <div key={`${item.nome}-${index}`}><span>{item.ok ? <CheckCircleOutlined className={styles.positive} /> : <WarningOutlined className={styles.warning} />}{item.nome || 'Critério do anúncio'}</span><small>{item.pontos ?? 0}/{item.max ?? 0} pontos</small></div>) : <Text type="secondary">Nenhum detalhamento adicional sincronizado.</Text>}</div></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="O Mercado Livre ainda não forneceu uma leitura de performance para este anúncio" />}</section>

          <section className={styles.drawerSection}><div className={styles.sectionHeading}><div><span>Publicação e vínculo</span><strong>Estado observado e operação local</strong></div></div><Descriptions column={2} size="small" items={[{ key: 'item', label: 'Item ML', children: activeAnalysis.itemId }, { key: 'type', label: 'Tipo', children: activeAnalysis.listingType === 'catalog' ? 'Catálogo' : 'Padrão' }, { key: 'operational', label: 'Operacional', children: activeAnalysis.isOperational ? 'Sim' : 'Não' }, { key: 'catalogProduct', label: 'Produto catálogo', children: activeAnalysis.catalogProductId || 'Não informado' }, { key: 'related', label: 'Anúncio relacionado', children: activeAnalysis.relatedItemId || 'Não informado' }, { key: 'sync', label: 'Última leitura', children: formatDateTime(activeAnalysis.listingSyncedAt) }]} />{(activeAnalysis.blockReason || activeAnalysis.lastError) && <Alert type="error" showIcon message="Publicação bloqueada" description={activeAnalysis.lastError || activeAnalysis.blockReason} />}</section>
        </Spin>
      </div>}
    </Drawer>

    <Drawer open={batchOpen} onClose={() => !batchTarget && setBatchOpen(false)} width="min(94vw, 720px)" title="Resultado da alteração de status"><div className={styles.drawerContent}>{batchTarget && <Alert type="info" showIcon message={`Enviando alteração para ${batchTarget}`} />}{!batchTarget && batchResults.length === 0 ? <Empty description="Nenhum resultado disponível" /> : <div className={styles.batchList}>{batchResults.map((result, index) => <div key={`${result.produtoId}-${index}`}><span>{result.sku || 'Produto não identificado'}</span><strong>{result.mlItemId || 'Sem item operacional'}</strong><Tag color={result.outcome === 'queued' || result.outcome === 'already_target' ? 'success' : result.outcome === 'failed' ? 'error' : 'warning'}>{batchOutcomeLabel(result.outcome)}</Tag>{result.error && <small>{result.error}</small>}</div>)}</div>}</div></Drawer>

    <ProgressModal {...progressModalProps} />
  </div>;
}
