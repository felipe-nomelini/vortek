'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Descriptions, Drawer, Dropdown, Empty, Image, Input, InputNumber, Modal, Progress, Segmented, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { ArrowRightOutlined, EllipsisOutlined, EyeOutlined, FilePdfOutlined, LoadingOutlined, ReloadOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import ProgressModal, { type ProgressStep } from '@/components/modals/ProgressModal';
import { useMlPricePublishTracking } from '@/hooks/useMlPricePublishTracking';
import { formatCurrency } from '@/lib/format';
import { buildCatalogOptinTargets, catalogCompetitionPresentation, type CatalogEligibilityActionState, type CatalogOptinTarget, type CatalogVariationEligibility } from '@/lib/catalogo/dashboard';
import styles from './CatalogoView.module.css';

const { Text, Title } = Typography;
const PAGE_SIZE = 100;
const REFRESH_JOB_STORAGE_KEY = 'catalogo_no_catalogo_refresh_job_id';
export type CatalogoMode = 'no_catalogo' | 'elegiveis';

type VisualReviewMetadata = { enabled: true; source: string; capturedAt: string; expiresAt: string; itemCount: number; simulatedEligibility?: boolean };
type NoCatalogoRow = { anuncio_id: string; ml_item_id: string; relacionado_id: string | null; related_permalink?: string | null; related_status?: string | null; title: string; seller_sku: string | null; sku_local: string | null; produto_id: string | null; produto_nome?: string | null; catalog_product_id: string | null; status: string | null; buy_box_status: string | null; price_to_win: number | null; price: number; permalink: string | null; thumbnail: string | null; last_updated: string | null; isHomologationFixture?: boolean };
type ElegivelRow = { ml_item_id: string; title: string; seller_sku: string | null; local_product_id?: string | null; local_product_name?: string | null; status: string | null; status_label?: string | null; price: number; permalink: string | null; thumbnail: string | null; catalog_product_id: string | null; catalog_product_name?: string | null; catalog_product_id_sugerido?: string | null; catalog_product_name_sugerido?: string | null; catalog_product_warning?: string | null; catalog_product_status?: string | null; eligibility_status: string | null; eligibility_label?: string | null; buy_box_eligible: boolean; eligibility_reason: string | null; variation_eligibility: CatalogVariationEligibility[]; state: CatalogEligibilityActionState; reason: string; last_updated: string | null; isHomologationFixture?: boolean };
type CatalogMetrics = { total: number; winning: number; sharingFirstPlace: number; competing: number; outside: number };
type EligibleMetrics = { total: number; ready: number; reviewRequired: number; catalogProductUnavailable: number; localProductMissing: number };
type RefreshStatusPayload = { success?: boolean; error?: string; job?: { id: string; status: string; progresso?: number; processados?: number; total?: number; last_event?: { message?: string | null } | null } | null; events?: Array<{ stage?: string | null; message?: string | null; progress?: number | null }>; failures?: string[] };
type AnalisePrecoRow = { ml_item_id: string; classe: 'ajustar_para_ganhar_sem_prejuizo' | 'nao_viavel_ganhar_sem_prejuizo' | 'dados_insuficientes' };
type PriceDetail = { currentPrice?: number; currentProfit?: number | null; automaticPricing?: { active?: boolean }; catalog?: { rawStatus?: string | null; priceToWin?: number | null; winner?: { itemId?: string | null; price?: number | null } | null; boosts?: Array<{ id: string; status: string; description: string }>; reasons?: string[]; warning?: string | null; syncedAt?: string | null } | null };

const statusOptions = [{ value: 'all', label: 'Todos os status' }, { value: 'active', label: 'Ativos' }, { value: 'paused', label: 'Pausados' }, { value: 'closed', label: 'Encerrados' }];
const competitionOptions = [{ value: 'all', label: 'Toda competição' }, { value: 'winning', label: 'Ganhando' }, { value: 'sharing_first_place', label: 'Dividindo 1º lugar' }, { value: 'competing', label: 'Competindo' }, { value: 'outside', label: 'Fora da competição' }];
const eligibilityOptions = [{ value: 'all', label: 'Todas as situações' }, { value: 'ready', label: 'Prontos para criar' }, { value: 'review_required', label: 'Revisão necessária' }, { value: 'catalog_product_unavailable', label: 'Produto indisponível' }, { value: 'local_product_missing', label: 'Sem vínculo Bentevi' }];

function statusPresentation(status: unknown) {
  const value = String(status || '').toLowerCase();
  if (value === 'active' || value === 'ativo') return { label: 'Ativo', color: 'green' };
  if (value === 'paused' || value === 'pausado') return { label: 'Pausado', color: 'orange' };
  if (value === 'closed' || value === 'encerrado') return { label: 'Encerrado', color: 'default' };
  if (value === 'under_review') return { label: 'Em revisão', color: 'blue' };
  return { label: String(status || 'Não informado'), color: 'default' };
}
function eligibilityPresentation(state: CatalogEligibilityActionState) {
  if (state === 'ready') return { label: 'Pronto para criar', color: 'green', action: 'Criar anúncio' };
  if (state === 'review_required') return { label: 'Revisão necessária', color: 'orange', action: 'Revisar vínculo' };
  if (state === 'catalog_product_unavailable') return { label: 'Produto indisponível', color: 'red', action: 'Ver impedimento' };
  return { label: 'Sem vínculo Bentevi', color: 'default', action: 'Ver vínculo' };
}
function formatDate(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não informado'; }
function buildRefreshSteps(payload: RefreshStatusPayload | null, calculating = false): ProgressStep[] {
  const stages = [['scan_catalog', 'Listando anúncios de catálogo'], ['fetch_details', 'Consultando detalhes'], ['fetch_price_to_win', 'Consultando competição'], ['fetch_related', 'Relacionando anúncios padrão'], ['match_products', 'Vinculando produtos Bentevi'], ['save_snapshot', 'Salvando a análise']];
  const events = payload?.events || [];
  const active = events.at(-1)?.stage || null;
  const activeIndex = active === 'completed' ? stages.length : stages.findIndex(([key]) => key === active);
  const jobStatus = payload?.job?.status;
  const done = jobStatus === 'completo' || jobStatus === 'completo_parcial';
  const failed = ['erro', 'failed_auth', 'cancelado'].includes(String(jobStatus));
  const steps = stages.map(([key, label], index): ProgressStep => {
    const event = [...events].reverse().find((entry) => entry.stage === key);
    if (failed && index === Math.max(activeIndex, 0)) return { label, status: 'error', error: payload?.failures?.[0] || payload?.job?.last_event?.message || 'Falha na atualização.' };
    if (done || index < activeIndex) return { label, status: 'success', detail: event?.message || 'Concluído.' };
    if (index === activeIndex || (activeIndex < 0 && index === 0)) return { label, status: 'loading', detail: event?.message || 'Em execução.' };
    return { label, status: 'pending', detail: 'Aguardando etapa anterior.' };
  });
  steps.push({ label: 'Calculando oportunidades de preço', status: calculating ? 'loading' : done ? 'success' : failed ? 'warning' : 'pending', detail: calculating ? 'Comparando preço e rentabilidade.' : done ? 'Análise concluída.' : 'Aguardando atualização.' });
  return steps;
}

export default function CatalogoView({ mode }: { mode: CatalogoMode }) {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const [modalApi, modalContext] = Modal.useModal();
  const { hasOpenTracking, startTracking, progressModalProps } = useMlPricePublishTracking(messageApi);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<NoCatalogoRow[]>([]);
  const [eligibleRows, setEligibleRows] = useState<ElegivelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusMl, setStatusMl] = useState('all');
  const [competition, setCompetition] = useState('all');
  const [actionState, setActionState] = useState('all');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState('ml_item_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [catalogMetrics, setCatalogMetrics] = useState<CatalogMetrics>({ total: 0, winning: 0, sharingFirstPlace: 0, competing: 0, outside: 0 });
  const [eligibleMetrics, setEligibleMetrics] = useState<EligibleMetrics>({ total: 0, ready: 0, reviewRequired: 0, catalogProductUnavailable: 0, localProductMissing: 0 });
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const [activeCatalog, setActiveCatalog] = useState<NoCatalogoRow | null>(null);
  const [activeEligible, setActiveEligible] = useState<ElegivelRow | null>(null);
  const [priceDetail, setPriceDetail] = useState<PriceDetail | null>(null);
  const [priceDetailLoading, setPriceDetailLoading] = useState(false);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [updatingPrice, setUpdatingPrice] = useState(false);
  const [opportunityIds, setOpportunityIds] = useState<Set<string> | null>(null);
  const [refreshPayload, setRefreshPayload] = useState<RefreshStatusPayload | null>(null);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisSteps, setAnalysisSteps] = useState<ProgressStep[]>(buildRefreshSteps(null));
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [selectedEligibleKeys, setSelectedEligibleKeys] = useState<React.Key[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSteps, setBatchSteps] = useState<ProgressStep[]>([]);
  const batchCancelled = useRef(false);
  const batchAbort = useRef<AbortController | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search.trim()) params.set('search', search.trim());
    if (statusMl !== 'all') params.set('statusMl', statusMl);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    if (mode === 'no_catalogo') { if (competition !== 'all') params.set('buyBox', competition); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder); }
    else if (actionState !== 'all') params.set('actionState', actionState);
    return params.toString();
  }, [actionState, competition, mode, page, priceMax, priceMin, search, sortBy, sortOrder, statusMl]);

  const fetchData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const endpoint = mode === 'no_catalogo' ? '/api/catalogo/no-catalogo' : '/api/catalogo/elegiveis';
      const response = await fetch(`${endpoint}?${queryString}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(payload?.erro || 'Falha ao carregar o catálogo.');
      setTotal(Number(payload.total || 0));
      setVisualReview(payload?.visualReview?.enabled === true ? payload.visualReview : null);
      if (mode === 'no_catalogo') {
        setRows(Array.isArray(payload.data) ? payload.data : []);
        setCatalogMetrics({ total: Number(payload.metrics?.total || 0), winning: Number(payload.metrics?.winning || 0), sharingFirstPlace: Number(payload.metrics?.sharingFirstPlace || 0), competing: Number(payload.metrics?.competing || 0), outside: Number(payload.metrics?.outside || 0) });
        setLastSyncedAt(payload.lastSyncedAt || null);
      } else {
        setEligibleRows(Array.isArray(payload.data) ? payload.data : []);
        setEligibleMetrics({ total: Number(payload.metrics?.total || 0), ready: Number(payload.metrics?.ready || 0), reviewRequired: Number(payload.metrics?.reviewRequired || 0), catalogProductUnavailable: Number(payload.metrics?.catalogProductUnavailable || 0), localProductMissing: Number(payload.metrics?.localProductMissing || 0) });
        setSelectedEligibleKeys([]);
      }
    } catch (error: any) {
      if (sequence === requestSequence.current) { setRows([]); setEligibleRows([]); setTotal(0); messageApi.error(error?.message || 'Erro de conexão ao carregar o catálogo.'); }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [messageApi, mode, queryString]);
  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [actionState, competition, mode, priceMax, priceMin, search, statusMl]);

  const fetchRefreshStatus = useCallback(async (jobId?: string) => {
    const url = jobId ? `/api/catalogo/no-catalogo/refresh/status?jobId=${encodeURIComponent(jobId)}` : '/api/catalogo/no-catalogo/refresh/status';
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Falha ao consultar a atualização.');
    return payload as RefreshStatusPayload;
  }, []);
  const stopRefreshPolling = useCallback(() => { if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = null; if (typeof window !== 'undefined') window.localStorage.removeItem(REFRESH_JOB_STORAGE_KEY); }, []);
  const pollRefresh = useCallback(async function poll(jobId: string) {
    try {
      const payload = await fetchRefreshStatus(jobId); setRefreshPayload(payload);
      const status = payload.job?.status;
      if (['pendente', 'rodando', 'on_hold'].includes(String(status))) { setRefreshRunning(true); refreshTimer.current = setTimeout(() => void poll(jobId), 2500); return; }
      stopRefreshPolling(); setRefreshRunning(false);
      if (status === 'completo' || status === 'completo_parcial') void fetchData();
      if (['erro', 'failed_auth', 'cancelado'].includes(String(status))) messageApi.error(payload.failures?.[0] || payload.job?.last_event?.message || 'A atualização falhou.');
    } catch (error: any) { stopRefreshPolling(); setRefreshRunning(false); messageApi.error(error?.message || 'Falha ao acompanhar a atualização.'); }
  }, [fetchData, fetchRefreshStatus, messageApi, stopRefreshPolling]);
  const trackRefresh = useCallback((jobId: string) => { stopRefreshPolling(); setRefreshRunning(true); if (typeof window !== 'undefined') window.localStorage.setItem(REFRESH_JOB_STORAGE_KEY, jobId); void pollRefresh(jobId); }, [pollRefresh, stopRefreshPolling]);
  useEffect(() => {
    if (mode !== 'no_catalogo') return;
    const persisted = typeof window !== 'undefined' ? window.localStorage.getItem(REFRESH_JOB_STORAGE_KEY) : null;
    void (async () => { try { const payload = await fetchRefreshStatus(persisted || undefined); if (!payload.job?.id) return; setRefreshPayload(payload); if (['pendente', 'rodando', 'on_hold'].includes(payload.job.status)) trackRefresh(payload.job.id); } catch { /* não há job anterior */ } })();
    return stopRefreshPolling;
  }, [fetchRefreshStatus, mode, stopRefreshPolling, trackRefresh]);
  const startRefresh = useCallback(async () => {
    if (visualReview) return void messageApi.info('A amostra protegida não executa sincronizações externas.');
    const response = await fetch('/api/catalogo/no-catalogo/refresh/job', { method: 'POST' }); const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.jobId) return void messageApi.error(payload?.error || 'Falha ao iniciar a atualização.');
    trackRefresh(String(payload.jobId));
  }, [messageApi, trackRefresh, visualReview]);
  const runAnalysis = useCallback(async () => {
    if (analysisRunning || visualReview) { if (visualReview) messageApi.info('A reanálise externa está desabilitada na amostra protegida.'); return; }
    setAnalysisRunning(true); setAnalysisModalOpen(true); setAnalysisSteps(buildRefreshSteps(null));
    try {
      const startResponse = await fetch('/api/catalogo/no-catalogo/refresh/job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'full' }) });
      const startPayload = await startResponse.json().catch(() => ({})); if (!startResponse.ok || !startPayload?.jobId) throw new Error(startPayload?.error || 'Falha ao iniciar a análise.');
      let statusPayload: RefreshStatusPayload;
      do { statusPayload = await fetchRefreshStatus(String(startPayload.jobId)); setAnalysisSteps(buildRefreshSteps(statusPayload)); if (['erro', 'failed_auth', 'cancelado'].includes(String(statusPayload.job?.status))) throw new Error(statusPayload.failures?.[0] || statusPayload.job?.last_event?.message || 'A atualização falhou.'); if (!['completo', 'completo_parcial'].includes(String(statusPayload.job?.status))) await new Promise((resolve) => setTimeout(resolve, 1500)); } while (!['completo', 'completo_parcial'].includes(String(statusPayload.job?.status)));
      setAnalysisSteps(buildRefreshSteps(statusPayload, true));
      const response = await fetch('/api/catalogo/no-catalogo/analise-preco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshMode: 'none' }) });
      const payload = await response.json().catch(() => ({})); if (!response.ok || !payload?.success) throw new Error(payload?.erro || 'Falha ao calcular as oportunidades.');
      const analysis = (Array.isArray(payload.data) ? payload.data : []) as AnalisePrecoRow[];
      setOpportunityIds(new Set(analysis.filter((row) => row.classe === 'ajustar_para_ganhar_sem_prejuizo').map((row) => row.ml_item_id))); setCompetition('all'); setPage(1); setAnalysisSteps(buildRefreshSteps(statusPayload)); await fetchData(); messageApi.success(`${analysis.length} anúncio(s) analisado(s).`);
    } catch (error: any) { setAnalysisSteps((current) => current.map((step) => step.status === 'loading' ? { ...step, status: 'error', error: error?.message || 'Falha na análise.' } : step)); messageApi.error(error?.message || 'Falha na análise.'); }
    finally { setAnalysisRunning(false); }
  }, [analysisRunning, fetchData, fetchRefreshStatus, messageApi, visualReview]);

  const loadPriceDetail = useCallback(async (row: NoCatalogoRow) => {
    setActiveCatalog(row); setPriceDetail(null); setNewPrice(row.price_to_win || row.price);
    if (visualReview || !row.produto_id) return;
    setPriceDetailLoading(true);
    try { const params = new URLSearchParams({ produtoId: row.produto_id, mlItemId: row.ml_item_id }); const response = await fetch(`/api/ml/anuncio/preco-detalhe?${params}`, { cache: 'no-store' }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar a disputa.'); setPriceDetail(payload); setNewPrice(payload?.catalog?.priceToWin || payload?.currentPrice || row.price); }
    catch (error: any) { messageApi.error(error?.message || 'Falha ao carregar a disputa.'); } finally { setPriceDetailLoading(false); }
  }, [messageApi, visualReview]);
  const savePrice = useCallback(async () => {
    if (!activeCatalog?.produto_id || !newPrice || visualReview) return;
    if (hasOpenTracking) return void messageApi.warning('Já existe uma publicação de preço em acompanhamento.');
    setUpdatingPrice(true);
    try { const response = await fetch('/api/ml/anuncio/atualizar-preco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtoId: activeCatalog.produto_id, targetPrice: newPrice, source: 'catalog_price_to_win' }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error || 'Falha ao atualizar o preço.'); if (payload?.price_updated) { messageApi.success('Preço atualizado no Mercado Livre.'); void fetchData(); return; } const outboxId = String(payload?.outboxId || '').trim(); if (!payload?.queued_publish || !outboxId) throw new Error('A atualização não foi confirmada nem enfileirada.'); startTracking({ outboxId, produtoId: activeCatalog.produto_id, retry: () => void savePrice() }); messageApi.success('Atualização enfileirada para publicação.'); }
    catch (error: any) { messageApi.error(error?.message || 'Falha ao atualizar o preço.'); } finally { setUpdatingPrice(false); }
  }, [activeCatalog, fetchData, hasOpenTracking, messageApi, newPrice, startTracking, visualReview]);

  const executeOptinTargets = useCallback(async (targets: CatalogOptinTarget[]) => {
    if (!targets.length || visualReview) return;
    batchCancelled.current = false; setBatchRunning(true); setBatchOpen(true); setBatchSteps(targets.map((target) => ({ label: target.variationId ? `Variação ${target.variationId}` : `Anúncio ${target.itemId}`, status: 'pending', detail: `${target.itemId} → produto ${target.catalogProductId}` })));
    let successes = 0;
    for (let index = 0; index < targets.length; index += 1) {
      if (batchCancelled.current) break;
      const target = targets[index]; setBatchSteps((current) => current.map((step, i) => i === index ? { ...step, status: 'loading' } : step)); const controller = new AbortController(); batchAbort.current = controller;
      try { const response = await fetch('/api/catalogo/optin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), signal: controller.signal }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.erro || 'Falha ao criar o anúncio.'); successes += 1; setBatchSteps((current) => current.map((step, i) => i === index ? { ...step, status: 'success', detail: `Criado: ${payload?.catalog_item_id || payload?.data?.id || 'ID não retornado'}` } : step)); }
      catch (error: any) { const cancelled = batchCancelled.current || error?.name === 'AbortError'; setBatchSteps((current) => current.map((step, i) => i === index ? { ...step, status: cancelled ? 'warning' : 'error', error: cancelled ? undefined : error?.message, detail: cancelled ? 'Cancelado pelo usuário.' : step.detail } : step)); if (cancelled) break; }
    }
    setBatchRunning(false); setSelectedEligibleKeys([]); batchAbort.current = null; if (successes) { messageApi.success(`${successes} anúncio(s) de catálogo criado(s).`); void fetchData(); }
  }, [fetchData, messageApi, visualReview]);
  const confirmOptin = useCallback((selected: ElegivelRow[]) => {
    const targets = selected.flatMap((row) => buildCatalogOptinTargets(row));
    if (visualReview) return void messageApi.info('A criação está desabilitada na amostra protegida.');
    if (!targets.length) return void messageApi.warning('Nenhum item ou variação está pronto para criação.');
    modalApi.confirm({ title: targets.length === 1 ? 'Criar anúncio de catálogo?' : `Criar ${targets.length} anúncios de catálogo?`, content: 'Cada variação gera um anúncio separado. Em domínios obrigatórios ou exclusivos, o Mercado Livre pode moderar ou inativar o anúncio padrão.', okText: 'Confirmar criação', cancelText: 'Cancelar', onOk: () => executeOptinTargets(targets) });
  }, [executeOptinTargets, messageApi, modalApi, visualReview]);
  const selectedEligibleRows = useMemo(() => { const selected = new Set(selectedEligibleKeys.map(String)); return eligibleRows.filter((row) => selected.has(row.ml_item_id)); }, [eligibleRows, selectedEligibleKeys]);
  const visibleCatalogRows = useMemo(() => opportunityIds ? rows.filter((row) => opportunityIds.has(row.ml_item_id)) : rows, [opportunityIds, rows]);

  const catalogColumns: TableProps<NoCatalogoRow>['columns'] = useMemo(() => [
    { title: 'Anúncio de catálogo', key: 'listing', width: 285, sorter: true, render: (_, row) => { const status = statusPresentation(row.status); return <div className={styles.listingCell}>{row.thumbnail ? <Image src={row.thumbnail} alt="" width={46} height={46} preview={false} className={styles.thumbnail} /> : <span className={styles.thumbnailFallback}><ShopOutlined /></span>}<div><strong>{row.title || 'Título não informado'}</strong><span className={styles.identifier}>{row.ml_item_id}</span><Tag color={status.color}>{status.label}</Tag></div></div>; } },
    { title: 'Produto Bentevi', key: 'product', width: 220, render: (_, row) => <div className={styles.stackCell}><strong>{row.produto_nome || row.title || 'Produto não vinculado'}</strong><span>SKU {row.sku_local || 'não informado'}</span></div> },
    { title: 'Anúncio padrão relacionado', key: 'related', width: 205, render: (_, row) => <div className={styles.stackCell}><strong className={styles.identifier}>{row.relacionado_id || 'Não localizado'}</strong><span>{row.relacionado_id ? `Publicação padrão · ${statusPresentation(row.related_status).label}` : 'Relação ainda não informada pelo ML'}</span></div> },
    { title: 'Competição', key: 'competition', width: 230, sorter: true, render: (_, row) => { const state = catalogCompetitionPresentation(row.buy_box_status); return <div className={styles.competitionCell}><span className={`${styles.competitionDot} ${styles[state.tone]}`} /><div><strong>{state.label}</strong><span>{state.description}</span></div></div>; } },
    { title: 'Preço e resultado', key: 'price', width: 190, sorter: true, render: (_, row) => { const target = Number(row.price_to_win); const delta = Number.isFinite(target) && target > 0 ? target - Number(row.price || 0) : null; return <div className={styles.valueCell}><strong>{formatCurrency(row.price)}</strong><span>Para ganhar: {target > 0 ? formatCurrency(target) : 'não informado'}</span>{delta !== null && <small className={delta < 0 ? styles.negative : styles.positive}>{delta === 0 ? 'Preço já alinhado' : `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`}</small>}</div>; } },
    { title: 'Ação', key: 'action', width: 165, fixed: 'right', render: (_, row) => <Space.Compact><Button icon={<EyeOutlined />} onClick={() => void loadPriceDetail(row)}>Analisar disputa</Button><Dropdown menu={{ items: [{ key: 'ml', label: 'Abrir no Mercado Livre', disabled: !row.permalink || Boolean(visualReview) }], onClick: ({ key }) => { if (key === 'ml' && row.permalink) window.open(row.permalink, '_blank', 'noopener,noreferrer'); } }}><Button icon={<EllipsisOutlined />} /></Dropdown></Space.Compact> },
  ], [loadPriceDetail, visualReview]);
  const eligibleColumns: TableProps<ElegivelRow>['columns'] = useMemo(() => [
    { title: 'Anúncio padrão', key: 'listing', width: 300, render: (_, row) => { const status = statusPresentation(row.status); return <div className={styles.listingCell}>{row.thumbnail ? <Image src={row.thumbnail} alt="" width={46} height={46} preview={false} className={styles.thumbnail} /> : <span className={styles.thumbnailFallback}><ShopOutlined /></span>}<div><strong>{row.title || 'Título não informado'}</strong><span className={styles.identifier}>{row.ml_item_id} · Padrão</span><Tag color={status.color}>{status.label}</Tag></div></div>; } },
    { title: 'Produto Bentevi', key: 'product', width: 220, render: (_, row) => <div className={styles.stackCell}><strong>{row.local_product_name || 'Produto não vinculado'}</strong><span>SKU {row.seller_sku || 'não informado'}</span></div> },
    { title: 'Produto de catálogo sugerido', key: 'catalogProduct', width: 275, render: (_, row) => <div className={styles.stackCell}><strong>{row.catalog_product_name_sugerido || row.catalog_product_name || row.title || 'Produto não identificado'}</strong><span className={styles.identifier}>{row.catalog_product_id_sugerido || row.catalog_product_id || 'ID não informado'}</span><small>Página de produto do Mercado Livre</small></div> },
    { title: 'Elegibilidade', key: 'eligibility', width: 250, render: (_, row) => { const presentation = eligibilityPresentation(row.state); const ready = (row.variation_eligibility || []).filter((variation) => String(variation.status || '').toUpperCase() === 'READY_FOR_OPTIN').length; return <div className={styles.stackCell}><Tag color={presentation.color}>{presentation.label}</Tag><span>{ready ? `${ready} variação(ões) pronta(s)` : row.eligibility_label || 'Situação não informada'}</span><small>{row.reason}</small></div>; } },
    { title: 'Próxima ação', key: 'action', width: 180, fixed: 'right', render: (_, row) => { const presentation = eligibilityPresentation(row.state); return <Button type={row.state === 'ready' ? 'primary' : 'default'} icon={row.state === 'ready' ? <ArrowRightOutlined /> : <EyeOutlined />} onClick={() => setActiveEligible(row)}>{presentation.action}</Button>; } },
  ], []);
  const handleCatalogTableChange: TableProps<NoCatalogoRow>['onChange'] = (pagination, _filters, sorter) => { setPage(Number(pagination.current || 1)); const current = Array.isArray(sorter) ? sorter[0] : sorter; if (!current?.order) return; const mapping: Record<string, string> = { listing: 'ml_item_id', competition: 'buy_box_status', price: 'price' }; setSortBy(mapping[String(current.columnKey)] || 'ml_item_id'); setSortOrder(current.order === 'ascend' ? 'asc' : 'desc'); };
  const exportPdf = useCallback(async () => { setExportingPdf(true); try { const params = new URLSearchParams(queryString); params.delete('page'); params.delete('pageSize'); const response = await fetch(`/api/catalogo/no-catalogo/exportar-pdf?${params}`, { cache: 'no-store' }); if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.erro || 'Falha ao gerar o PDF.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'catalogo-bentevi.pdf'; anchor.click(); URL.revokeObjectURL(url); } catch (error: any) { messageApi.error(error?.message || 'Falha ao exportar o PDF.'); } finally { setExportingPdf(false); } }, [messageApi, queryString]);
  const queueItems = mode === 'no_catalogo' ? [['all', 'Todos', catalogMetrics.total], ['winning', 'Ganhando', catalogMetrics.winning], ['sharing_first_place', 'Dividindo 1º lugar', catalogMetrics.sharingFirstPlace], ['competing', 'Competindo', catalogMetrics.competing], ['outside', 'Fora da competição', catalogMetrics.outside]] as const : [['all', 'Todos', eligibleMetrics.total], ['ready', 'Prontos para criar', eligibleMetrics.ready], ['review_required', 'Revisão necessária', eligibleMetrics.reviewRequired], ['catalog_product_unavailable', 'Produto indisponível', eligibleMetrics.catalogProductUnavailable], ['local_product_missing', 'Sem vínculo Bentevi', eligibleMetrics.localProductMissing]] as const;

  return <div className={styles.page}>
    {messageContext}{modalContext}
    <header className={styles.header}><div><Title level={2} className={styles.title}>Catálogo</Title><Text type="secondary">Entenda a origem, o vínculo e a próxima decisão de cada publicação.</Text>{mode === 'no_catalogo' && <small className={styles.lastSync}>Última análise: {formatDate(lastSyncedAt)}</small>}</div><Space wrap>{mode === 'no_catalogo' && <Button icon={<FilePdfOutlined />} loading={exportingPdf} onClick={() => void exportPdf()}>Exportar PDF</Button>}{mode === 'no_catalogo' && <Button icon={<ReloadOutlined spin={refreshRunning} />} disabled={Boolean(visualReview)} loading={refreshRunning} onClick={() => void startRefresh()}>Atualizar dados</Button>}{mode === 'no_catalogo' && <Button type="primary" disabled={Boolean(visualReview)} loading={analysisRunning} onClick={() => void runAnalysis()}>Reanalisar oportunidades</Button>}{mode === 'elegiveis' && <Button type="primary" disabled={!selectedEligibleRows.length || Boolean(visualReview)} onClick={() => confirmOptin(selectedEligibleRows)}>Criar selecionados ({selectedEligibleRows.length})</Button>}</Space></header>
    {visualReview && <Alert className={styles.visualAlert} type="warning" showIcon message="Amostra real protegida para homologação" description={visualReview.simulatedEligibility ? 'Produtos e anúncios vêm da amostra real somente leitura; as situações de elegibilidade são simuladas apenas para avaliação deste fluxo. Nenhuma ação externa está habilitada.' : 'Os anúncios vêm da amostra real somente leitura. Sincronização, preço, criação e links externos permanecem desabilitados.'} />}
    <section className={styles.domainGuide}><Segmented block value={mode} options={[{ label: 'Anúncios de catálogo', value: 'no_catalogo' }, { label: 'Elegíveis ao catálogo', value: 'elegiveis' }]} onChange={(value) => router.push(value === 'no_catalogo' ? '/catalogo/no-catalogo' : '/catalogo/elegiveis')} /><div className={styles.relationshipGuide}><span><b>Anúncio padrão</b><small>publicação original da loja</small></span><ArrowRightOutlined /><span><b>Produto de catálogo</b><small>página de produto do ML</small></span><ArrowRightOutlined /><span><b>Anúncio de catálogo</b><small>publicação que disputa vendas</small></span></div></section>
    {refreshPayload?.job && mode === 'no_catalogo' && <Alert className={styles.jobAlert} type={refreshPayload.failures?.length ? 'error' : refreshRunning ? 'info' : 'success'} showIcon message={`Atualização do catálogo · ${refreshPayload.job.status === 'on_hold' ? 'aguardando continuação' : refreshPayload.job.status}`} description={<div className={styles.jobDescription}><span>{refreshPayload.job.last_event?.message || 'Acompanhando o processamento.'}</span><Progress percent={Number(refreshPayload.job.progresso || 0)} status={refreshPayload.failures?.length ? 'exception' : refreshRunning ? 'active' : 'success'} size="small" />{refreshPayload.failures?.[0] && <small>{refreshPayload.failures[0]}</small>}</div>} />}
    <Segmented className={styles.quickViews} value={mode === 'no_catalogo' ? competition : actionState} onChange={(value) => mode === 'no_catalogo' ? setCompetition(String(value)) : setActionState(String(value))} options={queueItems.map(([value, label, count]) => ({ value, label: <span className={styles.quickViewLabel}>{label}<b>{count.toLocaleString('pt-BR')}</b></span> }))} />
    <section className={styles.filterBar}><Input className={styles.search} prefix={<SearchOutlined />} placeholder="Buscar por produto, SKU ou ID" allowClear value={search} onChange={(event) => setSearch(event.target.value)} /><Select value={statusMl} options={statusOptions} onChange={setStatusMl} /><Select value={mode === 'no_catalogo' ? competition : actionState} options={mode === 'no_catalogo' ? competitionOptions : eligibilityOptions} onChange={(value) => mode === 'no_catalogo' ? setCompetition(value) : setActionState(value)} /><Space.Compact className={styles.priceRange}><InputNumber prefix="R$" placeholder="Preço mín." value={priceMin} onChange={(value) => setPriceMin(value ?? null)} /><InputNumber prefix="R$" placeholder="Preço máx." value={priceMax} onChange={(value) => setPriceMax(value ?? null)} /></Space.Compact>{mode === 'no_catalogo' && opportunityIds && <Button onClick={() => setOpportunityIds(null)}>Exibindo {visibleCatalogRows.length} oportunidades · Limpar</Button>}</section>
    <section className={styles.tableCard}><Spin spinning={loading} indicator={<LoadingOutlined className={styles.loadingIcon} spin />}>{!loading && total === 0 ? <Empty description="Nenhum anúncio encontrado com estes filtros" /> : mode === 'no_catalogo' ? <ResizableTable<NoCatalogoRow> className={styles.table} storageKey="bnt-d12-catalog-listings" rowKey="ml_item_id" dataSource={visibleCatalogRows} columns={catalogColumns} onChange={handleCatalogTableChange} pagination={{ current: page, pageSize: PAGE_SIZE, total: opportunityIds ? visibleCatalogRows.length : total, showSizeChanger: false, showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'} de catálogo` }} scroll={{ x: 1300 }} size="small" /> : <ResizableTable<ElegivelRow> className={styles.table} storageKey="bnt-d12-catalog-eligible" rowKey="ml_item_id" dataSource={eligibleRows} columns={eligibleColumns} rowSelection={{ selectedRowKeys: selectedEligibleKeys, onChange: setSelectedEligibleKeys, getCheckboxProps: (row) => ({ disabled: row.state !== 'ready' || Boolean(visualReview) }) }} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `${count} anúncio${count === 1 ? '' : 's'} padrão` }} scroll={{ x: 1300 }} size="small" />}</Spin></section>

    <Drawer open={Boolean(activeCatalog)} onClose={() => setActiveCatalog(null)} width="min(96vw, 900px)" title={activeCatalog ? <div className={styles.drawerTitle}><span>Análise do anúncio de catálogo</span><strong>{activeCatalog.ml_item_id}</strong></div> : undefined} extra={activeCatalog?.permalink && !visualReview ? <Button icon={<EyeOutlined />} onClick={() => window.open(activeCatalog.permalink || '', '_blank', 'noopener,noreferrer')}>Abrir no ML</Button> : null}>{activeCatalog && <Spin spinning={priceDetailLoading}><Tabs items={[
      { key: 'relation', label: 'Relação', children: <div className={styles.drawerSection}><div className={styles.relationFlow}><span><small>Anúncio padrão</small><strong>{activeCatalog.relacionado_id || 'Não localizado'}</strong></span><ArrowRightOutlined /><span><small>Produto de catálogo</small><strong>{activeCatalog.catalog_product_id || 'Não informado'}</strong></span><ArrowRightOutlined /><span><small>Anúncio de catálogo</small><strong>{activeCatalog.ml_item_id}</strong></span></div><Alert type="info" showIcon message="Três identificadores diferentes" description="O produto de catálogo identifica a página do Mercado Livre. Os outros dois IDs identificam publicações da loja." /><Descriptions column={2} size="small" items={[{ key: 'product', label: 'Produto Bentevi', children: activeCatalog.produto_nome || activeCatalog.title }, { key: 'sku', label: 'SKU Bentevi', children: activeCatalog.sku_local || 'Não informado' }, { key: 'catalogStatus', label: 'Anúncio de catálogo', children: statusPresentation(activeCatalog.status).label }, { key: 'standardStatus', label: 'Anúncio padrão', children: statusPresentation(activeCatalog.related_status).label }]} /></div> },
      { key: 'competition', label: 'Competição', children: <div className={styles.drawerSection}><div className={styles.competitionHero}>{(() => { const state = catalogCompetitionPresentation(priceDetail?.catalog?.rawStatus || activeCatalog.buy_box_status); return <><span className={`${styles.competitionDot} ${styles[state.tone]}`} /><div><small>Estado atual</small><strong>{state.label}</strong><p>{state.description}</p></div></>; })()}</div><Descriptions column={2} size="small" items={[{ key: 'current', label: 'Preço atual', children: formatCurrency(priceDetail?.currentPrice ?? activeCatalog.price) }, { key: 'target', label: 'Preço para ganhar', children: priceDetail?.catalog?.priceToWin || activeCatalog.price_to_win ? formatCurrency(Number(priceDetail?.catalog?.priceToWin || activeCatalog.price_to_win)) : 'Não informado' }, { key: 'winner', label: 'Anúncio vencedor', children: priceDetail?.catalog?.winner?.itemId || 'Não informado' }, { key: 'winnerPrice', label: 'Preço vencedor', children: priceDetail?.catalog?.winner?.price ? formatCurrency(priceDetail.catalog.winner.price) : 'Não informado' }]} />{priceDetail?.catalog?.reasons?.length ? <Alert type="warning" showIcon message="Motivos que impedem vencer" description={priceDetail.catalog.reasons.join(' · ')} /> : null}{priceDetail?.catalog?.boosts?.length ? <div className={styles.boostList}>{priceDetail.catalog.boosts.map((boost) => <span key={boost.id}><b>{boost.description || boost.id}</b><small>{boost.status}</small></span>)}</div> : null}{priceDetail?.catalog?.warning && <Alert type="warning" showIcon message={priceDetail.catalog.warning} />}</div> },
      { key: 'price', label: 'Preço e sincronização', children: <div className={styles.drawerSection}><Descriptions column={2} size="small" items={[{ key: 'price', label: 'Preço atual', children: formatCurrency(priceDetail?.currentPrice ?? activeCatalog.price) }, { key: 'profit', label: 'Lucro atual', children: priceDetail?.currentProfit == null ? 'Não calculado' : formatCurrency(priceDetail.currentProfit) }, { key: 'sync', label: 'Última análise', children: formatDate(priceDetail?.catalog?.syncedAt || activeCatalog.last_updated) }, { key: 'automatic', label: 'Preço automático ML', children: priceDetail?.automaticPricing?.active ? 'Ativo — edição bloqueada' : 'Não detectado' }]} /><div className={styles.priceEditor}><div><label>Novo preço</label><InputNumber prefix="R$" min={0.01} precision={2} value={newPrice} onChange={(value) => setNewPrice(value ?? null)} disabled={Boolean(visualReview) || priceDetail?.automaticPricing?.active} /></div>{(priceDetail?.catalog?.priceToWin || activeCatalog.price_to_win) && <Button onClick={() => setNewPrice(Number(priceDetail?.catalog?.priceToWin || activeCatalog.price_to_win))}>Usar preço para ganhar</Button>}<Button type="primary" loading={updatingPrice} disabled={!activeCatalog.produto_id || !newPrice || Boolean(visualReview) || priceDetail?.automaticPricing?.active} onClick={() => modalApi.confirm({ title: 'Aplicar este preço nos anúncios vinculados?', content: 'A publicação será acompanhada pelo fluxo único do Mercado Livre.', okText: 'Aplicar preço', cancelText: 'Cancelar', onOk: savePrice })}>Aplicar preço</Button></div></div> },
    ]} /></Spin>}</Drawer>

    <Drawer open={Boolean(activeEligible)} onClose={() => setActiveEligible(null)} width="min(96vw, 820px)" title={activeEligible ? <div className={styles.drawerTitle}><span>Elegibilidade ao catálogo</span><strong>{activeEligible.ml_item_id}</strong></div> : undefined}>{activeEligible && <div className={styles.drawerSection}><div className={styles.relationFlow}><span><small>Anúncio padrão</small><strong>{activeEligible.ml_item_id}</strong></span><ArrowRightOutlined /><span><small>Produto de catálogo</small><strong>{activeEligible.catalog_product_id_sugerido || activeEligible.catalog_product_id || 'Não informado'}</strong></span><ArrowRightOutlined /><span><small>Resultado</small><strong>Novo anúncio de catálogo</strong></span></div><Alert type={activeEligible.state === 'ready' ? 'success' : 'warning'} showIcon message={eligibilityPresentation(activeEligible.state).label} description={activeEligible.reason} /><Descriptions column={2} size="small" items={[{ key: 'product', label: 'Produto Bentevi', children: activeEligible.local_product_name || 'Não vinculado' }, { key: 'sku', label: 'SKU', children: activeEligible.seller_sku || 'Não informado' }, { key: 'catalog', label: 'Produto de catálogo', children: activeEligible.catalog_product_name_sugerido || activeEligible.catalog_product_name || 'Não informado' }, { key: 'status', label: 'Estado no ML', children: activeEligible.eligibility_label || activeEligible.eligibility_status || 'Não informado' }]} />{activeEligible.variation_eligibility?.length > 0 && <div className={styles.variationList}>{activeEligible.variation_eligibility.map((variation) => <span key={String(variation.id)}><b>Variação {variation.id}</b><small>{String(variation.status || 'Não informada')} · produto {variation.catalog_product_id || activeEligible.catalog_product_id || 'não informado'}</small></span>)}</div>}{activeEligible.catalog_product_warning && <Alert type="warning" showIcon message="Compatibilidade precisa de atenção" description={activeEligible.catalog_product_warning} />}<Alert type="info" showIcon message="O anúncio padrão não será transformado" description="O opt-in cria uma publicação de catálogo separada. Para anúncios com variações, será criada uma publicação por variação elegível." /><Button type="primary" size="large" disabled={activeEligible.state !== 'ready' || Boolean(visualReview)} onClick={() => confirmOptin([activeEligible])}>Criar anúncio de catálogo</Button></div>}</Drawer>
    <ProgressModal open={batchOpen} title="Criando anúncios de catálogo" steps={batchSteps} onClose={() => { if (!batchRunning) setBatchOpen(false); }} showCloseButton={!batchRunning} customActions={batchRunning ? [{ key: 'cancel', label: 'Cancelar', danger: true, onClick: () => { batchCancelled.current = true; batchAbort.current?.abort(); setBatchRunning(false); } }] : []} />
    <ProgressModal open={analysisModalOpen} title="Reanalisando oportunidades de catálogo" steps={analysisSteps} onClose={() => setAnalysisModalOpen(false)} showCloseButton={!analysisRunning} />
    <ProgressModal {...progressModalProps} />
  </div>;
}
