'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert, Button, Drawer, Empty, Image, Input, InputNumber, Modal, Progress,
  Segmented, Select, Space, Spin, Tag, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowRightOutlined, EyeOutlined, FilePdfOutlined, LoadingOutlined,
  ReloadOutlined, SearchOutlined, ShopOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import ProgressModal, { type ProgressStep } from '@/components/modals/ProgressModal';
import { useMlPricePublishTracking } from '@/hooks/useMlPricePublishTracking';
import { formatCurrency } from '@/lib/format';
import {
  buildCatalogOptinTargets, catalogBoostPresentation, catalogCompetitionPresentation,
  type CatalogEligibilityActionState, type CatalogOperationalState,
  type CatalogOperationalView, type CatalogOptinTarget, type CatalogVariationEligibility,
} from '@/lib/catalogo/dashboard';
import type { CatalogRefreshPresentation } from '@/lib/catalogo/refresh-presentation';
import { userSafeMessage } from '@/lib/user-feedback';
import styles from './CatalogoView.module.css';

const { Text, Title } = Typography;
const PAGE_SIZE = 100;
const REFRESH_JOB_STORAGE_KEY = 'catalogo_no_catalogo_refresh_job_id';
export type CatalogoMode = 'no_catalogo' | 'elegiveis';

type VisualReviewMetadata = {
  enabled: true; source: string; capturedAt: string; expiresAt: string;
  itemCount: number; simulatedEligibility?: boolean;
};
type EconomicSummary = {
  profit: number | null; marginPercent: number | null;
  source: 'live_saved' | 'estimated' | 'unavailable'; calculatedAt: string | null;
};
type NoCatalogoRow = {
  anuncio_id: string; ml_item_id: string; relacionado_id: string | null;
  related_permalink?: string | null; related_status?: string | null; title: string;
  seller_sku: string | null; sku_local: string | null; produto_id: string | null;
  produto_nome?: string | null; catalog_product_id: string | null; status: string | null;
  buy_box_status: string | null; price_to_win: number | null; price: number;
  permalink: string | null; thumbnail: string | null; last_updated: string | null;
  operational: CatalogOperationalState;
  economics: { current: EconomicSummary; competitive: EconomicSummary };
  isHomologationFixture?: boolean;
};
type ElegivelRow = {
  ml_item_id: string; title: string; seller_sku: string | null;
  local_product_id?: string | null; local_product_name?: string | null;
  status: string | null; price: number; permalink: string | null; thumbnail: string | null;
  catalog_product_id: string | null; catalog_product_name?: string | null;
  catalog_product_id_sugerido?: string | null; catalog_product_name_sugerido?: string | null;
  catalog_product_warning?: string | null; eligibility_label?: string | null;
  variation_eligibility: CatalogVariationEligibility[]; state: CatalogEligibilityActionState;
  reason: string; isHomologationFixture?: boolean;
};
type CatalogMetrics = { total: number; needsAction: number; healthy: number };
type EligibleMetrics = {
  total: number; ready: number; reviewRequired: number;
  catalogProductUnavailable: number; localProductMissing: number;
};
type RefreshStatusPayload = {
  success?: boolean; error?: string;
  job?: { id: string; status: string; progresso?: number; processados?: number; total?: number;
    presentation?: CatalogRefreshPresentation } | null;
};
type PriceDetail = {
  evaluationId?: string;
  decisionContext?: { executable?: boolean; reasons?: string[]; priceCents?: number; groupId?: string | null } | null;
  currentPrice?: number | null; currentProfit?: number | null;
  pricing?: { current?: { memory?: { resultCents?: number; margin?: number } | null } };
  competitiveAssessment?: {
    current?: { memory?: { resultCents?: number; margin?: number } | null } | null;
    competitive?: { memory?: { resultCents?: number; margin?: number } | null } | null;
  } | null;
  automaticPricing?: { active?: boolean };
  catalog?: { rawStatus?: string | null; priceToWin?: number | null;
    winner?: { itemId?: string | null; price?: number | null } | null;
    boosts?: Array<{ id: string; status: string; description: string }>;
    reasons?: string[]; warning?: string | null; syncedAt?: string | null } | null;
};
type PriceReview = { detail: PriceDetail; price: number; profit: number | null; margin: number | null };

const statusOptions = [
  { value: 'all', label: 'Todos os status' }, { value: 'active', label: 'Ativos' },
  { value: 'paused', label: 'Pausados' }, { value: 'closed', label: 'Encerrados' },
];
const competitionOptions = [
  { value: 'all', label: 'Toda competição' }, { value: 'winning', label: 'Ganhando' },
  { value: 'sharing_first_place', label: 'Dividindo 1º lugar' }, { value: 'competing', label: 'Competindo' },
  { value: 'outside', label: 'Fora da competição' },
];
const eligibilityOptions = [
  { value: 'all', label: 'Todas as situações' }, { value: 'ready', label: 'Prontos para criar' },
  { value: 'review_required', label: 'Revisão necessária' },
  { value: 'catalog_product_unavailable', label: 'Produto indisponível' },
  { value: 'local_product_missing', label: 'Sem vínculo Bentevi' },
];

function eligibilityPresentation(state: CatalogEligibilityActionState) {
  if (state === 'ready') return { label: 'Pronto para criar', color: 'green', action: 'Criar anúncio' };
  if (state === 'review_required') return { label: 'Revisão necessária', color: 'orange', action: 'Ver o que revisar' };
  if (state === 'catalog_product_unavailable') return { label: 'Produto indisponível', color: 'red', action: 'Ver impedimento' };
  return { label: 'Sem vínculo Bentevi', color: 'default', action: 'Ver vínculo' };
}
function variationEligibilityLabel(status: unknown) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'READY_FOR_OPTIN') return 'Pronta para criar';
  if (value === 'ALREADY_IN_CATALOG') return 'Já possui anúncio de catálogo';
  if (value === 'NOT_ELIGIBLE') return 'Não elegível';
  return 'Situação não informada';
}
function boostLabel(boost: { id: string; description: string }) {
  if (boost.description?.trim()) return userSafeMessage(boost.description, 'Condição comercial');
  const labels: Record<string, string> = {
    fulfillment: 'Envio Full', free_shipping: 'Frete grátis',
    free_installments: 'Pagamento sem juros', same_day_shipping: 'Envio no mesmo dia', collect: 'Envios com coleta',
  };
  return labels[boost.id.toLowerCase()] || 'Condição comercial';
}
function formatDate(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não informado';
}
function priceMemory(detail: PriceDetail | null | undefined) {
  const memory = detail?.pricing?.current?.memory;
  return {
    profit: Number.isFinite(Number(memory?.resultCents)) ? Number(memory?.resultCents) / 100 : null,
    margin: Number.isFinite(Number(memory?.margin)) ? Number(memory?.margin) * 100 : null,
  };
}
function memoryEconomy(memory: { resultCents?: number; margin?: number } | null | undefined): EconomicSummary | null {
  if (memory?.resultCents == null || memory.margin == null
    || !Number.isFinite(Number(memory.resultCents)) || !Number.isFinite(Number(memory.margin))) return null;
  return { profit: Number(memory.resultCents) / 100, marginPercent: Number(memory.margin) * 100,
    source: 'live_saved', calculatedAt: null };
}
function decisionBlockMessage(reasons: string[] = []) {
  if (reasons.includes('PRECO_AUTOMATICO_ML')) return 'O Mercado Livre controla automaticamente o preço deste anúncio.';
  if (reasons.includes('PRECO_ABAIXO_DO_PISO')) return 'O novo preço ficaria abaixo do limite de margem permitido.';
  if (reasons.includes('PRECO_JA_APLICADO')) return 'Este preço já está aplicado.';
  if (reasons.includes('OPERACAO_EM_ANDAMENTO')) return 'Já existe uma alteração de preço em andamento.';
  if (reasons.includes('GRUPO_NAO_CONFIRMADO')) return 'O vínculo dos anúncios precisa ser confirmado antes de alterar o preço.';
  if (reasons.includes('IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA')) return 'A identidade do anúncio ainda não pôde ser confirmada.';
  return 'As informações atuais não permitem confirmar esta alteração com segurança.';
}

export default function CatalogoView({ mode }: { mode: CatalogoMode }) {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const [modalApi, modalContext] = Modal.useModal();
  const { hasOpenTracking, startTracking, progressModalProps } = useMlPricePublishTracking(messageApi);
  const requestSequence = useRef(0);
  const pricingRequest = useRef(0);
  const dataAbortController = useRef<AbortController | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceRetry = useRef<() => void>(() => undefined);
  const batchCancelled = useRef(false);
  const batchAbort = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<NoCatalogoRow[]>([]);
  const [eligibleRows, setEligibleRows] = useState<ElegivelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusMl, setStatusMl] = useState('all');
  const [competition, setCompetition] = useState('all');
  const [operationalView, setOperationalView] = useState<CatalogOperationalView>('needs_action');
  const [actionState, setActionState] = useState('all');
  const [sortBy, setSortBy] = useState('ml_item_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [catalogMetrics, setCatalogMetrics] = useState<CatalogMetrics>({ total: 0, needsAction: 0, healthy: 0 });
  const [eligibleMetrics, setEligibleMetrics] = useState<EligibleMetrics>({
    total: 0, ready: 0, reviewRequired: 0, catalogProductUnavailable: 0, localProductMissing: 0,
  });
  const [createEnabled, setCreateEnabled] = useState(false);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [refreshPayload, setRefreshPayload] = useState<RefreshStatusPayload | null>(null);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [activeCatalog, setActiveCatalog] = useState<NoCatalogoRow | null>(null);
  const [activeEligible, setActiveEligible] = useState<ElegivelRow | null>(null);
  const [priceDetail, setPriceDetail] = useState<PriceDetail | null>(null);
  const [priceDetailLoading, setPriceDetailLoading] = useState(false);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [priceReview, setPriceReview] = useState<PriceReview | null>(null);
  const [reviewingPrice, setReviewingPrice] = useState(false);
  const [confirmingPrice, setConfirmingPrice] = useState(false);

  const [selectedEligibleKeys, setSelectedEligibleKeys] = useState<React.Key[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSteps, setBatchSteps] = useState<ProgressStep[]>([]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search.trim()) params.set('search', search.trim());
    if (statusMl !== 'all') params.set('statusMl', statusMl);
    if (mode === 'no_catalogo') {
      params.set('view', operationalView);
      if (competition !== 'all') params.set('buyBox', competition);
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
    } else if (actionState !== 'all') params.set('actionState', actionState);
    return params.toString();
  }, [actionState, competition, mode, operationalView, page, search, sortBy, sortOrder, statusMl]);

  const fetchData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    dataAbortController.current?.abort();
    const controller = new AbortController();
    dataAbortController.current = controller;
    setLoadError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'no_catalogo' ? '/api/catalogo/no-catalogo' : '/api/catalogo/elegiveis';
      const response = await fetch(`${endpoint}?${queryString}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(payload?.erro || 'Falha ao carregar o catálogo.');
      setTotal(Number(payload.total || 0));
      setVisualReview(payload?.visualReview?.enabled === true ? payload.visualReview : null);
      if (mode === 'no_catalogo') {
        setRows(Array.isArray(payload.data) ? payload.data : []);
        setCatalogMetrics({ total: Number(payload.metrics?.total || 0),
          needsAction: Number(payload.metrics?.needsAction || 0), healthy: Number(payload.metrics?.healthy || 0) });
        setLastSyncedAt(payload.lastSyncedAt || null);
      } else {
        setEligibleRows(Array.isArray(payload.data) ? payload.data : []);
        setEligibleMetrics({ total: Number(payload.metrics?.total || 0), ready: Number(payload.metrics?.ready || 0),
          reviewRequired: Number(payload.metrics?.reviewRequired || 0),
          catalogProductUnavailable: Number(payload.metrics?.catalogProductUnavailable || 0),
          localProductMissing: Number(payload.metrics?.localProductMissing || 0) });
        setCreateEnabled(payload.capabilities?.createCatalogListing === true);
        setSelectedEligibleKeys([]);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (sequence === requestSequence.current) setLoadError(userSafeMessage(
        error instanceof Error ? error.message : null, 'Não foi possível carregar o catálogo. Tente novamente.'));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        if (dataAbortController.current === controller) dataAbortController.current = null;
      }
    }
  }, [mode, queryString]);

  useEffect(() => { void fetchData(); return () => dataAbortController.current?.abort(); }, [fetchData]);
  useEffect(() => setPage(1), [actionState, competition, mode, operationalView, search, statusMl]);

  const fetchRefreshStatus = useCallback(async (jobId?: string) => {
    const url = jobId ? `/api/catalogo/no-catalogo/refresh/status?jobId=${encodeURIComponent(jobId)}`
      : '/api/catalogo/no-catalogo/refresh/status';
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Não foi possível consultar a atualização.');
    return payload as RefreshStatusPayload;
  }, []);
  const stopRefreshPolling = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    if (typeof window !== 'undefined') window.localStorage.removeItem(REFRESH_JOB_STORAGE_KEY);
  }, []);
  const pollRefresh = useCallback(async function poll(jobId: string) {
    try {
      const payload = await fetchRefreshStatus(jobId);
      const status = String(payload.job?.status || '');
      if (['pendente', 'rodando', 'on_hold'].includes(status)) {
        setRefreshPayload(payload); setRefreshRunning(true);
        refreshTimer.current = setTimeout(() => void poll(jobId), 2500); return;
      }
      stopRefreshPolling(); setRefreshRunning(false);
      if (status === 'completo') {
        setRefreshPayload(null); messageApi.success('Catálogo atualizado.'); await fetchData(); return;
      }
      setRefreshPayload(payload);
      if (status === 'completo_parcial') {
        messageApi.warning('Catálogo atualizado com algumas informações indisponíveis.'); await fetchData();
      } else if (['erro', 'failed_auth', 'cancelado'].includes(status)) {
        messageApi.error(payload.job?.presentation?.description || 'Não foi possível atualizar o catálogo.');
      }
    } catch {
      stopRefreshPolling(); setRefreshRunning(false); messageApi.error('Não foi possível acompanhar a atualização.');
    }
  }, [fetchData, fetchRefreshStatus, messageApi, stopRefreshPolling]);
  const trackRefresh = useCallback((jobId: string) => {
    stopRefreshPolling(); setRefreshRunning(true);
    if (typeof window !== 'undefined') window.localStorage.setItem(REFRESH_JOB_STORAGE_KEY, jobId);
    void pollRefresh(jobId);
  }, [pollRefresh, stopRefreshPolling]);
  useEffect(() => {
    if (mode !== 'no_catalogo') return;
    const persisted = typeof window !== 'undefined' ? window.localStorage.getItem(REFRESH_JOB_STORAGE_KEY) : null;
    void (async () => {
      try {
        const payload = await fetchRefreshStatus(persisted || undefined);
        const status = String(payload.job?.status || '');
        if (!payload.job?.id) return;
        if (['pendente', 'rodando', 'on_hold'].includes(status)) trackRefresh(payload.job.id);
        else if (status !== 'completo') setRefreshPayload(payload);
      } catch { /* a ausência de um job anterior não impede a consulta */ }
    })();
    return stopRefreshPolling;
  }, [fetchRefreshStatus, mode, stopRefreshPolling, trackRefresh]);
  const startRefresh = useCallback(async () => {
    if (visualReview) return void messageApi.info('A amostra protegida não executa sincronizações externas.');
    const response = await fetch('/api/catalogo/no-catalogo/refresh/job', { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.jobId) return void messageApi.error('Não foi possível iniciar a atualização.');
    setRefreshPayload(null); trackRefresh(String(payload.jobId));
  }, [messageApi, trackRefresh, visualReview]);

  const loadPriceDetail = useCallback(async (row: NoCatalogoRow) => {
    const requestId = ++pricingRequest.current;
    setActiveCatalog(row); setPriceDetail(null); setPriceReview(null);
    setNewPrice(row.price);
    if (visualReview || !row.produto_id) return;
    setPriceDetailLoading(true);
    try {
      const params = new URLSearchParams({ produtoId: row.produto_id, mlItemId: row.ml_item_id });
      const response = await fetch(`/api/ml/anuncio/preco-detalhe?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar os detalhes.');
      if (requestId !== pricingRequest.current) return;
      setPriceDetail(payload); setNewPrice(payload?.currentPrice || row.price);
      const current = memoryEconomy(payload?.competitiveAssessment?.current?.memory);
      const competitive = memoryEconomy(payload?.competitiveAssessment?.competitive?.memory);
      if (current || competitive) setRows((existing) => existing.map((entry) => entry.ml_item_id === row.ml_item_id
        ? { ...entry, economics: { current: current || entry.economics.current,
          competitive: competitive || entry.economics.competitive } }
        : entry));
    } catch (error: unknown) {
      if (requestId === pricingRequest.current) messageApi.error(userSafeMessage(
        error instanceof Error ? error.message : null, 'Não foi possível carregar os detalhes.'));
    } finally { if (requestId === pricingRequest.current) setPriceDetailLoading(false); }
  }, [messageApi, visualReview]);

  const reviewPrice = useCallback(async () => {
    if (!activeCatalog?.produto_id || !newPrice || visualReview) return;
    if (Math.round(newPrice * 100) === Math.round((priceDetail?.currentPrice ?? activeCatalog.price) * 100)) {
      messageApi.info('Informe um preço diferente do atual.'); return;
    }
    setReviewingPrice(true);
    try {
      const response = await fetch('/api/ml/anuncio/preco-detalhe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: activeCatalog.produto_id, mlItemId: activeCatalog.ml_item_id,
          priceCents: Math.round(newPrice * 100) }),
      });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail?.error || 'Não foi possível revisar este preço.');
      const memory = priceMemory(detail);
      setPriceReview({ detail, price: newPrice, profit: memory.profit, margin: memory.margin });
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível revisar este preço.'));
    } finally { setReviewingPrice(false); }
  }, [activeCatalog, messageApi, newPrice, priceDetail?.currentPrice, visualReview]);

  const confirmPrice = useCallback(async () => {
    if (!activeCatalog?.produto_id || !priceReview?.detail.evaluationId) return;
    if (hasOpenTracking) return void messageApi.warning('Já existe uma publicação de preço em acompanhamento.');
    setConfirmingPrice(true);
    try {
      const response = await fetch('/api/catalogo/preco/confirmar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId: priceReview.detail.evaluationId,
          prepareCommandId: crypto.randomUUID(), approveCommandId: crypto.randomUUID(), operationId: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível confirmar a alteração.');
      const outboxId = String(payload?.outboxId || '').trim();
      if (!outboxId) throw new Error('A alteração não foi programada.');
      setPriceReview(null);
      startTracking({ outboxId, produtoId: activeCatalog.produto_id, retry: () => priceRetry.current(),
        onTerminal: (status) => { if (status.status === 'done') { void fetchData(); setActiveCatalog(null); } } });
      messageApi.success('Alteração programada para envio ao Mercado Livre.');
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível confirmar a alteração.'));
    } finally { setConfirmingPrice(false); }
  }, [activeCatalog, fetchData, hasOpenTracking, messageApi, priceReview, startTracking]);
  priceRetry.current = () => void confirmPrice();

  const executeOptinTargets = useCallback(async (targets: CatalogOptinTarget[]) => {
    if (!targets.length || visualReview || !createEnabled) return;
    batchCancelled.current = false; setBatchRunning(true); setBatchOpen(true);
    setBatchSteps(targets.map((target) => ({ label: target.variationId ? `Variação ${target.variationId}` : `Anúncio ${target.itemId}`,
      status: 'pending', detail: `Produto de catálogo ${target.catalogProductId}` })));
    let successes = 0;
    for (let index = 0; index < targets.length; index += 1) {
      if (batchCancelled.current) break;
      const target = targets[index];
      setBatchSteps((current) => current.map((step, i) => i === index ? { ...step, status: 'loading' } : step));
      const controller = new AbortController(); batchAbort.current = controller;
      try {
        const response = await fetch('/api/catalogo/optin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target), signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.erro || 'Falha ao criar o anúncio.');
        successes += 1;
        setBatchSteps((current) => current.map((step, i) => i === index
          ? { ...step, status: 'success', detail: `Criado: ${payload?.catalog_item_id || payload?.data?.id || 'confirmado'}` } : step));
      } catch (error: unknown) {
        const cancelled = batchCancelled.current || (error instanceof Error && error.name === 'AbortError');
        setBatchSteps((current) => current.map((step, i) => i === index ? { ...step,
          status: cancelled ? 'warning' : 'error', detail: cancelled ? 'Cancelado.' : step.detail,
          error: cancelled ? undefined : userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível criar este anúncio.') } : step));
        if (cancelled) break;
      }
    }
    setBatchRunning(false); setSelectedEligibleKeys([]); batchAbort.current = null;
    if (successes) { messageApi.success(`${successes} anúncio(s) de catálogo criado(s).`); void fetchData(); }
  }, [createEnabled, fetchData, messageApi, visualReview]);
  const confirmOptin = useCallback((selected: ElegivelRow[]) => {
    const targets = selected.flatMap((row) => buildCatalogOptinTargets(row));
    if (!createEnabled || !targets.length) return;
    modalApi.confirm({ title: targets.length === 1 ? 'Criar anúncio de catálogo?' : `Criar ${targets.length} anúncios de catálogo?`,
      content: 'O anúncio padrão será mantido. Cada variação elegível gera uma publicação de catálogo separada.',
      okText: 'Confirmar criação', cancelText: 'Cancelar', onOk: () => executeOptinTargets(targets) });
  }, [createEnabled, executeOptinTargets, modalApi]);
  const selectedEligibleRows = useMemo(() => {
    const selected = new Set(selectedEligibleKeys.map(String));
    return eligibleRows.filter((row) => selected.has(row.ml_item_id));
  }, [eligibleRows, selectedEligibleKeys]);

  const catalogColumns: TableProps<NoCatalogoRow>['columns'] = useMemo(() => [
    { title: 'Produto e anúncio', key: 'listing', width: 340, sorter: true, render: (_, row) => (
      <div className={styles.listingCell}>
        {row.thumbnail ? <Image src={row.thumbnail} alt="" width={48} height={48} preview={false} className={styles.thumbnail} />
          : <span className={styles.thumbnailFallback}><ShopOutlined /></span>}
        <div><strong>{row.produto_nome || row.title || 'Produto não identificado'}</strong><span>{row.title}</span>
          <small>SKU {row.sku_local || 'não informado'} · {row.ml_item_id}</small></div>
      </div>) },
    { title: 'Situação', key: 'situation', width: 230, render: (_, row) => (
      <div className={styles.situationCell}><span className={`${styles.statusDot} ${styles[row.operational.tone]}`} />
        <div><strong>{row.operational.label}</strong><small>{row.operational.description}</small></div></div>) },
    { title: 'Preço atual', key: 'price', width: 170, sorter: true,
      render: (_, row) => <PriceResult price={row.price} economy={row.economics.current} /> },
    { title: 'Preço para ganhar', key: 'competition', width: 190, sorter: true,
      render: (_, row) => row.price_to_win && row.price_to_win > 0
        ? <PriceResult price={row.price_to_win} economy={row.economics.competitive} />
        : <div className={styles.valueCell}><strong>Não informado</strong><small>Atualize para consultar</small></div> },
    { title: 'Próxima ação', key: 'action', width: 180, fixed: 'right', render: (_, row) => (
      <Button type={row.operational.needsAction ? 'primary' : 'default'} icon={<ArrowRightOutlined />}
        onClick={() => void loadPriceDetail(row)}>{row.operational.actionLabel}</Button>) },
  ], [loadPriceDetail]);
  const eligibleColumns: TableProps<ElegivelRow>['columns'] = useMemo(() => [
    { title: 'Produto e anúncio padrão', key: 'listing', width: 390, render: (_, row) => (
      <div className={styles.listingCell}>
        {row.thumbnail ? <Image src={row.thumbnail} alt="" width={48} height={48} preview={false} className={styles.thumbnail} />
          : <span className={styles.thumbnailFallback}><ShopOutlined /></span>}
        <div><strong>{row.local_product_name || row.title || 'Produto não identificado'}</strong><span>{row.title}</span>
          <small>SKU {row.seller_sku || 'não informado'} · {row.ml_item_id}</small></div>
      </div>) },
    { title: 'Situação', key: 'eligibility', width: 280, render: (_, row) => {
      const presentation = eligibilityPresentation(row.state);
      return <div className={styles.stackCell}><Tag color={presentation.color}>{presentation.label}</Tag>
        <small>{userSafeMessage(row.reason, 'Confira o vínculo antes de continuar.')}</small></div>;
    } },
    { title: 'Produto de catálogo', key: 'catalogProduct', width: 280, render: (_, row) => (
      <div className={styles.stackCell}><strong>{row.catalog_product_name_sugerido || row.catalog_product_name || 'Não identificado'}</strong>
        <small>{row.catalog_product_id_sugerido || row.catalog_product_id || 'Código não informado'}</small></div>) },
    { title: 'Próxima ação', key: 'action', width: 180, fixed: 'right', render: (_, row) => {
      const presentation = eligibilityPresentation(row.state);
      return <Button type={row.state === 'ready' && createEnabled ? 'primary' : 'default'} icon={<EyeOutlined />}
        onClick={() => setActiveEligible(row)}>{row.state === 'ready' && !createEnabled ? 'Ver detalhes' : presentation.action}</Button>;
    } },
  ], [createEnabled]);
  const handleCatalogTableChange: TableProps<NoCatalogoRow>['onChange'] = (pagination, _filters, sorter) => {
    setPage(Number(pagination.current || 1));
    const current = Array.isArray(sorter) ? sorter[0] : sorter;
    if (!current?.order) return;
    const mapping: Record<string, string> = { listing: 'ml_item_id', competition: 'price_to_win', price: 'price' };
    setSortBy(mapping[String(current.columnKey)] || 'ml_item_id');
    setSortOrder(current.order === 'ascend' ? 'asc' : 'desc');
  };
  const exportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const params = new URLSearchParams(queryString); params.delete('page'); params.delete('pageSize');
      const response = await fetch(`/api/catalogo/no-catalogo/exportar-pdf?${params}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), cache: 'no-store' });
      if (!response.ok) throw new Error(userSafeMessage((await response.json().catch(() => ({})))?.erro, 'Não foi possível gerar o PDF.'));
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      anchor.href = url; anchor.download = disposition.match(/filename="([^"]+)"/)?.[1] || 'catalogo-mercado-livre.pdf';
      anchor.click(); URL.revokeObjectURL(url);
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível gerar o PDF.'));
    } finally { setExportingPdf(false); }
  }, [messageApi, queryString]);

  const quickViews = mode === 'no_catalogo'
    ? [['needs_action', 'Pendências', catalogMetrics.needsAction], ['healthy', 'Tudo certo', catalogMetrics.healthy],
      ['all', 'Todos', catalogMetrics.total]] as const
    : [['all', 'Todos', eligibleMetrics.total], ['ready', 'Prontos', eligibleMetrics.ready],
      ['review_required', 'Revisar', eligibleMetrics.reviewRequired],
      ['catalog_product_unavailable', 'Indisponíveis', eligibleMetrics.catalogProductUnavailable],
      ['local_product_missing', 'Sem vínculo', eligibleMetrics.localProductMissing]] as const;
  const currentEconomy = memoryEconomy(priceDetail?.competitiveAssessment?.current?.memory)
    || memoryEconomy(priceDetail?.pricing?.current?.memory) || activeCatalog?.economics.current;
  const competitiveEconomy = memoryEconomy(priceDetail?.competitiveAssessment?.competitive?.memory)
    || activeCatalog?.economics.competitive;
  const detailCompetition = activeCatalog
    ? catalogCompetitionPresentation(priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status) : null;
  const actionableBoosts = (priceDetail?.catalog?.boosts || []).filter((boost) => catalogBoostPresentation(boost.status).actionable);

  return <div className={styles.page}>
    {messageContext}{modalContext}
    <header className={styles.header}><div><Title level={2} className={styles.title}>Catálogo</Title>
      <Text type="secondary">Veja primeiro o que precisa de ação e resolva sem sair da lista.</Text>
      {mode === 'no_catalogo' && <small className={styles.lastSync}>Dados consultados em {formatDate(lastSyncedAt)}</small>}</div>
      <Space wrap>{mode === 'no_catalogo' && <Button icon={<FilePdfOutlined />} loading={exportingPdf}
        onClick={() => void exportPdf()}>Exportar PDF</Button>}
      {mode === 'no_catalogo' && <Button icon={<ReloadOutlined spin={refreshRunning} />} disabled={Boolean(visualReview)}
        loading={refreshRunning} onClick={() => void startRefresh()}>Atualizar dados</Button>}
      {mode === 'elegiveis' && createEnabled && <Button type="primary" disabled={!selectedEligibleRows.length || Boolean(visualReview)}
        onClick={() => confirmOptin(selectedEligibleRows)}>Criar selecionados ({selectedEligibleRows.length})</Button>}</Space></header>

    {visualReview && <Alert className={styles.visualAlert} type="warning" showIcon message="Amostra protegida, somente leitura"
      description="Os dados desta amostra servem apenas para avaliar a tela. Ações externas estão desabilitadas." />}

    <Segmented className={styles.modeSelector} value={mode} options={[
      { label: 'Anúncios de catálogo', value: 'no_catalogo' }, { label: 'Elegíveis ao catálogo', value: 'elegiveis' },
    ]} onChange={(value) => router.push(value === 'no_catalogo' ? '/catalogo/no-catalogo' : '/catalogo/elegiveis')} />

    {refreshPayload?.job && mode === 'no_catalogo' && <Alert className={styles.jobAlert}
      type={refreshPayload.job.presentation?.tone || (refreshRunning ? 'info' : 'warning')} showIcon
      message={refreshPayload.job.presentation?.title || 'Atualizando catálogo'} description={<div className={styles.refreshProgress}>
        <span>{refreshPayload.job.presentation?.description || 'Consultando os anúncios.'}</span>
        <Progress percent={Number(refreshPayload.job.progresso || 0)}
          status={refreshPayload.job.presentation?.tone === 'error' ? 'exception' : refreshRunning ? 'active' : 'normal'} size="small" />
      </div>} />}

    <Segmented className={styles.quickViews} value={mode === 'no_catalogo' ? operationalView : actionState}
      onChange={(value) => {
        if (mode === 'no_catalogo') { setOperationalView(value as CatalogOperationalView); setCompetition('all'); }
        else setActionState(String(value));
      }}
      options={quickViews.map(([value, label, count]) => ({ value,
        label: <span className={styles.quickViewLabel}>{label}<b>{count.toLocaleString('pt-BR')}</b></span> }))} />

    <section className={styles.filterBar}><Input className={styles.search} prefix={<SearchOutlined />}
      placeholder="Buscar produto, SKU ou anúncio" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select value={statusMl} options={statusOptions} onChange={setStatusMl} />
      <Select value={mode === 'no_catalogo' ? competition : actionState}
        options={mode === 'no_catalogo' ? competitionOptions : eligibilityOptions}
        onChange={(value) => {
          if (mode !== 'no_catalogo') return setActionState(value);
          setCompetition(value);
          if (value === 'winning' || value === 'sharing_first_place') setOperationalView('healthy');
          else if (value === 'competing' || value === 'outside') setOperationalView('needs_action');
        }} /></section>

    <section className={styles.tableCard}>
      {loadError && <Alert type="error" showIcon
        message={mode === 'elegiveis' ? 'Não foi possível carregar os anúncios elegíveis' : 'Não foi possível carregar o catálogo'}
        description={loadError} action={<Button loading={loading} onClick={() => void fetchData()}>Tentar novamente</Button>} />}
      <Spin spinning={loading} indicator={<LoadingOutlined className={styles.loadingIcon} spin />}>
        {loadError && (mode === 'no_catalogo' ? rows.length === 0 : eligibleRows.length === 0) ? null
          : !loading && total === 0 ? <Empty description="Nenhum anúncio encontrado com estes filtros" />
          : mode === 'no_catalogo' ? <ResizableTable<NoCatalogoRow> className={styles.table}
            storageKey="bnt-d12-catalog-listings-simple" rowKey="ml_item_id" dataSource={rows} columns={catalogColumns}
            onChange={handleCatalogTableChange} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false,
              showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} scroll={{ x: 1110 }} size="small" />
          : <ResizableTable<ElegivelRow> className={styles.table} storageKey="bnt-d12-catalog-eligible-simple"
            rowKey="ml_item_id" dataSource={eligibleRows} columns={eligibleColumns}
            rowSelection={createEnabled ? { selectedRowKeys: selectedEligibleKeys, onChange: setSelectedEligibleKeys,
              getCheckboxProps: (row) => ({ disabled: row.state !== 'ready' || Boolean(visualReview) }) } : undefined}
            pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage,
              showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} scroll={{ x: 1130 }} size="small" />}
      </Spin>
    </section>

    <Drawer open={Boolean(activeCatalog)} onClose={() => { pricingRequest.current += 1; setPriceDetailLoading(false);
      setPriceReview(null); setActiveCatalog(null); }} width="min(96vw, 720px)"
      title={activeCatalog ? <div className={styles.drawerTitle}><span>Resolver anúncio</span>
        <strong>{activeCatalog.produto_nome || activeCatalog.title}</strong></div> : undefined}
      extra={activeCatalog?.permalink && !visualReview ? <Button icon={<EyeOutlined />}
        onClick={() => window.open(activeCatalog.permalink || '', '_blank', 'noopener,noreferrer')}>Abrir no ML</Button> : null}>
      {activeCatalog && <Spin spinning={priceDetailLoading}><div className={styles.drawerSection}>
        <div className={`${styles.competitionHero} ${detailCompetition ? styles[detailCompetition.tone] : ''}`}>
          <span className={`${styles.statusDot} ${styles[activeCatalog.operational.tone]}`} />
          <div><small>Situação atual</small><strong>{activeCatalog.operational.label}</strong>
            <p>{activeCatalog.operational.description}</p></div></div>
        <div className={styles.priceOverview}><SummaryCard title="Preço atual"
          price={priceDetail?.currentPrice ?? activeCatalog.price} economy={currentEconomy} />
          <SummaryCard title="Preço para ganhar" price={priceDetail?.catalog?.priceToWin ?? activeCatalog.price_to_win}
            economy={competitiveEconomy} /></div>

        {actionableBoosts.length > 0 && <div className={styles.actionableBoosts}><strong>O que pode melhorar a disputa</strong>
          {actionableBoosts.map((boost) => <span key={boost.id}><b>{boostLabel(boost)}</b>
            <small>{catalogBoostPresentation(boost.status).label}</small></span>)}</div>}
        {priceDetail?.catalog?.reasons?.length ? <Alert type="warning" showIcon message="O Mercado Livre informou um impedimento"
          description={priceDetail.catalog.reasons.map((reason) => userSafeMessage(reason, 'Critério não informado.')).join(' · ')} /> : null}
        {priceDetail?.catalog?.warning && <Alert type="warning" showIcon
          message={userSafeMessage(priceDetail.catalog.warning, 'A competição está indisponível.')} />}

        <section className={styles.priceAction}><div><strong>Alterar preço</strong>
          <small>Confira o impacto antes de confirmar. Nada é alterado nesta etapa.</small></div>
          <div className={styles.priceEditor}><InputNumber prefix="R$" min={0.01} precision={2} value={newPrice}
            onChange={(value) => setNewPrice(value ?? null)}
            disabled={Boolean(visualReview) || !activeCatalog.produto_id || priceDetail?.automaticPricing?.active} />
            <Button type="primary" loading={reviewingPrice}
              disabled={Boolean(visualReview) || !activeCatalog.produto_id || !newPrice || priceDetail?.automaticPricing?.active}
              onClick={() => void reviewPrice()}>Revisar alteração</Button></div>
          {priceDetail?.automaticPricing?.active && <Text type="warning">O preço automático do Mercado Livre está ativo.</Text>}</section>

        <details className={styles.technicalDetails}><summary>Detalhes técnicos</summary><dl>
          <div><dt>Anúncio de catálogo</dt><dd>{activeCatalog.ml_item_id}</dd></div>
          <div><dt>Anúncio padrão</dt><dd>{activeCatalog.relacionado_id || 'Não localizado'}</dd></div>
          <div><dt>Produto de catálogo</dt><dd>{activeCatalog.catalog_product_id || 'Não informado'}</dd></div>
          <div><dt>SKU Bentevi</dt><dd>{activeCatalog.sku_local || 'Não informado'}</dd></div>
          <div><dt>Última consulta</dt><dd>{formatDate(priceDetail?.catalog?.syncedAt || activeCatalog.last_updated)}</dd></div>
        </dl>{(priceDetail?.catalog?.boosts || []).length > 0 && <div className={styles.allBoosts}>
          {(priceDetail?.catalog?.boosts || []).map((boost) => <span key={boost.id}><b>{boostLabel(boost)}</b>
            <small>{catalogBoostPresentation(boost.status).label}</small></span>)}</div>}</details>
      </div></Spin>}
    </Drawer>

    <Modal open={Boolean(priceReview)} title="Confirmar alteração de preço" okText="Confirmar alteração" cancelText="Voltar"
      confirmLoading={confirmingPrice} okButtonProps={{ disabled: priceReview?.detail.decisionContext?.executable !== true }}
      onCancel={() => setPriceReview(null)} onOk={() => void confirmPrice()}>
      {priceReview && activeCatalog && <div className={styles.priceReview}>
        <p>Revise o impacto unitário antes de enviar ao Mercado Livre.</p>
        <div className={styles.reviewComparison}><SummaryCard title="Preço atual"
          price={priceDetail?.currentPrice ?? activeCatalog.price} economy={currentEconomy} /><ArrowRightOutlined />
          <SummaryCard title="Novo preço" price={priceReview.price} economy={{ profit: priceReview.profit,
            marginPercent: priceReview.margin, source: priceReview.profit == null ? 'unavailable' : 'live_saved', calculatedAt: null }} /></div>
        {priceReview.detail.decisionContext?.executable !== true && <Alert type="warning" showIcon
          message="Esta alteração ainda não pode ser confirmada"
          description={decisionBlockMessage(priceReview.detail.decisionContext?.reasons)} />}
      </div>}
    </Modal>

    <Drawer open={Boolean(activeEligible)} onClose={() => setActiveEligible(null)} width="min(96vw, 660px)"
      title={activeEligible ? <div className={styles.drawerTitle}><span>Elegibilidade ao catálogo</span>
        <strong>{activeEligible.title}</strong></div> : undefined}>
      {activeEligible && <div className={styles.drawerSection}><Alert type={activeEligible.state === 'ready' ? 'success' : 'warning'}
        showIcon message={eligibilityPresentation(activeEligible.state).label}
        description={userSafeMessage(activeEligible.reason, 'Confira o vínculo antes de continuar.')} />
        <div className={styles.eligibleSummary}><span><small>Produto Bentevi</small>
          <strong>{activeEligible.local_product_name || 'Não vinculado'}</strong></span>
          <span><small>Produto de catálogo</small><strong>{activeEligible.catalog_product_name_sugerido
            || activeEligible.catalog_product_name || 'Não identificado'}</strong></span></div>
        {activeEligible.catalog_product_warning && <Alert type="warning" showIcon message="Compatibilidade precisa de atenção"
          description={userSafeMessage(activeEligible.catalog_product_warning, 'Confira o produto sugerido.')} />}
        {activeEligible.variation_eligibility?.length > 0 && <div className={styles.variationList}>
          {activeEligible.variation_eligibility.map((variation) => <span key={String(variation.id)}><b>Variação {variation.id}</b>
            <small>{variationEligibilityLabel(variation.status)}</small></span>)}</div>}
        {activeEligible.state === 'ready' && createEnabled && <Button type="primary" size="large"
          onClick={() => confirmOptin([activeEligible])}>Criar anúncio de catálogo</Button>}
        <details className={styles.technicalDetails}><summary>Detalhes técnicos</summary><dl>
          <div><dt>Anúncio padrão</dt><dd>{activeEligible.ml_item_id}</dd></div>
          <div><dt>Produto de catálogo</dt><dd>{activeEligible.catalog_product_id_sugerido
            || activeEligible.catalog_product_id || 'Não informado'}</dd></div>
          <div><dt>SKU</dt><dd>{activeEligible.seller_sku || 'Não informado'}</dd></div>
        </dl></details>
      </div>}
    </Drawer>

    <ProgressModal open={batchOpen} title="Criando anúncios de catálogo" steps={batchSteps}
      onClose={() => { if (!batchRunning) setBatchOpen(false); }} showCloseButton={!batchRunning}
      customActions={batchRunning ? [{ key: 'cancel', label: 'Cancelar', danger: true, onClick: () => {
        batchCancelled.current = true; batchAbort.current?.abort(); setBatchRunning(false);
      } }] : []} />
    <ProgressModal {...progressModalProps} />
  </div>;
}

function PriceResult({ price, economy }: { price: number; economy: EconomicSummary }) {
  return <div className={styles.valueCell}><strong>{formatCurrency(price)}</strong>
    {economy.profit == null || economy.marginPercent == null ? <small>Resultado não calculado</small>
      : <small className={economy.profit < 0 ? styles.negative : styles.positive}>
        {economy.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(economy.profit))} · {economy.marginPercent.toFixed(2)}%
      </small>}</div>;
}
function SummaryCard({ title, price, economy }: { title: string; price: number | null | undefined; economy?: EconomicSummary | null }) {
  return <div className={styles.summaryCard}><small>{title}</small>
    <strong>{price == null || !Number.isFinite(Number(price)) ? 'Não informado' : formatCurrency(Number(price))}</strong>
    {economy?.profit == null || economy.marginPercent == null ? <span>Resultado não calculado</span>
      : <span className={economy.profit < 0 ? styles.negative : styles.positive}>
        {economy.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(economy.profit))} · {economy.marginPercent.toFixed(2)}%
      </span>}
  </div>;
}
