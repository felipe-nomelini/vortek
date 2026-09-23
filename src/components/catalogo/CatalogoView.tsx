'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert, Button, Drawer, Empty, Image, Input, InputNumber, Progress,
  Segmented, Select, Space, Spin, Tag, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowRightOutlined, ExportOutlined, EyeOutlined, FilePdfOutlined, LoadingOutlined,
  ReloadOutlined, SearchOutlined, ShopOutlined,
} from '@ant-design/icons';
import ResponsiveTable from '@/components/ResponsiveTable';
import { currencyInputProps, formatCurrency } from '@/lib/format';
import {
  catalogBoostPresentation, catalogCompetitionPresentation,
  catalogCompetitionReasonPresentation, catalogOperationalPresentation, catalogPriceToWinPresentation,
  type CatalogEligibilityActionState, type CatalogOperationalState, type CatalogPriceGuidance,
  type CatalogOperationalView, type CatalogVariationEligibility,
} from '@/lib/catalogo/dashboard';
import type { CatalogRefreshPresentation } from '@/lib/catalogo/refresh-presentation';
import { buildMercadoLivreCatalogProductUrl } from '@/lib/catalogo/no-catalogo';
import {
  CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE,
  catalogEconomicReasonLabel,
  catalogEconomicsResponseIsCurrent,
  catalogEconomyAtPrice,
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
  eligibility_status?: string | null;
  variation_eligibility: CatalogVariationEligibility[]; state: CatalogEligibilityActionState;
  reason: string; isHomologationFixture?: boolean;
};
type CatalogMetrics = { total: number; needsAction: number; healthy: number };
type EligibleMetrics = {
  total: number; ready: number; alreadyOptedIn: number; reviewRequired: number;
  catalogProductMissing: number; catalogProductUnavailable: number;
  identityMismatch: number; localProductMissing: number;
};
type RefreshStatusPayload = {
  success?: boolean; error?: string;
  job?: { id: string; status: string; progresso?: number; processados?: number; total?: number;
    presentation?: CatalogRefreshPresentation;
    summary?: { detailsUnavailable: number; competitionUnavailable: number; updated: number } } | null;
};
type PriceDetail = {
  evaluationId?: string;
  decisionContext?: { executable?: boolean; reasons?: string[]; warnings?: string[]; priceCents?: number;
    groupId?: string | null; disableAutomaticPricing?: boolean } | null;
  currentPrice?: number | null; currentProfit?: number | null;
  pricing?: { current?: { memory?: { resultCents?: number; margin?: number; revenueCents?: number } | null } };
  competitiveAssessment?: {
    current?: { memory?: { resultCents?: number; margin?: number; revenueCents?: number } | null } | null;
    competitive?: { memory?: { resultCents?: number; margin?: number; revenueCents?: number } | null } | null;
  } | null;
  listingValidation?: { state?: 'verified' | 'pending' | 'conflict' | 'ineligible' | 'unavailable' } | null;
  automaticPricing?: { active?: boolean };
  catalogListing?: boolean | null;
  catalog?: { rawStatus?: string | null; priceToWin?: number | null;
    winner?: { itemId?: string | null; price?: number | null } | null;
    boosts?: Array<{ id: string; status: string; description: string }>;
    reasons?: string[]; warning?: string | null; syncedAt?: string | null } | null;
};
type PricePreview = { currentPriceCents: number; priceCents: number;
  status: 'available' | 'estimated' | 'inconclusive'; resultCents: number | null;
  marginPercent: number | null; warnings: string[]; automaticPricingActive: boolean };
type PriceOperation = { outboxId: string; status: 'pending' | 'processing' | 'retry' | 'done' | 'failed' | 'cancelled';
  error?: string };

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
  { value: 'all', label: 'Todas as situações' }, { value: 'ready', label: 'Elegíveis no ML' },
  { value: 'already_opted_in', label: 'Já no catálogo' },
  { value: 'review_required', label: 'Revisão necessária' },
  { value: 'catalog_product_missing', label: 'Sem produto de catálogo' },
  { value: 'catalog_product_unavailable', label: 'Produto indisponível' },
  { value: 'identity_mismatch', label: 'Dados divergentes' },
  { value: 'local_product_missing', label: 'Produto não identificado' },
];

function eligibilityPresentation(state: CatalogEligibilityActionState) {
  if (state === 'ready') return { label: 'Elegível no ML', color: 'green', action: 'Conferir inclusão no ML' };
  if (state === 'already_opted_in') return { label: 'Já no catálogo', color: 'blue', action: 'Conferir no ML' };
  if (state === 'catalog_product_missing') return { label: 'Sem produto de catálogo', color: 'orange', action: 'Conferir associação no ML' };
  if (state === 'catalog_product_unavailable') return { label: 'Produto de catálogo inativo', color: 'red', action: 'Conferir produto no ML' };
  if (state === 'identity_mismatch') return { label: 'Dados divergentes', color: 'orange', action: 'Conferir identidade do produto' };
  if (state === 'review_required') return { label: 'Elegibilidade não confirmada', color: 'orange', action: 'Conferir no ML' };
  return { label: 'Sem vínculo no Bentevi', color: 'default', action: 'Conferir vínculo e SKU' };
}
function variationEligibilityLabel(status: unknown) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'READY_FOR_OPTIN') return 'Elegível no Mercado Livre';
  if (value === 'ALREADY_OPTED_IN') return 'Já participa do catálogo';
  if (value === 'ALREADY_IN_CATALOG') return 'Já possui anúncio de catálogo';
  if (value === 'CATALOG_PRODUCT_ID_NULL') return 'Sem produto de catálogo associado';
  if (value === 'PRODUCT_INACTIVE') return 'Produto de catálogo inativo';
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
function memoryEconomy(memory: { resultCents?: number; margin?: number; revenueCents?: number } | null | undefined): EconomicSummary | null {
  if (memory?.resultCents == null || memory.margin == null
    || memory.revenueCents == null || !Number.isSafeInteger(memory.revenueCents)
    || !Number.isFinite(Number(memory.resultCents)) || !Number.isFinite(Number(memory.margin))) return null;
  return { status: 'available', profit: Number(memory.resultCents) / 100,
    marginPercent: Number(memory.margin) * 100, evaluatedPriceCents: memory.revenueCents,
    source: 'live_saved', calculatedAt: null, reason: null };
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
  const requestSequence = useRef(0);
  const pricingRequest = useRef(0);
  const drawerEconomicsRequest = useRef(0);
  const previewRequest = useRef(0);
  const statusCursor = useRef(0);
  const dataAbortController = useRef<AbortController | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const economicsRequest = useRef(0);

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
    total: 0, ready: 0, alreadyOptedIn: 0, reviewRequired: 0, catalogProductMissing: 0,
    catalogProductUnavailable: 0, identityMismatch: 0, localProductMissing: 0,
  });
  const [eligibleCheckedAt, setEligibleCheckedAt] = useState<string | null>(null);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [refreshPayload, setRefreshPayload] = useState<RefreshStatusPayload | null>(null);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [economicsRetry, setEconomicsRetry] = useState(0);
  const [economicsItems, setEconomicsItems] = useState<Array<{
    mlItemId: string; snapshotSyncedAt: string;
  }>>([]);
  const [economicsState, setEconomicsState] = useState<{
    running: boolean; processed: number; total: number;
    issue: Extract<CatalogEconomicReason, 'RATE_LIMITED' | 'AUTH_REQUIRED' | 'ML_UNAVAILABLE'> | null;
  }>({ running: false, processed: 0, total: 0, issue: null });

  const [selectedCatalog, setActiveCatalog] = useState<NoCatalogoRow | null>(null);
  const [activeEligible, setActiveEligible] = useState<ElegivelRow | null>(null);
  const [priceDetail, setPriceDetail] = useState<PriceDetail | null>(null);
  const [priceDetailLoading, setPriceDetailLoading] = useState(false);
  const [drawerEconomicsLoading, setDrawerEconomicsLoading] = useState(false);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [pricePreview, setPricePreview] = useState<PricePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [operations, setOperations] = useState<Record<string, PriceOperation>>({});
  const priceCommandRef = useRef<{ key: string; id: string } | null>(null);
  const [confirmingPrice, setConfirmingPrice] = useState(false);
  const confirmingPriceRef = useRef(false);
  const activeCatalog = selectedCatalog
    ? rows.find(row => row.ml_item_id === selectedCatalog.ml_item_id) || selectedCatalog : null;


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
          .map(row => ({ mlItemId: row.ml_item_id, snapshotSyncedAt: row.snapshot_synced_at! })));
        setCatalogMetrics({ total: Number(payload.metrics?.total || 0),
          needsAction: Number(payload.metrics?.needsAction || 0), healthy: Number(payload.metrics?.healthy || 0) });
        setLastSyncedAt(payload.lastSyncedAt || null);
      } else {
        setEconomicsItems([]);
        setEligibleRows(Array.isArray(payload.data) ? payload.data : []);
        setEligibleMetrics({ total: Number(payload.metrics?.total || 0), ready: Number(payload.metrics?.ready || 0),
          alreadyOptedIn: Number(payload.metrics?.alreadyOptedIn || 0),
          reviewRequired: Number(payload.metrics?.reviewRequired || 0),
          catalogProductMissing: Number(payload.metrics?.catalogProductMissing || 0),
          catalogProductUnavailable: Number(payload.metrics?.catalogProductUnavailable || 0),
          identityMismatch: Number(payload.metrics?.identityMismatch || 0),
          localProductMissing: Number(payload.metrics?.localProductMissing || 0) });
        setEligibleCheckedAt(payload.checkedAt || null);
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
      if (!value || !catalogEconomicsResponseIsCurrent(row, value)) return row;
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

  const applyVisibleEconomicsFailure = useCallback((itemIds: string[], reason: CatalogEconomicReason,
    requestedAt = Date.now()) => {
    const affected = new Set(itemIds);
    setRows(existing => existing.map(row => affected.has(row.ml_item_id)
      && (!row.competition_reference || Date.parse(row.competition_reference.observedAt) <= requestedAt)
      ? { ...row, economics: { current: unavailableCatalogEconomy(reason),
        competitive: row.price_to_win == null ? row.economics.competitive : unavailableCatalogEconomy(reason) } }
      : row));
  }, []);

  useEffect(() => {
    const requestId = ++economicsRequest.current;
    if (mode !== 'no_catalogo' || visualReview || loading || activeCatalog || !economicsItems.length) {
      setEconomicsState({ running: false, processed: 0, total: economicsItems.length, issue: null });
      return;
    }
    const controller = new AbortController();
    const requestedAt = Date.now();
    const pending = economicsItems;
    setEconomicsState({ running: pending.length > 0, processed: 0,
      total: economicsItems.length, issue: null });
    void (async () => {
      let processed = 0;
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
            applyVisibleEconomicsFailure(pending.slice(offset).map(item => item.mlItemId), issue, requestedAt);
            break;
          }
          if (requestId !== economicsRequest.current) return;
          const values = Array.isArray(payload.data) ? payload.data : [];
          applyVisibleEconomics(values);
          const returned = new Set(values.map(value => value.mlItemId));
          const missing = batch.filter(item => !returned.has(item.mlItemId)).map(item => item.mlItemId);
          if (missing.length) applyVisibleEconomicsFailure(missing, 'ML_UNAVAILABLE', requestedAt);
          processed += batch.length;
          issue = payload.haltReason || null;
          setEconomicsState({ running: !issue && processed < economicsItems.length,
            processed, total: economicsItems.length, issue });
          if (issue) {
            applyVisibleEconomicsFailure(pending.slice(offset + batch.length).map(item => item.mlItemId), issue, requestedAt);
            break;
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;
        issue = 'ML_UNAVAILABLE';
        applyVisibleEconomicsFailure(pending.slice(processed).map(item => item.mlItemId), issue, requestedAt);
      } finally {
        if (requestId === economicsRequest.current) setEconomicsState(current => ({ ...current, running: false, issue }));
      }
    })();
    return () => { economicsRequest.current += 1; controller.abort(); };
  }, [activeCatalog, applyVisibleEconomics, applyVisibleEconomicsFailure, economicsItems, economicsRetry, loading, mode, visualReview]);

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
        setRefreshPayload(payload); messageApi.success('Catálogo atualizado.'); await fetchData(); return;
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
        else setRefreshPayload(payload);
      } catch { /* a ausência de um job anterior não impede a consulta */ }
    })();
    return stopRefreshPolling;
  }, [fetchRefreshStatus, mode, stopRefreshPolling, trackRefresh]);
  const startRefresh = useCallback(async () => {
    if (visualReview) return void messageApi.info('A amostra protegida não executa sincronizações externas.');
    const response = await fetch('/api/catalogo/no-catalogo/refresh/job', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'full' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.jobId) return void messageApi.error(userSafeMessage(payload?.error, 'Não foi possível iniciar a atualização.'));
    setRefreshPayload(null); trackRefresh(String(payload.jobId));
  }, [messageApi, trackRefresh, visualReview]);

  const refreshDrawerEconomics = useCallback(async (row: NoCatalogoRow) => {
    const requestId = ++drawerEconomicsRequest.current;
    if (visualReview || !row.produto_id || !row.snapshot_synced_at) return;
    const requestedAt = Date.now();
    setDrawerEconomicsLoading(true);
    try {
      const response = await fetch('/api/catalogo/no-catalogo/economics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ items: [{ mlItemId: row.ml_item_id,
          snapshotSyncedAt: row.snapshot_synced_at }] }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<CatalogVisibleEconomicsResponse>;
      if (requestId !== drawerEconomicsRequest.current) return;
      const fresh = response.ok && Array.isArray(payload.data)
        ? payload.data.find(value => value.mlItemId === row.ml_item_id) : null;
      if (fresh) applyVisibleEconomics([fresh]);
      else applyVisibleEconomicsFailure([row.ml_item_id], payload.haltReason || 'ML_UNAVAILABLE', requestedAt);
    } catch {
      if (requestId === drawerEconomicsRequest.current)
        applyVisibleEconomicsFailure([row.ml_item_id], 'ML_UNAVAILABLE', requestedAt);
    } finally {
      if (requestId === drawerEconomicsRequest.current) setDrawerEconomicsLoading(false);
    }
  }, [applyVisibleEconomics, applyVisibleEconomicsFailure, visualReview]);

  const openPriceEditor = useCallback((row: NoCatalogoRow) => {
    pricingRequest.current += 1;
    setActiveCatalog(row); setPriceDetail(null); setPricePreview(null); setPreviewError(null);
    setNewPrice(row.price);
    void refreshDrawerEconomics(row);
  }, [refreshDrawerEconomics]);

  const loadTechnicalDetail = useCallback(async (row: NoCatalogoRow) => {
    const requestId = ++pricingRequest.current;
    if (visualReview || !row.produto_id || priceDetail) return;
    setPriceDetailLoading(true);
    try {
      const params = new URLSearchParams({ produtoId: row.produto_id, mlItemId: row.ml_item_id });
      const response = await fetch(`/api/ml/anuncio/preco-detalhe?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar os detalhes.');
      if (requestId !== pricingRequest.current) return;
      setPriceDetail(payload);
      const current = memoryEconomy(payload?.competitiveAssessment?.current?.memory);
      const competitive = memoryEconomy(payload?.competitiveAssessment?.competitive?.memory);
      if (current || competitive) setRows((existing) => existing.map((entry) => entry.ml_item_id === row.ml_item_id
        ? { ...entry, economics: { current: current || entry.economics.current,
          competitive: competitive || entry.economics.competitive } }
        : entry));
      if (payload.currentPrice !== row.price || payload.catalog?.priceToWin !== row.price_to_win)
        void refreshDrawerEconomics(row);
    } catch (error: unknown) {
      if (requestId === pricingRequest.current) messageApi.error(userSafeMessage(
        error instanceof Error ? error.message : null, 'Não foi possível carregar os detalhes.'));
    } finally { if (requestId === pricingRequest.current) setPriceDetailLoading(false); }
  }, [messageApi, priceDetail, refreshDrawerEconomics, visualReview]);

  useEffect(() => {
    const requestId = ++previewRequest.current;
    setPricePreview(null); setPreviewError(null); setPreviewBlocked(false);
    if (!activeCatalog?.produto_id || visualReview || newPrice === null || !Number.isFinite(newPrice)
      || newPrice <= 0 || !Number.isSafeInteger(Math.round(newPrice * 100))) {
      setPreviewLoading(false); return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(() => void (async () => {
      try {
        const response = await fetch('/api/catalogo/preco/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ produtoId: activeCatalog.produto_id, mlItemId: activeCatalog.ml_item_id,
            priceCents: Math.round(newPrice * 100) }), signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (requestId !== previewRequest.current) return;
        if (!response.ok) {
          setPreviewBlocked(response.status === 409 || response.status === 422);
          setPreviewError(userSafeMessage(payload?.error, 'Não foi possível calcular o impacto agora.'));
          return;
        }
        setPricePreview(payload as PricePreview);
      } catch (error: unknown) {
        if (requestId === previewRequest.current && !(error instanceof Error && error.name === 'AbortError'))
          setPreviewError('Não foi possível calcular o impacto agora.');
      } finally { if (requestId === previewRequest.current) setPreviewLoading(false); }
    })(), 300);
    return () => { previewRequest.current += 1; controller.abort(); clearTimeout(timer); };
  }, [activeCatalog, newPrice, visualReview]);

  const confirmPrice = useCallback(async () => {
    if (!activeCatalog?.produto_id || !newPrice || previewLoading || previewBlocked || confirmingPriceRef.current) return;
    const priceCents = Math.round(newPrice * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return;
    const key = `${activeCatalog.produto_id}:${activeCatalog.ml_item_id}:${priceCents}`;
    const operationId = priceCommandRef.current?.key === key ? priceCommandRef.current.id : crypto.randomUUID();
    priceCommandRef.current = { key, id: operationId };
    confirmingPriceRef.current = true;
    setConfirmingPrice(true);
    try {
      const response = await fetch('/api/catalogo/preco/confirmar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId, produtoId: activeCatalog.produto_id,
          mlItemId: activeCatalog.ml_item_id, priceCents,
          disableAutomaticPricing: pricePreview?.automaticPricingActive === true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível confirmar a alteração.');
      const outboxId = String(payload?.outboxId || '').trim();
      if (!outboxId) throw new Error('A alteração não foi programada.');
      setOperations(current => ({ ...current, [activeCatalog.ml_item_id]: { outboxId, status: 'pending' } }));
      priceCommandRef.current = null;
      setActiveCatalog(null);
      messageApi.info('Envio iniciado. Acompanhe o resultado na lista.');
    } catch (error: unknown) {
      messageApi.error(userSafeMessage(error instanceof Error ? error.message : null, 'Não foi possível confirmar a alteração.'));
    } finally { confirmingPriceRef.current = false; setConfirmingPrice(false); }
  }, [activeCatalog, messageApi, newPrice, previewBlocked, previewLoading, pricePreview]);

  useEffect(() => {
    const pending = Object.entries(operations).filter(([, operation]) =>
      !['done', 'failed', 'cancelled'].includes(operation.status));
    if (!pending.length) return;
    const batch = pending.slice(statusCursor.current, statusCursor.current + 8);
    statusCursor.current = (statusCursor.current + batch.length) % pending.length;
    let cancelled = false;
    const timer = setTimeout(() => void (async () => {
      const updates = await Promise.all(batch.map(async ([itemId, operation]) => {
        try {
          const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(operation.outboxId)}`,
            { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !['pending', 'processing', 'retry', 'done', 'failed', 'cancelled'].includes(payload.status))
            return null;
          return { itemId, outboxId: operation.outboxId, status: payload.status as PriceOperation['status'],
            error: typeof payload.last_error === 'string'
              ? userSafeMessage(payload.last_error, 'Falha na publicação do preço.') : undefined };
        } catch { return null; }
      }));
      if (cancelled) return;
      const valid = updates.filter((value): value is NonNullable<typeof value> => value !== null);
      if (!valid.length) { setOperations(current => ({ ...current })); return; }
      setOperations(current => {
        const next = { ...current };
        for (const update of valid) if (next[update.itemId]?.outboxId === update.outboxId)
          next[update.itemId] = { outboxId: update.outboxId, status: update.status, error: update.error };
        return next;
      });
      if (valid.some(value => value.status === 'done')) void fetchData();
      for (const value of valid) {
        if (value.status === 'done') messageApi.success(`Preço confirmado no anúncio ${value.itemId}.`);
        if (value.status === 'failed' || value.status === 'cancelled')
          messageApi.error(`Não foi possível concluir o preço do anúncio ${value.itemId}. Confira o estado antes de tentar novamente.`);
      }
    })(), 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [fetchData, messageApi, operations]);

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
    { title: <span title="Referência consultada no Mercado Livre. Nenhum preço é alterado automaticamente.">Preço para ganhar · referência ML</span>, key: 'competition', width: 190, sorter: true,
      render: (_, row) => {
        const guidance = catalogPriceToWinPresentation({ status: row.buy_box_status, priceToWin: row.price_to_win });
        return guidance.key === 'available'
          ? <PriceResult price={row.price_to_win!} economy={row.economics.competitive}
            referenceLabel={`${row.competition_reference?.source === 'ml_live' ? 'Referência ML' : 'Última referência ML'} · ${formatDate(
              row.competition_reference?.observedAt || row.snapshot_synced_at)}`} />
          : <PriceGuidance guidance={guidance} />;
      } },
    { title: 'Próxima ação', key: 'action', width: 180, render: (_, row) => {
      const operation = operations[row.ml_item_id];
      return <div className={styles.actionCell}><Button type={row.operational.needsAction ? 'primary' : 'default'}
        icon={<ArrowRightOutlined />} disabled={operation && !['done', 'failed', 'cancelled'].includes(operation.status)}
        onClick={() => openPriceEditor(row)}>{row.operational.actionLabel}</Button>
        {operation && <small role="status" title={operation.error}
          className={operation.status === 'failed' ? styles.negative : undefined}>
          {operation.status === 'done' ? 'Preço confirmado no ML'
            : operation.status === 'failed' || operation.status === 'cancelled'
              ? 'Falha no envio; confira o anúncio'
              : 'Enviando preço ao ML…'}</small>}</div>;
    } },
  ], [openPriceEditor, operations, visualReview]);
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
      <div className={styles.stackCell}><strong>{row.catalog_product_name || 'Não identificado pelo Mercado Livre'}</strong>
        <small><MercadoLivreCodeLink code={row.catalog_product_id}
          href={visualReview ? null : buildMercadoLivreCatalogProductUrl(row.catalog_product_id)}
          label="Produto de catálogo" /></small>
        {row.catalog_product_id_sugerido && <small>Sugestão para revisão: {row.catalog_product_name_sugerido || row.catalog_product_id_sugerido}</small>}</div>) },
    { title: 'Próxima ação', key: 'action', width: 180, render: (_, row) => {
      return <Button icon={<EyeOutlined />}
        onClick={() => setActiveEligible(row)}>Ver próxima ação</Button>;
    } },
  ], [visualReview]);
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
      ['already_opted_in', 'Já no catálogo', eligibleMetrics.alreadyOptedIn],
      ['identity_mismatch', 'Divergências', eligibleMetrics.identityMismatch],
      ['catalog_product_missing', 'Sem catálogo', eligibleMetrics.catalogProductMissing],
      ['catalog_product_unavailable', 'Indisponíveis', eligibleMetrics.catalogProductUnavailable],
      ['local_product_missing', 'Sem vínculo', eligibleMetrics.localProductMissing],
      ['review_required', 'Revisar', eligibleMetrics.reviewRequired]] as const;
  const currentEconomy = drawerEconomicsLoading ? unavailableCatalogEconomy('CALCULATION_PENDING')
    : memoryEconomy(priceDetail?.competitiveAssessment?.current?.memory)
      || memoryEconomy(priceDetail?.pricing?.current?.memory) || activeCatalog?.economics.current;
  const identityUnverified = Boolean(priceDetail?.listingValidation
    && priceDetail.listingValidation.state !== 'verified');
  const competitiveEconomy = identityUnverified
    ? unavailableCatalogEconomy('CATALOG_IDENTITY_UNVERIFIED')
    : drawerEconomicsLoading ? unavailableCatalogEconomy('CALCULATION_PENDING')
      : memoryEconomy(priceDetail?.competitiveAssessment?.competitive?.memory)
        || activeCatalog?.economics.competitive;
  const liveCatalogMismatch = priceDetail?.catalogListing === false;
  const rowReferenceNewer = Boolean(activeCatalog?.competition_reference?.source === 'ml_live'
    && priceDetail?.catalog?.syncedAt
    && Date.parse(activeCatalog.competition_reference.observedAt) > Date.parse(priceDetail.catalog.syncedAt));
  const currentDisplayedPrice = rowReferenceNewer ? activeCatalog?.price
    : priceDetail?.currentPrice ?? activeCatalog?.price;
  const competitiveDisplayedPrice = liveCatalogMismatch ? null : rowReferenceNewer
    ? activeCatalog?.price_to_win : priceDetail?.catalog
      ? priceDetail.catalog.priceToWin : activeCatalog?.price_to_win;
  const detailCompetition = activeCatalog
    ? catalogCompetitionPresentation(liveCatalogMismatch
      ? 'not_listed'
      : (rowReferenceNewer ? activeCatalog.buy_box_status : priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status))
    : null;
  const detailOperational = liveCatalogMismatch && activeCatalog ? {
    ...activeCatalog.operational,
    label: 'Não pertence ao catálogo',
    description: 'O Mercado Livre confirmou que este é um anúncio padrão.',
    tone: 'negative' as const,
  } : activeCatalog?.operational;
  const detailPriceGuidance = activeCatalog ? catalogPriceToWinPresentation({
    status: liveCatalogMismatch ? 'not_listed'
      : (rowReferenceNewer ? activeCatalog.buy_box_status : priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status),
    priceToWin: competitiveDisplayedPrice ?? null,
  }) : null;
  const actionableBoosts = (priceDetail?.catalog?.boosts || []).filter((boost) => catalogBoostPresentation(boost.status).actionable);

  return <div className={styles.page}>
    {messageContext}
    <header className={styles.header}><div><Title level={2} className={styles.title}>Catálogo</Title>
      <Text type="secondary">Veja primeiro o que precisa de ação e resolva sem sair da lista.</Text>
      {mode === 'no_catalogo' && <small className={styles.lastSync}>Dados consultados em {formatDate(lastSyncedAt)}</small>}
      {mode === 'elegiveis' && <small className={styles.lastSync}>Elegibilidade consultada em {formatDate(eligibleCheckedAt)}</small>}
      {mode === 'no_catalogo' && !visualReview && (economicsState.running || economicsState.issue) &&
        <small className={styles.compactStatus}>{economicsState.running
          ? `Calculando lucro e margem nesta página: ${economicsState.processed}/${economicsState.total}.`
          : catalogEconomicReasonLabel(economicsState.issue!)}
          {economicsState.issue && <Button type="link" size="small" onClick={() => setEconomicsRetry(value => value + 1)}>
            Tentar cálculos novamente</Button>}</small>}</div>
      <Space wrap>{mode === 'no_catalogo' && <Button icon={<FilePdfOutlined />} loading={exportingPdf}
        onClick={() => void exportPdf()}>Exportar PDF</Button>}
      {mode === 'no_catalogo' && <Button icon={<ReloadOutlined spin={refreshRunning} />} disabled={Boolean(visualReview)}
        loading={refreshRunning} onClick={() => void startRefresh()}>Atualizar dados</Button>}
      </Space></header>

    {visualReview && <Alert className={styles.visualAlert} type="warning" showIcon message="Amostra protegida, somente leitura"
      description="Os dados desta amostra servem apenas para avaliar a tela. Ações externas estão desabilitadas." />}

    <Segmented className={styles.modeSelector} value={mode} options={[
      { label: 'Anúncios de catálogo', value: 'no_catalogo' }, { label: 'Elegíveis ao catálogo', value: 'elegiveis' },
    ]} onChange={(value) => router.push(value === 'no_catalogo' ? '/catalogo/no-catalogo' : '/catalogo/elegiveis')} />

    {refreshPayload?.job && mode === 'no_catalogo' && <div className={styles.compactRefresh} role="status">
      <strong>{refreshPayload.job.presentation?.title || 'Atualizando catálogo'}</strong>
      <span>{refreshRunning && Number(refreshPayload.job.total || 0) <= 1
        ? 'Listando anúncios no Mercado Livre…'
        : `${Number(refreshPayload.job.processados || 0).toLocaleString('pt-BR')} de ${Number(refreshPayload.job.total || 0).toLocaleString('pt-BR')} processados`}</span>
      {Number(refreshPayload.job.summary?.competitionUnavailable || 0) > 0 && <span>
        {Number(refreshPayload.job.summary?.competitionUnavailable).toLocaleString('pt-BR')} sem informação de competição</span>}
      {Number(refreshPayload.job.summary?.detailsUnavailable || 0) > 0 && <span>
        {Number(refreshPayload.job.summary?.detailsUnavailable).toLocaleString('pt-BR')} sem detalhes atualizados</span>}
      {refreshRunning && <Progress percent={Number(refreshPayload.job.progresso || 0)} size="small" showInfo={false} className={styles.compactProgress} />}
      {!refreshRunning && refreshPayload.job.status !== 'completo' && <Button type="link" size="small" onClick={() => void startRefresh()}>Tentar novamente</Button>}
    </div>}

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
            pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage,
              showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'}` }} size="small" />}
      </Spin>
    </section>

    <Drawer open={Boolean(activeCatalog)} onClose={() => { if (confirmingPriceRef.current) return;
      pricingRequest.current += 1; previewRequest.current += 1; drawerEconomicsRequest.current += 1;
      setPriceDetailLoading(false); setDrawerEconomicsLoading(false); setActiveCatalog(null); }} width="min(96vw, 720px)"
      title={activeCatalog ? <div className={styles.drawerTitle}><span>Resolver anúncio</span>
        <strong>{activeCatalog.produto_nome || activeCatalog.title}</strong></div> : undefined}
      extra={activeCatalog?.permalink && !visualReview ? <Button icon={<EyeOutlined />}
        onClick={() => window.open(activeCatalog.permalink || '', '_blank', 'noopener,noreferrer')}>Abrir no ML</Button> : null}>
      {activeCatalog && <div className={styles.drawerSection}>
        <div className={`${styles.competitionHero} ${detailCompetition ? styles[detailCompetition.tone] : ''}`}>
          <span className={`${styles.statusDot} ${styles[detailOperational?.tone || activeCatalog.operational.tone]}`} />
          <div><small>Situação atual</small><strong>{detailOperational?.label || activeCatalog.operational.label}</strong>
            <p>{detailOperational?.description || activeCatalog.operational.description}</p></div></div>
        {liveCatalogMismatch && <Alert type="warning" showIcon message="Este anúncio não participa do catálogo"
          description="Ele não possui preço para ganhar e será removido desta lista na próxima atualização dos dados." />}
        {identityUnverified && <Alert type="warning" showIcon message="Vínculo de catálogo não confirmado"
          description="Confira se o produto de catálogo corresponde à quantidade e embalagem deste kit. O preço para ganhar é apenas uma referência." />}
        <div className={styles.priceOverview}><SummaryCard title="Preço atual"
          price={pricePreview ? pricePreview.currentPriceCents / 100 : currentDisplayedPrice}
          economy={pricePreview && pricePreview.currentPriceCents !== Math.round(activeCatalog.price * 100)
            ? unavailableCatalogEconomy('SNAPSHOT_CHANGED') : currentEconomy} />
          <SummaryCard title="Preço para ganhar" price={competitiveDisplayedPrice}
            economy={competitiveEconomy} empty={detailPriceGuidance && detailPriceGuidance.key !== 'available'
              ? { label: detailPriceGuidance.label, description: detailPriceGuidance.description } : undefined} /></div>

        {actionableBoosts.length > 0 && <div className={styles.actionableBoosts}><strong>O que pode melhorar a disputa</strong>
          {actionableBoosts.map((boost) => <span key={boost.id}><b>{boostLabel(boost)}</b>
            <small>{catalogBoostPresentation(boost.status).label}</small></span>)}</div>}
        {priceDetail?.catalog?.reasons?.length ? <Alert type="warning" showIcon message="O Mercado Livre informou um impedimento"
          description={priceDetail.catalog.reasons.map(catalogCompetitionReasonPresentation).join(' · ')} /> : null}
        {priceDetail?.catalog?.warning && <Alert type="warning" showIcon
          message={userSafeMessage(priceDetail.catalog.warning, 'A competição está indisponível.')} />}

        {!liveCatalogMismatch && <section className={styles.priceAction}><div><strong>Novo preço</strong>
          <small>Nenhum preço será alterado enquanto você edita o valor. Lucro e margem atualizam automaticamente.</small></div>
          <div className={styles.priceEditor}><InputNumber {...currencyInputProps} prefix="R$" min={0.01} precision={2} value={newPrice}
            onChange={(value) => setNewPrice(value ?? null)}
            disabled={Boolean(visualReview) || !activeCatalog.produto_id || confirmingPrice} /></div>
          {newPrice !== null && newPrice > 0 && (previewLoading
            ? <div className={styles.summaryCard} role="status"><small>Resultado no novo preço</small>
              <strong>{formatCurrency(newPrice)}</strong><span>Calculando tarifa, frete, lucro e margem…</span></div>
            : <SummaryCard title="Resultado no novo preço" price={newPrice}
              economy={pricePreview?.priceCents === Math.round(newPrice * 100) ? {
                status: pricePreview.status === 'estimated' ? 'available' : pricePreview.status,
                profit: pricePreview.resultCents === null ? null : pricePreview.resultCents / 100,
                marginPercent: pricePreview.marginPercent, evaluatedPriceCents: pricePreview.priceCents,
                source: 'live_saved', calculatedAt: null,
                reason: pricePreview.resultCents === null ? 'ML_UNAVAILABLE' : null,
              } : unavailableCatalogEconomy('ML_UNAVAILABLE')} />)}
          {pricePreview?.status === 'estimated' && <Text type="warning">Resultado estimado: confira as fontes antes de decidir.</Text>}
          {previewError && <Alert type={previewBlocked ? 'error' : 'warning'} showIcon message={previewError} />}
          {pricePreview?.warnings.map(warning => <Alert key={warning} type="warning" showIcon
            message={decisionWarningMessage(warning)} />)}
          {pricePreview?.automaticPricingActive && <Alert type="warning" showIcon
            message="A automação de preço será desativada no Mercado Livre antes de aplicar este valor." />}
          <Button type="primary" loading={confirmingPrice} disabled={Boolean(visualReview) || !activeCatalog.produto_id
            || !newPrice || previewLoading || previewBlocked || (!pricePreview && !previewError)}
            onClick={() => void confirmPrice()}>Confirmar alteração</Button></section>}

        <details className={styles.technicalDetails} onToggle={(event) => {
          if (event.currentTarget.open) void loadTechnicalDetail(activeCatalog);
        }}><summary>Detalhes técnicos</summary>{priceDetailLoading && <Spin size="small" />}<dl>
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
      </div>}
    </Drawer>

    <Drawer open={Boolean(activeEligible)} onClose={() => setActiveEligible(null)} width="min(96vw, 660px)"
      title={activeEligible ? <div className={styles.drawerTitle}><span>Elegibilidade ao catálogo</span>
        <strong>{activeEligible.title}</strong></div> : undefined}>
      {activeEligible && <div className={styles.drawerSection}>
        <div className={styles.eligibilityDecision}>
          <div><small>O Mercado Livre informou</small><strong>{activeEligible.eligibility_label || variationEligibilityLabel(activeEligible.eligibility_status)}</strong>
            <span>Consulta em {formatDate(eligibleCheckedAt)}</span></div>
          <div><small>Verificação no Bentevi</small><strong>{eligibilityPresentation(activeEligible.state).label}</strong>
            <span>{userSafeMessage(activeEligible.reason, 'Confira o vínculo antes de continuar.')}</span></div>
          <div><small>Próxima ação</small><strong>{eligibilityPresentation(activeEligible.state).action}</strong>
            <span>{activeEligible.state === 'ready'
              ? 'Confira o produto no Bentevi e a opção de inclusão no catálogo na conta do Mercado Livre. A criação a partir deste anúncio padrão ainda não está disponível no Bentevi.'
              : activeEligible.state === 'already_opted_in'
                ? 'Confira o anúncio no Mercado Livre. Não é necessário criar outro por esta tela.'
                : 'Corrija ou confirme a informação indicada e consulte a elegibilidade novamente.'}</span></div>
        </div>
        <div className={styles.eligibleSummary}><span><small>Produto Bentevi</small>
          <strong>{activeEligible.local_product_name || 'Não vinculado'}</strong></span>
        <span><small>Produto de catálogo confirmado</small><strong>{activeEligible.catalog_product_name || 'Não identificado'}</strong></span></div>
        {activeEligible.catalog_product_id_sugerido && <Text type="secondary">Sugestão para revisão, ainda não confirmada: {activeEligible.catalog_product_name_sugerido || activeEligible.catalog_product_id_sugerido}.</Text>}
        {activeEligible.catalog_product_warning && <Alert type="warning" showIcon message="Compatibilidade precisa de atenção"
          description={userSafeMessage(activeEligible.catalog_product_warning, 'Confira o produto sugerido.')} />}
        {activeEligible.variation_eligibility?.length > 0 && <div className={styles.variationList}>
          {activeEligible.variation_eligibility.map((variation) => <span key={String(variation.id)}><b>Variação {variation.id}</b>
            <small>{variationEligibilityLabel(variation.status)} · Produto {variation.catalog_product_id || 'não associado'}
              {variation.catalog_product_status && ` · ${variation.catalog_product_status === 'active' ? 'ativo' : 'inativo'}`}</small></span>)}</div>}
        {activeEligible.state !== 'already_opted_in' && activeEligible.local_product_id && <Button type={activeEligible.state === 'ready' ? 'primary' : 'default'}
          onClick={() => router.push(`/produtos/${activeEligible.local_product_id}`)}>Abrir produto no Bentevi</Button>}
        {activeEligible.permalink && !visualReview && <Button href={activeEligible.permalink} target="_blank" rel="noopener noreferrer">
          Abrir anúncio no Mercado Livre</Button>}
        <details className={styles.technicalDetails}><summary>Detalhes técnicos</summary><dl>
          <div><dt>Anúncio padrão</dt><dd><MercadoLivreCodeLink code={activeEligible.ml_item_id}
            href={visualReview ? null : activeEligible.permalink} label="Anúncio padrão" /></dd></div>
          <div><dt>Produto de catálogo</dt><dd><MercadoLivreCodeLink
            code={activeEligible.catalog_product_id}
            href={visualReview ? null : buildMercadoLivreCatalogProductUrl(activeEligible.catalog_product_id)}
            label="Produto de catálogo" /></dd></div>
          <div><dt>SKU</dt><dd>{activeEligible.seller_sku || 'Não informado'}</dd></div>
        </dl></details>
      </div>}
    </Drawer>

  </div>;
}

function PriceResult({ price, economy, referenceLabel }: {
  price: number; economy: EconomicSummary; referenceLabel?: string;
}) {
  const matched = catalogEconomyAtPrice(economy, price);
  return <div className={styles.valueCell}><strong>{formatCurrency(price)}</strong>
    {matched.profit == null || matched.marginPercent == null ? <small>{catalogEconomicReasonLabel(matched.reason)}</small>
      : <small className={matched.profit < 0 ? styles.negative : styles.positive}>
        {matched.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(matched.profit))} · {matched.marginPercent.toFixed(2)}%
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
  const matched = catalogEconomyAtPrice(economy, hasPrice ? Number(price) : null);
  return <div className={styles.summaryCard}><small>{title}</small>
    <strong>{hasPrice ? formatCurrency(Number(price)) : (empty?.label || 'Não informado')}</strong>
    {!hasPrice && empty ? <span>{empty.description}</span>
      : matched.profit == null || matched.marginPercent == null
        ? <span>{catalogEconomicReasonLabel(matched.reason)}</span>
      : <span className={matched.profit < 0 ? styles.negative : styles.positive}>
        {matched.profit < 0 ? 'Prejuízo' : 'Lucro'} {formatCurrency(Math.abs(matched.profit))} · {matched.marginPercent.toFixed(2)}%
      </span>}
  </div>;
}
