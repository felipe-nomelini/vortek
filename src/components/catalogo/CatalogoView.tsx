'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space, message, Spin, Statistic } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { MenuProps, TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

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

function mapStatusMlToPt(status: string | null | undefined): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'paused') return 'Pausado';
  if (normalized === 'closed') return 'Encerrado';
  if (normalized === 'under_review') return 'Em revisão';
  if (normalized === 'inactive') return 'Inativo';
  return status || '—';
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

  const [noCatalogoData, setNoCatalogoData] = useState<NoCatalogoRow[]>([]);
  const [elegiveisData, setElegiveisData] = useState<ElegivelRow[]>([]);
  const [updatingPriceByItem, setUpdatingPriceByItem] = useState<Record<string, boolean>>({});
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
    setUpdatingPriceByItem((prev) => ({ ...prev, [itemKey]: true }));
    try {
      const res = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: row.produto_id,
          targetPrice,
          source: 'catalog_price_to_win',
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(data?.error || 'Falha ao atualizar preço do anúncio no ML.');
        return;
      }

      const priceUpdated = Boolean(data?.price_updated);
      const quantityPricingUpdated = Boolean(data?.quantity_pricing_updated);
      if (priceUpdated && quantityPricingUpdated) {
        messageApi.success('Preço principal e atacado atualizados no ML.');
      } else if (priceUpdated || quantityPricingUpdated) {
        const errors = Array.isArray(data?.errors) ? data.errors.filter(Boolean).join(' | ') : 'Atualização parcial.';
        messageApi.warning(errors || 'Atualização parcial do anúncio no ML.');
      } else {
        const errors = Array.isArray(data?.errors) ? data.errors.filter(Boolean).join(' | ') : '';
        messageApi.error(errors || 'Não foi possível atualizar o preço do anúncio.');
      }

      fetchData();
    } catch {
      messageApi.error('Erro de conexão ao atualizar preço do anúncio.');
    } finally {
      setUpdatingPriceByItem((prev) => ({ ...prev, [itemKey]: false }));
    }
  }, [fetchData, messageApi, mode]);

  const columnsNoCatalogo: TableProps<NoCatalogoRow>['columns'] = useMemo(() => ([
    { title: 'SKU Local', dataIndex: 'sku_local', key: 'sku_local', width: 130, render: (v) => v || '—' },
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

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Catálogo - Mercado Livre</Title>

      {mode === 'no_catalogo' && (
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
      )}

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
          {mode === 'no_catalogo' && (
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
          )}
          {mode === 'elegiveis' && (
            <Col>
              <Select
                value={eligibilityStatus}
                onChange={setEligibilityStatus}
                options={eligibilityStatusOptions}
                style={{ width: 210 }}
              />
            </Col>
          )}
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Preço mín" value={priceMin} onChange={(v) => setPriceMin(v ?? null)} style={{ width: 120 }} />
              <InputNumber placeholder="Preço máx" value={priceMax} onChange={(v) => setPriceMax(v ?? null)} style={{ width: 120 }} />
            </Space.Compact>
          </Col>
          {mode === 'no_catalogo' && (
            <Col>
              <Button
                icon={refreshJobStatus === 'running' ? <LoadingOutlined spin /> : <ReloadOutlined />}
                onClick={refreshNoCatalogoSnapshot}
                loading={refreshJobStatus === 'running'}
              >
                Atualizar agora
              </Button>
            </Col>
          )}
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
          {mode === 'no_catalogo' ? (
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
          ) : (
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
          )}
        </Spin>
      </div>
    </div>
  );
}
