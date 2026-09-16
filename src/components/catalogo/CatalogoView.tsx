'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert, Button, Drawer, Empty, Image, Input, InputNumber, Modal, Progress,
  Segmented, Select, Space, Spin, Tag, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowRightOutlined, ExportOutlined, EyeOutlined, FilePdfOutlined, LoadingOutlined,
  ReloadOutlined, SearchOutlined, ShopOutlined,
} from '@ant-design/icons';
import ResponsiveTable from '@/components/ResponsiveTable';
import ProgressModal, { type ProgressStep } from '@/components/modals/ProgressModal';
import { useMlPricePublishTracking } from '@/hooks/useMlPricePublishTracking';
import { formatCurrency } from '@/lib/format';
import {
  buildCatalogOptinTargets, catalogBoostPresentation, catalogCompetitionPresentation,
  catalogCompetitionReasonPresentation, catalogOperationalPresentation, catalogPriceToWinPresentation,
  type CatalogEligibilityActionState, type CatalogOperationalState, type CatalogPriceGuidance,
  type CatalogOperationalView, type CatalogOptinTarget, type CatalogVariationEligibility,
} from '@/lib/catalogo/dashboard';
import type { CatalogRefreshPresentation } from '@/lib/catalogo/refresh-presentation';
import { buildMercadoLivreCatalogProductUrl } from '@/lib/catalogo/no-catalogo';
import {
  CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE,
  catalogEconomicReasonLabel,
  catalogEconomicsCacheKey,
  unavailableCatalogEconomy,
  type CatalogEconomicReason,
  type CatalogEconomicSummary,
  type CatalogVisibleEconomicsResponse,
  type CatalogVisibleEconomicsRow,
} from '@/lib/catalogo/visible-economics';
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
type EconomicSummary = CatalogEconomicSummary;
type NoCatalogoRow = {
  anuncio_id: string; ml_item_id: string; relacionado_id: string | null;
  related_permalink?: string | null; related_status?: string | null; title: string;
  seller_sku: string | null; sku_local: string | null; produto_id: string | null;
  produto_nome?: string | null; catalog_product_id: string | null; status: string | null;
  buy_box_status: string | null; price_to_win: number | null; price: number;
  catalog_listing: boolean;
  permalink: string | null; thumbnail: string | null; last_updated: string | null;
  snapshot_synced_at: string | null;
  competition_reference?: { source: 'ml_live' | 'snapshot'; observedAt: string } | null;
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
  decisionContext?: { executable?: boolean; reasons?: string[]; warnings?: string[]; priceCents?: number;
    groupId?: string | null; disableAutomaticPricing?: boolean } | null;
  currentPrice?: number | null; currentProfit?: number | null;
  pricing?: { current?: { memory?: { resultCents?: number; margin?: number } | null } };
  competitiveAssessment?: {
    current?: { memory?: { resultCents?: number; margin?: number } | null } | null;
    competitive?: { memory?: { resultCents?: number; margin?: number } | null } | null;
  } | null;
  automaticPricing?: { active?: boolean };
  catalogListing?: boolean | null;
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
  { value: 'local_product_missing', label: 'Produto não identificado' },
];

function eligibilityPresentation(state: CatalogEligibilityActionState) {
  if (state === 'ready') return { label: 'Pronto para criar', color: 'green', action: 'Criar anúncio' };
  if (state === 'review_required') return { label: 'Revisão necessária', color: 'orange', action: 'Ver o que revisar' };
  if (state === 'catalog_product_unavailable') return { label: 'Produto indisponível', color: 'red', action: 'Ver impedimento' };
  return { label: 'Produto não identificado no Bentevi', color: 'default', action: 'Revisar produto' };
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
function MercadoLivreCodeLink({ code, href, label }: { code?: string | null; href?: string | null; label: string }) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return <>Não informado</>;
  if (!href) return <span title={`Link de ${label.toLowerCase()} indisponível`}>{normalizedCode}</span>;
  return <a className={styles.mlCodeLink} href={href} target="_blank" rel="noopener noreferrer"
    title={`Abrir ${label.toLowerCase()} no Mercado Livre`}>
    {normalizedCode}<ExportOutlined aria-hidden />
  </a>;
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
  return { status: 'available', profit: Number(memory.resultCents) / 100,
    marginPercent: Number(memory.margin) * 100, source: 'live_saved', calculatedAt: null, reason: null };
}
function decisionBlockMessage(reasons: string[] = []) {
  if (reasons.includes('OPERACAO_EM_ANDAMENTO')) return 'Já existe uma alteração de preço em andamento.';
  return 'As informações atuais não permitem confirmar esta alteração com segurança.';
}
function decisionWarningMessage(reason: string) {
  if (reason === 'PRECO_ABAIXO_DO_PISO') return 'O preço fica abaixo do piso de margem; a decisão manual será respeitada.';
  if (reason === 'PREJUIZO_PREVISTO') return 'A projeção indica prejuízo unitário.';
  if (reason === 'GRUPO_NAO_CONFIRMADO') return 'O vínculo dos anúncios não está confirmado; somente o item escolhido será exigido no read-back.';
  if (reason === 'IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA') return 'A identidade comercial ainda está pendente.';
  if (reason === 'ECONOMIA_INCONCLUSIVA') return 'Custo, tarifa, frete ou imposto não puderam ser concluídos.';
  if (reason === 'FONTES_EXPIRADAS') return 'Uma ou mais fontes econômicas estão desatualizadas.';
  if (reason === 'PRECO_JA_APLICADO') return 'O preço informado já aparece no anúncio.';
  if (reason === 'VARIACAO_REQUER_CONTRATO_DE_EXECUCAO') return 'O anúncio possui variações; a alteração será enviada ao item escolhido.';
  return 'Há uma informação pendente nesta análise.';
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
  const batchCancelled = useRef(false);
  const batchAbort = useRef<AbortController | null>(null);
  const economicsRequest = useRef(0);
  const economicsCache = useRef(new Map<string, { value: CatalogVisibleEconomicsRow; cachedAt: number }>());

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
  const [economicsRetry, setEconomicsRetry] = useState(0);
  const [economicsItems, setEconomicsItems] = useState<Array<{
    mlItemId: string; snapshotSyncedAt: string; cacheKey: string;
  }>>([]);
  const [economicsState, setEconomicsState] = useState<{
    running: boolean; processed: number; total: number;
    issue: Extract<CatalogEconomicReason, 'RATE_LIMITED' | 'AUTH_REQUIRED' | 'ML_UNAVAILABLE'> | null;
  }>({ running: false, processed: 0, total: 0, issue: null });

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
    setEconomicsItems([]);
    try {
      const endpoint = mode === 'no_catalogo' ? '/api/catalogo/no-catalogo' : '/api/catalogo/elegiveis';
      const response = await fetch(`${endpoint}?${queryString}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(payload?.erro || 'Falha ao carregar o catálogo.');
      setTotal(Number(payload.total || 0));
      setVisualReview(payload?.visualReview?.enabled === true ? payload.visualReview : null);
      if (mode === 'no_catalogo') {
        const nextRows = (Array.isArray(payload.data) ? payload.data : []) as NoCatalogoRow[];
        setRows(nextRows);
        setEconomicsItems(payload?.visualReview?.enabled === true ? [] : nextRows
          .filter(row => row.produto_id && row.snapshot_synced_at)
          .map(row => ({ mlItemId: row.ml_item_id, snapshotSyncedAt: row.snapshot_synced_at!,
            cacheKey: catalogEconomicsCacheKey(row) })));
        setCatalogMetrics({ total: Number(payload.metrics?.total || 0),
          needsAction: Number(payload.metrics?.needsAction || 0), healthy: Number(payload.metrics?.healthy || 0) });
        setLastSyncedAt(payload.lastSyncedAt || null);
      } else {
        setEconomicsItems([]);
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

  const applyVisibleEconomics = useCallback((values: CatalogVisibleEconomicsRow[]) => {
    if (!values.length) return;
    const byItem = new Map(values.map(value => [value.mlItemId, value]));
    setRows(existing => existing.map(row => {
      const value = byItem.get(row.ml_item_id);
      if (!value || row.snapshot_synced_at !== value.snapshotSyncedAt) return row;
      const next = {
        ...row,
        price: value.reference.currentSource === 'ml_live' ? value.reference.currentPrice : row.price,
        price_to_win: value.reference.competitionSource === 'ml_live'
          ? value.reference.priceToWin : row.price_to_win,
        buy_box_status: value.reference.competitionSource === 'ml_live'
          ? value.reference.competitionStatus : row.buy_box_status,
        competition_reference: { source: value.reference.competitionSource,
          observedAt: value.reference.competitionObservedAt },
        economics: { current: value.current, competitive: value.competitive },
      };
      return { ...next, operational: catalogOperationalPresentation(next) };
    }));
  }, []);

  const applyVisibleEconomicsFailure = useCallback((itemIds: string[], reason: CatalogEconomicReason) => {
    const affected = new Set(itemIds);
    setRows(existing => existing.map(row => affected.has(row.ml_item_id)
      ? { ...row, economics: { current: unavailableCatalogEconomy(reason),
        competitive: row.price_to_win == null ? row.economics.competitive : unavailableCatalogEconomy(reason) } }
      : row));
  }, []);

  useEffect(() => {
    const requestId = ++economicsRequest.current;
    if (mode !== 'no_catalogo' || visualReview || loading || !economicsItems.length) {
      setEconomicsState({ running: false, processed: 0, total: economicsItems.length, issue: null });
      return;
    }
    const controller = new AbortController();
    const now = Date.now();
    const cached: CatalogVisibleEconomicsRow[] = [];
    const pending = economicsItems.filter(item => {
      const entry = economicsCache.current.get(item.cacheKey);
      if (!entry || now - entry.cachedAt > 120_000) {
        economicsCache.current.delete(item.cacheKey); return true;
      }
      cached.push(entry.value); return false;
    });
    applyVisibleEconomics(cached);
    setEconomicsState({ running: pending.length > 0, processed: cached.length,
      total: economicsItems.length, issue: null });
    void (async () => {
      let processed = cached.length;
      let issue: Extract<CatalogEconomicReason, 'RATE_LIMITED' | 'AUTH_REQUIRED' | 'ML_UNAVAILABLE'> | null = null;
      try {
        for (let offset = 0; offset < pending.length; offset += CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE) {
          const batch = pending.slice(offset, offset + CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE);
          const response = await fetch('/api/catalogo/no-catalogo/economics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ items: batch.map(({ mlItemId, snapshotSyncedAt }) => ({ mlItemId, snapshotSyncedAt })) }),
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => ({})) as Partial<CatalogVisibleEconomicsResponse>;
          if (!response.ok) {
            issue = response.status === 401 ? 'AUTH_REQUIRED' : 'ML_UNAVAILABLE';
            applyVisibleEconomicsFailure(pending.slice(offset).map(item => item.mlItemId), issue);
            break;
          }
          if (requestId !== economicsRequest.current) return;
          const values = Array.isArray(payload.data) ? payload.data : [];
          applyVisibleEconomics(values);
          const returned = new Set(values.map(value => value.mlItemId));
          const missing = batch.filter(item => !returned.has(item.mlItemId)).map(item => item.mlItemId);
          if (missing.length) applyVisibleEconomicsFailure(missing, 'ML_UNAVAILABLE');
          for (const value of values) {
            if (value.current.status === 'inconclusive' || value.competitive.status === 'inconclusive') continue;
            const key = catalogEconomicsCacheKey({ ml_item_id: value.mlItemId,
              snapshot_synced_at: value.snapshotSyncedAt });
            economicsCache.current.set(key, { value, cachedAt: Date.now() });
          }
          while (economicsCache.current.size > 200) {
            const first = economicsCache.current.keys().next().value;
            if (typeof first !== 'string') break;
            economicsCache.current.delete(first);
          }
          processed += batch.length;
          issue = payload.haltReason || null;
          setEconomicsState({ running: !issue && processed < economicsItems.length,
            processed, total: economicsItems.length, issue });
          if (issue) {
            applyVisibleEconomicsFailure(pending.slice(offset + batch.length).map(item => item.mlItemId), issue);
            break;
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;
        issue = 'ML_UNAVAILABLE';
        applyVisibleEconomicsFailure(pending.slice(processed - cached.length).map(item => item.mlItemId), issue);
      } finally {
        if (requestId === economicsRequest.current) setEconomicsState(current => ({ ...current, running: false, issue }));
      }
    })();
    return () => { economicsRequest.current += 1; controller.abort(); };
  }, [applyVisibleEconomics, applyVisibleEconomicsFailure, economicsItems, economicsRetry, loading, mode, visualReview]);

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
    setReviewingPrice(true);
    try {
      const response = await fetch('/api/ml/anuncio/preco-detalhe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: activeCatalog.produto_id, mlItemId: activeCatalog.ml_item_id,
          priceCents: Math.round(newPrice * 100),
          disableAutomaticPricing: priceDetail?.automaticPricing?.active === true }),
      });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail?.error || 'Não foi possível revisar este preço.');
      const memory = priceMemory(detail);
      setPriceReview({ detail, price: newPrice, profit: memory.profit, margin: memory.margin });
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível revisar este preço.'));
    } finally { setReviewingPrice(false); }
  }, [activeCatalog, messageApi, newPrice, priceDetail?.automaticPricing?.active, visualReview]);

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
      startTracking({ outboxId, produtoId: activeCatalog.produto_id,
        onTerminal: (status) => { if (status.status === 'done') { void fetchData(); setActiveCatalog(null); } } });
      messageApi.success('Alteração programada para envio ao Mercado Livre.');
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível confirmar a alteração.'));
    } finally { setConfirmingPrice(false); }
  }, [activeCatalog, fetchData, hasOpenTracking, messageApi, priceReview, startTracking]);
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
          <small>SKU {row.sku_local || 'não informado'} · <MercadoLivreCodeLink code={row.ml_item_id}
            href={visualReview ? null : row.permalink} label="Anúncio de catálogo" /></small></div>
      </div>) },
    { title: 'Situação', key: 'situation', width: 230, render: (_, row) => (
      <div className={styles.situationCell}><span className={`${styles.statusDot} ${styles[row.operational.tone]}`} />
        <div><strong>{row.operational.label}</strong><small>{row.operational.description}</small></div></div>) },
    { title: 'Preço atual', key: 'price', width: 170, sorter: true,
      render: (_, row) => <PriceResult price={row.price} economy={row.economics.current} /> },
    { title: 'Preço para ganhar', key: 'competition', width: 190, sorter: true,
      render: (_, row) => {
        const guidance = catalogPriceToWinPresentation({ status: row.buy_box_status, priceToWin: row.price_to_win });
        return guidance.key === 'available'
          ? <PriceResult price={row.price_to_win!} economy={row.economics.competitive}
            referenceLabel={`${row.competition_reference?.source === 'ml_live' ? 'Referência ML' : 'Última referência ML'} · ${formatDate(
              row.competition_reference?.observedAt || row.snapshot_synced_at)}`} />
          : <PriceGuidance guidance={guidance} />;
      } },
    { title: 'Próxima ação', key: 'action', width: 180, render: (_, row) => (
      <Button type={row.operational.needsAction ? 'primary' : 'default'} icon={<ArrowRightOutlined />}
        onClick={() => void loadPriceDetail(row)}>{row.operational.actionLabel}</Button>) },
  ], [loadPriceDetail, visualReview]);
  const eligibleColumns: TableProps<ElegivelRow>['columns'] = useMemo(() => [
    { title: 'Produto e anúncio padrão', key: 'listing', width: 390, render: (_, row) => (
      <div className={styles.listingCell}>
        {row.thumbnail ? <Image src={row.thumbnail} alt="" width={48} height={48} preview={false} className={styles.thumbnail} />
          : <span className={styles.thumbnailFallback}><ShopOutlined /></span>}
        <div><strong>{row.local_product_name || row.title || 'Produto não identificado'}</strong><span>{row.title}</span>
          <small>SKU {row.seller_sku || 'não informado'} · <MercadoLivreCodeLink code={row.ml_item_id}
            href={visualReview ? null : row.permalink} label="Anúncio padrão" /></small></div>
      </div>) },
    { title: 'Situação', key: 'eligibility', width: 280, render: (_, row) => {
      const presentation = eligibilityPresentation(row.state);
      return <div className={styles.stackCell}><Tag color={presentation.color}>{presentation.label}</Tag>
        <small>{userSafeMessage(row.reason, 'Confira o vínculo antes de continuar.')}</small></div>;
    } },
    { title: 'Produto de catálogo', key: 'catalogProduct', width: 280, render: (_, row) => (
      <div className={styles.stackCell}><strong>{row.catalog_product_name_sugerido || row.catalog_product_name || 'Não identificado'}</strong>
        <small><MercadoLivreCodeLink code={row.catalog_product_id_sugerido || row.catalog_product_id}
          href={visualReview ? null : buildMercadoLivreCatalogProductUrl(row.catalog_product_id_sugerido || row.catalog_product_id)}
          label="Produto de catálogo" /></small></div>) },
    { title: 'Próxima ação', key: 'action', width: 180, render: (_, row) => {
      const presentation = eligibilityPresentation(row.state);
      return <Button type={row.state === 'ready' && createEnabled ? 'primary' : 'default'} icon={<EyeOutlined />}
        onClick={() => setActiveEligible(row)}>{row.state === 'ready' && !createEnabled ? 'Ver detalhes' : presentation.action}</Button>;
    } },
  ], [createEnabled, visualReview]);
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
  const liveCatalogMismatch = priceDetail?.catalogListing === false;
  const detailCompetition = activeCatalog
    ? catalogCompetitionPresentation(liveCatalogMismatch
      ? 'not_listed'
      : (priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status))
    : null;
  const detailOperational = liveCatalogMismatch && activeCatalog ? {
    ...activeCatalog.operational,
    label: 'Não pertence ao catálogo',
    description: 'O Mercado Livre confirmou que este é um anúncio padrão.',
    tone: 'negative' as const,
  } : activeCatalog?.operational;
  const detailPriceGuidance = activeCatalog ? catalogPriceToWinPresentation({
    status: liveCatalogMismatch ? 'not_listed' : (priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status),
    priceToWin: liveCatalogMismatch ? null : (priceDetail?.catalog?.priceToWin ?? activeCatalog.price_to_win),
  }) : null;
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

    {mode === 'no_catalogo' && !visualReview && <Alert className={styles.economicsAlert} type={economicsState.issue ? 'warning' : 'info'} showIcon
      message="Preço para ganhar é uma referência do Mercado Livre"
      description={`Lucro e margem são estimativas para a referência consultada. Nenhum preço será alterado.${economicsState.running
        ? ` Calculando a página: ${economicsState.processed}/${economicsState.total}.`
        : economicsState.issue ? ` ${catalogEconomicReasonLabel(economicsState.issue)}.` : ''}`}
      action={economicsState.issue ? <Button size="small" onClick={() => setEconomicsRetry(value => value + 1)}>
        Tentar cálculos novamente
      </Button> : undefined} />}

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
          : mode === 'no_catalogo' ? <ResponsiveTable<NoCatalogoRow> className={styles.table}
            rowKey="ml_item_id" dataSource={rows} columns={catalogColumns}
            onChange={handleCatalogTableChange} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false,
              showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} size="small" />
          : <ResponsiveTable<ElegivelRow> className={styles.table}
            rowKey="ml_item_id" dataSource={eligibleRows} columns={eligibleColumns}
            rowSelection={createEnabled ? { selectedRowKeys: selectedEligibleKeys, onChange: setSelectedEligibleKeys,
              getCheckboxProps: (row) => ({ disabled: row.state !== 'ready' || Boolean(visualReview) }) } : undefined}
            pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage,
              showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} size="small" />}
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
          <span className={`${styles.statusDot} ${styles[detailOperational?.tone || activeCatalog.operational.tone]}`} />
          <div><small>Situação atual</small><strong>{detailOperational?.label || activeCatalog.operational.label}</strong>
            <p>{detailOperational?.description || activeCatalog.operational.description}</p></div></div>
        {liveCatalogMismatch && <Alert type="warning" showIcon message="Este anúncio não participa do catálogo"
          description="Ele não possui preço para ganhar e será removido desta lista na próxima atualização dos dados." />}
        <div className={styles.priceOverview}><SummaryCard title="Preço atual"
          price={priceDetail?.currentPrice ?? activeCatalog.price} economy={currentEconomy} />
          <SummaryCard title="Preço para ganhar" price={priceDetail?.catalog?.priceToWin ?? activeCatalog.price_to_win}
            economy={competitiveEconomy} empty={detailPriceGuidance && detailPriceGuidance.key !== 'available'
              ? { label: detailPriceGuidance.label, description: detailPriceGuidance.description } : undefined} /></div>

        {actionableBoosts.length > 0 && <div className={styles.actionableBoosts}><strong>O que pode melhorar a disputa</strong>
          {actionableBoosts.map((boost) => <span key={boost.id}><b>{boostLabel(boost)}</b>
            <small>{catalogBoostPresentation(boost.status).label}</small></span>)}</div>}
        {priceDetail?.catalog?.reasons?.length ? <Alert type="warning" showIcon message="O Mercado Livre informou um impedimento"
          description={priceDetail.catalog.reasons.map(catalogCompetitionReasonPresentation).join(' · ')} /> : null}
        {priceDetail?.catalog?.warning && <Alert type="warning" showIcon
          message={userSafeMessage(priceDetail.catalog.warning, 'A competição está indisponível.')} />}

        {!liveCatalogMismatch && <section className={styles.priceAction}><div><strong>Alterar preço</strong>
          <small>Confira o impacto antes de confirmar. Nada é alterado nesta etapa.</small></div>
          <div className={styles.priceEditor}><InputNumber prefix="R$" min={0.01} precision={2} value={newPrice}
            onChange={(value) => setNewPrice(value ?? null)}
            disabled={Boolean(visualReview) || !activeCatalog.produto_id} />
            <Button type="primary" loading={reviewingPrice}
              disabled={Boolean(visualReview) || !activeCatalog.produto_id || !newPrice}
              onClick={() => void reviewPrice()}>Revisar alteração</Button></div>
          {priceDetail?.automaticPricing?.active && <Text type="warning">A confirmação desativará a automação de preço no Mercado Livre antes da alteração.</Text>}</section>}

        <details className={styles.technicalDetails}><summary>Detalhes técnicos</summary><dl>
          <div><dt>{liveCatalogMismatch ? 'Anúncio padrão' : 'Anúncio de catálogo'}</dt><dd><MercadoLivreCodeLink code={activeCatalog.ml_item_id}
            href={visualReview ? null : activeCatalog.permalink} label={liveCatalogMismatch ? 'Anúncio padrão' : 'Anúncio de catálogo'} /></dd></div>
          {!liveCatalogMismatch && <div><dt>Anúncio padrão</dt><dd>{activeCatalog.relacionado_id
            ? <MercadoLivreCodeLink code={activeCatalog.relacionado_id}
              href={visualReview ? null : activeCatalog.related_permalink} label="Anúncio padrão" />
            : 'Sem anúncio padrão relacionado'}</dd></div>}
          <div><dt>Produto de catálogo</dt><dd><MercadoLivreCodeLink code={activeCatalog.catalog_product_id}
            href={visualReview ? null : buildMercadoLivreCatalogProductUrl(activeCatalog.catalog_product_id)}
            label="Produto de catálogo" /></dd></div>
          <div><dt>SKU Bentevi</dt><dd>{activeCatalog.sku_local || 'Não informado'}</dd></div>
          <div><dt>Última consulta</dt><dd>{formatDate(priceDetail?.catalog?.syncedAt || activeCatalog.last_updated)}</dd></div>
        </dl>{(priceDetail?.catalog?.boosts || []).length > 0 && <div className={styles.allBoosts}>
          {(priceDetail?.catalog?.boosts || []).map((boost) => <span key={boost.id}><b>{boostLabel(boost)}</b>
            <small>{catalogBoostPresentation(boost.status).label}</small></span>)}</div>}</details>
      </div></Spin>}
    </Drawer>

    <Modal open={Boolean(priceReview)} title="Confirmar alteração de preço"
      okText={priceReview?.detail.decisionContext?.disableAutomaticPricing ? 'Desativar automação e alterar' : 'Confirmar alteração'} cancelText="Voltar"
      confirmLoading={confirmingPrice} okButtonProps={{ disabled: priceReview?.detail.decisionContext?.executable !== true }}
      onCancel={() => setPriceReview(null)} onOk={() => void confirmPrice()}>
      {priceReview && activeCatalog && <div className={styles.priceReview}>
        <p>Revise o impacto unitário antes de enviar ao Mercado Livre.</p>
        <div className={styles.reviewComparison}><SummaryCard title="Preço atual"
          price={priceDetail?.currentPrice ?? activeCatalog.price} economy={currentEconomy} /><ArrowRightOutlined />
          <SummaryCard title="Novo preço" price={priceReview.price} economy={{ profit: priceReview.profit,
            marginPercent: priceReview.margin, status: priceReview.profit == null ? 'inconclusive' : 'available',
            source: priceReview.profit == null ? 'unavailable' : 'live_saved', calculatedAt: null,
            reason: priceReview.profit == null ? 'ML_UNAVAILABLE' : null }} /></div>
        {priceReview.detail.decisionContext?.executable !== true && <Alert type="warning" showIcon
          message="Esta alteração ainda não pode ser confirmada"
          description={decisionBlockMessage(priceReview.detail.decisionContext?.reasons)} />}
        {(priceReview.detail.decisionContext?.warnings || []).map((warning) => <Alert key={warning} type="warning" showIcon
          message={decisionWarningMessage(warning)} />)}
        {priceReview.detail.decisionContext?.disableAutomaticPricing && <Alert type="warning" showIcon
          message="A automação de preço será desativada no Mercado Livre antes de aplicar este valor." />}
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
          <div><dt>Anúncio padrão</dt><dd><MercadoLivreCodeLink code={activeEligible.ml_item_id}
            href={visualReview ? null : activeEligible.permalink} label="Anúncio padrão" /></dd></div>
          <div><dt>Produto de catálogo</dt><dd><MercadoLivreCodeLink
            code={activeEligible.catalog_product_id_sugerido || activeEligible.catalog_product_id}
            href={visualReview ? null : buildMercadoLivreCatalogProductUrl(
              activeEligible.catalog_product_id_sugerido || activeEligible.catalog_product_id,
            )} label="Produto de catálogo" /></dd></div>
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

function PriceResult({ price, economy, referenceLabel }: {
  price: number; economy: EconomicSummary; referenceLabel?: string;
}) {
  return <div className={styles.valueCell}><strong>{formatCurrency(price)}</strong>
    {economy.profit == null || economy.marginPercent == null ? <small>{catalogEconomicReasonLabel(economy.reason)}</small>
      : <small className={economy.profit < 0 ? styles.negative : styles.positive}>
        {economy.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(economy.profit))} · {economy.marginPercent.toFixed(2)}%
      </small>}
    {referenceLabel && <small className={styles.referenceLabel}>{referenceLabel}</small>}</div>;
}
function PriceGuidance({ guidance }: { guidance: CatalogPriceGuidance }) {
  return <div className={styles.valueCell}><strong>{guidance.label}</strong><small>{guidance.description}</small></div>;
}
function SummaryCard({ title, price, economy, empty }: {
  title: string;
  price: number | null | undefined;
  economy?: EconomicSummary | null;
  empty?: { label: string; description: string };
}) {
  const hasPrice = price != null && Number.isFinite(Number(price));
  return <div className={styles.summaryCard}><small>{title}</small>
    <strong>{hasPrice ? formatCurrency(Number(price)) : (empty?.label || 'Não informado')}</strong>
    {!hasPrice && empty ? <span>{empty.description}</span>
      : economy?.profit == null || economy.marginPercent == null
        ? <span>{catalogEconomicReasonLabel(economy?.reason)}</span>
      : <span className={economy.profit < 0 ? styles.negative : styles.positive}>
        {economy.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(economy.profit))} · {economy.marginPercent.toFixed(2)}%
      </span>}
  </div>;
}
