'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Progress, Row, Skeleton, Space,
  Statistic, Table, Tag, Typography, message, theme,
} from 'antd';
import {
  ArrowRightOutlined, ReloadOutlined, SyncOutlined, TrophyFilled,
} from '@ant-design/icons';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/lib/format';
import {
  PREPARATION_ORDER_STATUSES, SHIPPING_ORDER_STATUSES,
} from '@/lib/orders/operational-view';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

const datePresets: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: 'Últimos 7 dias', value: [dayjs().subtract(6, 'day'), dayjs()] },
  { label: 'Últimos 30 dias', value: [dayjs().subtract(29, 'day'), dayjs()] },
  { label: 'Este mês', value: [dayjs().startOf('month'), dayjs()] },
  { label: 'Mês passado', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
];

const statusLabel: Record<string, string> = {
  aberto: 'Aberto', pendente: 'Pendente', preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio', etiqueta_impressa: 'Etiqueta impressa',
  coletado: 'Coletado', em_transito: 'Em trânsito', saiu_entrega: 'Saiu para entrega',
  dest_ausente: 'Destinatário ausente', atendido: 'Atendido', faturado: 'Faturado',
  entregue: 'Entregue', recusado: 'Recusado', devolvido: 'Devolvido', cancelado: 'Cancelado',
};

const statusColor: Record<string, string> = {
  aberto: 'blue', pendente: 'orange', preparando: 'processing', pronto_envio: 'cyan',
  etiqueta_impressa: 'blue', coletado: 'geekblue', em_transito: 'purple',
  saiu_entrega: 'cyan', dest_ausente: 'red', atendido: 'processing', faturado: 'purple',
  entregue: 'green', recusado: 'red', devolvido: 'magenta', cancelado: 'default',
};

interface DashboardData {
  faturamento: number;
  lucro: number;
  totalPedidos: number;
  ticketMedio: number;
  vendasDiarias: { dia: string; receita: number }[];
  statusCounts: Record<string, number>;
  pedidosRecentes: {
    id?: string;
    numero: number;
    cliente: string;
    total: number;
    situacao: string;
    data: string;
  }[];
  topProdutos: { nome: string; vendas: number; receita: number }[];
  produtosAtivos: number;
  totalProdutos: number;
}

interface ReputacaoData {
  reclamacoes: number | null;
  atrasos: number | null;
  cancelamentos: number | null;
  positivas: number | null;
  nivel: string;
  nivelCor: string;
  nivelKey: string;
  conectado?: boolean;
  indisponivel?: boolean;
}

interface IntegracaoData {
  label: string;
  status: string;
  on: boolean;
}

type SyncJobStatus = 'pendente' | 'rodando' | 'completo' | 'completo_parcial' | 'erro' | 'cancelado';
type SyncVisualStatus = 'idle' | 'running' | 'done' | 'partial' | 'error';
type MlSyncTipo = 'anuncios' | 'pedidos';

interface SyncJobStatusResponse {
  success: boolean;
  job?: {
    id: string;
    status: SyncJobStatus;
    progresso: number;
    processados: number;
    total: number;
    finished_at: string | null;
    last_event?: { event_type: string | null; message: string | null; timestamp: string | null } | null;
    updated_at?: string | null;
  };
  failures?: string[];
  error?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null) as { erro?: string; error?: string } | null;
  return new Error(payload?.erro || payload?.error || fallback);
}

function sumStatuses(statusCounts: Record<string, number>, statuses: readonly string[]): number {
  return statuses.reduce((total, status) => total + Number(statusCounts[status] || 0), 0);
}

function syncFeedback(status: SyncVisualStatus | undefined): { label: string; color?: string } | null {
  if (status === 'running') return { label: 'Em andamento', color: 'processing' };
  if (status === 'done') return { label: 'Concluída', color: 'success' };
  if (status === 'partial') return { label: 'Com alertas', color: 'warning' };
  if (status === 'error') return { label: 'Falhou', color: 'error' };
  return null;
}

export default function DashboardPage() {
  const { token } = theme.useToken();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day'), dayjs()]);
  const dateRangeRef = useRef(dateRange);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reputacao, setReputacao] = useState<ReputacaoData | null>(null);
  const [integracoes, setIntegracoes] = useState<IntegracaoData[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reputationError, setReputationError] = useState<string | null>(null);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncVisualStatus>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const summaryRequestSequence = useRef(0);
  const dslitePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dsliteJobRef = useRef<string | null>(null);
  const dslitePollingInFlightRef = useRef(false);
  const dslitePollingStartedAtRef = useRef<number | null>(null);
  const mlPollRefs = useRef<Record<MlSyncTipo, ReturnType<typeof setTimeout> | null>>({ anuncios: null, pedidos: null });
  const mlJobRefs = useRef<Record<MlSyncTipo, string | null>>({ anuncios: null, pedidos: null });
  const mlPollingInFlightRefs = useRef<Record<MlSyncTipo, boolean>>({ anuncios: false, pedidos: false });
  const mlPollingStartedAtRefs = useRef<Record<MlSyncTipo, number | null>>({ anuncios: null, pedidos: null });

  const fetchSummary = useCallback(async (range: [Dayjs, Dayjs] = dateRangeRef.current) => {
    const sequence = ++summaryRequestSequence.current;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const params = new URLSearchParams({
        dateFrom: range[0].format('YYYY-MM-DD'), dateTo: range[1].format('YYYY-MM-DD'),
      });
      const response = await fetch(`/api/dashboard/resumo?${params}`, { cache: 'no-store' });
      if (!response.ok) throw await responseError(response, 'Falha ao carregar o resumo');
      const payload = await response.json() as DashboardData;
      if (sequence !== summaryRequestSequence.current) return;
      setDashboard(payload);
      setLastUpdatedAt(new Date());
    } catch (error) {
      if (sequence !== summaryRequestSequence.current) return;
      setSummaryError(errorMessage(error, 'Erro ao carregar o resumo do dashboard'));
    } finally {
      if (sequence === summaryRequestSequence.current) setSummaryLoading(false);
    }
  }, []);

  const fetchReputation = useCallback(async () => {
    setReputationLoading(true);
    setReputationError(null);
    try {
      const response = await fetch('/api/ml/reputacao', { cache: 'no-store' });
      if (!response.ok) throw await responseError(response, 'Falha ao carregar a reputação');
      setReputacao(await response.json() as ReputacaoData);
    } catch (error) {
      setReputationError(errorMessage(error, 'Erro ao carregar a reputação do Mercado Livre'));
    } finally {
      setReputationLoading(false);
    }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    try {
      const response = await fetch('/api/integracoes/status', { cache: 'no-store' });
      if (!response.ok) throw await responseError(response, 'Falha ao carregar as integrações');
      const payload = await response.json() as { integracoes?: IntegracaoData[] };
      setIntegracoes(Array.isArray(payload.integracoes) ? payload.integracoes : []);
    } catch (error) {
      setIntegrationsError(errorMessage(error, 'Erro ao carregar o estado das integrações'));
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchSummary(), fetchReputation(), fetchIntegrations()]);
  }, [fetchIntegrations, fetchReputation, fetchSummary]);

  const clearDslitePolling = useCallback(() => {
    if (dslitePollRef.current) clearTimeout(dslitePollRef.current);
    dslitePollRef.current = null;
    dsliteJobRef.current = null;
    dslitePollingInFlightRef.current = false;
    dslitePollingStartedAtRef.current = null;
  }, []);

  const finalizeDsliteSync = useCallback((outcome: Exclude<SyncVisualStatus, 'idle' | 'running'>, reloadSummary: boolean) => {
    clearDslitePolling();
    setSyncStatus((previous) => ({ ...previous, dslite: outcome }));
    if (reloadSummary) void fetchSummary();
    setTimeout(() => setSyncStatus((previous) => ({ ...previous, dslite: 'idle' })), 4000);
  }, [clearDslitePolling, fetchSummary]);

  const pollDsliteJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/sync/dslite/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({ success: false })) as SyncJobStatusResponse;
    if (!response.ok || !payload.success || !payload.job) {
      throw new Error(payload.error || 'Não foi possível consultar o status da sincronização');
    }
    if (payload.job.status === 'pendente' || payload.job.status === 'rodando') return;
    if (payload.job.status === 'completo') {
      messageApi.success('Sincronização DSLite concluída.');
      finalizeDsliteSync('done', true);
      return;
    }
    if (payload.job.status === 'completo_parcial') {
      const details = (payload.failures || []).slice(0, 2).join(' | ');
      messageApi.warning(details ? `Sincronização DSLite concluída com alertas: ${details}` : 'Sincronização DSLite concluída com alertas.');
      finalizeDsliteSync('partial', true);
      return;
    }
    if (payload.job.status === 'erro' || payload.job.status === 'cancelado') {
      messageApi.error(payload.failures?.[0] || 'Falha na sincronização DSLite.');
      finalizeDsliteSync('error', false);
    }
  }, [finalizeDsliteSync, messageApi]);

  const getAdaptiveDslitePollingInterval = useCallback(() => {
    const startedAt = dslitePollingStartedAtRef.current;
    if (!startedAt) return 2000;
    const elapsed = Date.now() - startedAt;
    if (elapsed > 180000) return 5000;
    if (elapsed > 60000) return 4000;
    return 2000;
  }, []);

  const scheduleNextDslitePoll = useCallback(() => {
    const currentJobId = dsliteJobRef.current;
    if (!currentJobId) return;
    dslitePollRef.current = setTimeout(() => {
      const runningJobId = dsliteJobRef.current;
      if (!runningJobId) return;
      if (dslitePollingInFlightRef.current) {
        scheduleNextDslitePoll();
        return;
      }
      dslitePollingInFlightRef.current = true;
      void pollDsliteJob(runningJobId).catch((error) => {
        messageApi.error(errorMessage(error, 'Erro ao consultar o status da sincronização DSLite'));
        finalizeDsliteSync('error', false);
      }).finally(() => {
        dslitePollingInFlightRef.current = false;
        if (dsliteJobRef.current === runningJobId) scheduleNextDslitePoll();
      });
    }, getAdaptiveDslitePollingInterval());
  }, [finalizeDsliteSync, getAdaptiveDslitePollingInterval, messageApi, pollDsliteJob]);

  const startDslitePolling = useCallback((jobId: string) => {
    clearDslitePolling();
    dsliteJobRef.current = jobId;
    dslitePollingStartedAtRef.current = Date.now();
    scheduleNextDslitePoll();
  }, [clearDslitePolling, scheduleNextDslitePoll]);

  const resumeDsliteSyncIfRunning = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/dslite/status', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({ success: false })) as SyncJobStatusResponse;
      if (!response.ok || !payload.success || !payload.job) return;
      if (payload.job.status === 'pendente' || payload.job.status === 'rodando') {
        setSyncStatus((previous) => ({ ...previous, dslite: 'running' }));
        startDslitePolling(payload.job.id);
        await pollDsliteJob(payload.job.id);
      }
    } catch {
      // O dashboard continua disponível quando não é possível retomar um job antigo.
    }
  }, [pollDsliteJob, startDslitePolling]);

  const clearMlPolling = useCallback((type: MlSyncTipo) => {
    const timer = mlPollRefs.current[type];
    if (timer) clearTimeout(timer);
    mlPollRefs.current[type] = null;
    mlJobRefs.current[type] = null;
    mlPollingInFlightRefs.current[type] = false;
    mlPollingStartedAtRefs.current[type] = null;
  }, []);

  const finalizeMlSync = useCallback((type: MlSyncTipo, outcome: Exclude<SyncVisualStatus, 'idle' | 'running'>, reloadSummary: boolean) => {
    clearMlPolling(type);
    setSyncStatus((previous) => ({ ...previous, [type]: outcome }));
    if (reloadSummary) void fetchSummary();
    setTimeout(() => setSyncStatus((previous) => ({ ...previous, [type]: 'idle' })), 4000);
  }, [clearMlPolling, fetchSummary]);

  const getAdaptiveMlPollingInterval = useCallback((type: MlSyncTipo) => {
    const startedAt = mlPollingStartedAtRefs.current[type];
    if (!startedAt) return 2000;
    const elapsed = Date.now() - startedAt;
    if (elapsed > 180000) return 5000;
    if (elapsed > 60000) return 4000;
    return 2000;
  }, []);

  const pollMlJob = useCallback(async (type: MlSyncTipo, jobId: string) => {
    const response = await fetch(`/api/sync/${type}/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({ success: false })) as SyncJobStatusResponse;
    if (!response.ok || !payload.success || !payload.job) {
      throw new Error(payload.error || `Não foi possível consultar o sync de ${type}`);
    }
    if (payload.job.status === 'pendente' || payload.job.status === 'rodando') return;
    const label = type === 'anuncios' ? 'anúncios ML' : 'pedidos ML';
    if (payload.job.status === 'completo') {
      messageApi.success(`Sincronização de ${label} concluída.`);
      finalizeMlSync(type, 'done', true);
      return;
    }
    if (payload.job.status === 'completo_parcial') {
      const details = (payload.failures || []).slice(0, 2).join(' | ');
      messageApi.warning(details ? `Sincronização de ${label} concluída com alertas: ${details}` : `Sincronização de ${label} concluída com alertas.`);
      finalizeMlSync(type, 'partial', true);
      return;
    }
    if (payload.job.status === 'erro' || payload.job.status === 'cancelado') {
      messageApi.error(payload.failures?.[0] || `Falha na sincronização de ${label}.`);
      finalizeMlSync(type, 'error', false);
    }
  }, [finalizeMlSync, messageApi]);

  const scheduleNextMlPoll = useCallback((type: MlSyncTipo) => {
    const currentJobId = mlJobRefs.current[type];
    if (!currentJobId) return;
    mlPollRefs.current[type] = setTimeout(() => {
      const runningJobId = mlJobRefs.current[type];
      if (!runningJobId) return;
      if (mlPollingInFlightRefs.current[type]) {
        scheduleNextMlPoll(type);
        return;
      }
      mlPollingInFlightRefs.current[type] = true;
      void pollMlJob(type, runningJobId).catch((error) => {
        messageApi.error(errorMessage(error, `Erro ao consultar o sync de ${type}`));
        finalizeMlSync(type, 'error', false);
      }).finally(() => {
        mlPollingInFlightRefs.current[type] = false;
        if (mlJobRefs.current[type] === runningJobId) scheduleNextMlPoll(type);
      });
    }, getAdaptiveMlPollingInterval(type));
  }, [finalizeMlSync, getAdaptiveMlPollingInterval, messageApi, pollMlJob]);

  const startMlPolling = useCallback((type: MlSyncTipo, jobId: string) => {
    clearMlPolling(type);
    mlJobRefs.current[type] = jobId;
    mlPollingStartedAtRefs.current[type] = Date.now();
    scheduleNextMlPoll(type);
  }, [clearMlPolling, scheduleNextMlPoll]);

  const resumeMlSyncIfRunning = useCallback(async (type: MlSyncTipo) => {
    try {
      const response = await fetch(`/api/sync/${type}/status`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({ success: false })) as SyncJobStatusResponse;
      if (!response.ok || !payload.success || !payload.job) return;
      if (payload.job.status === 'pendente' || payload.job.status === 'rodando') {
        setSyncStatus((previous) => ({ ...previous, [type]: 'running' }));
        startMlPolling(type, payload.job.id);
        await pollMlJob(type, payload.job.id);
      }
    } catch {
      // O dashboard continua disponível quando não é possível retomar um job antigo.
    }
  }, [pollMlJob, startMlPolling]);

  useEffect(() => {
    dateRangeRef.current = dateRange;
    void fetchSummary(dateRange);
  }, [dateRange, fetchSummary]);

  useEffect(() => {
    let active = true;
    const initializeOperationalContext = async () => {
      try {
        const response = await fetch('/api/ml/estado', { cache: 'no-store' });
        const state = await response.json().catch(() => ({})) as {
          conectado?: boolean; precisaReconectar?: boolean; erro?: string; reason?: string;
        };
        if (!active) return;
        if (state.precisaReconectar && state.reason === 'account_not_allowed') {
          messageApi.error(state.erro || 'Conta Mercado Livre não permitida. Revise a integração em Configurações.');
        } else if (state.precisaReconectar) {
          messageApi.warning('Mercado Livre desconectado. Revise a integração em Configurações.');
        } else if (state.erro && state.conectado) {
          messageApi.warning('Mercado Livre instável no momento.');
        }
      } catch {
        // Os blocos independentes abaixo informam seus próprios erros.
      }
      if (!active) return;
      await Promise.all([fetchReputation(), fetchIntegrations()]);
      if (!active) return;
      await Promise.all([
        resumeDsliteSyncIfRunning(), resumeMlSyncIfRunning('anuncios'), resumeMlSyncIfRunning('pedidos'),
      ]);
    };
    void initializeOperationalContext();
    return () => { active = false; };
  }, [fetchIntegrations, fetchReputation, messageApi, resumeDsliteSyncIfRunning, resumeMlSyncIfRunning]);

  useEffect(() => () => {
    clearDslitePolling();
    clearMlPolling('anuncios');
    clearMlPolling('pedidos');
  }, [clearDslitePolling, clearMlPolling]);

  const triggerMlSync = useCallback(async (type: MlSyncTipo) => {
    setSyncStatus((previous) => ({ ...previous, [type]: 'running' }));
    const label = type === 'anuncios' ? 'anúncios ML' : 'pedidos ML';
    try {
      const response = await fetch(`/api/sync/${type}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean; jobId?: string; reused?: boolean; error?: string;
      };
      if (!response.ok || !payload.success || !payload.jobId) {
        messageApi.error(payload.error || `Erro ao iniciar a sincronização de ${label}.`);
        setSyncStatus((previous) => ({ ...previous, [type]: 'error' }));
        return;
      }
      messageApi.info(payload.reused ? `Acompanhando a sincronização de ${label} já em andamento.` : `Sincronização de ${label} iniciada.`);
      startMlPolling(type, String(payload.jobId));
      await pollMlJob(type, String(payload.jobId));
    } catch (error) {
      messageApi.error(errorMessage(error, `Erro ao iniciar a sincronização de ${label}.`));
      finalizeMlSync(type, 'error', false);
    }
  }, [finalizeMlSync, messageApi, pollMlJob, startMlPolling]);

  const triggerDsliteSync = useCallback(async () => {
    setSyncStatus((previous) => ({ ...previous, dslite: 'running' }));
    messageApi.info('Sincronização DSLite iniciada.');
    try {
      const response = await fetch('/api/sync/dslite', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean; jobId?: string; reused?: boolean; error?: string;
      };
      if (!response.ok || !payload.success || !payload.jobId) {
        messageApi.error(payload.error || 'Falha ao iniciar a sincronização DSLite.');
        setSyncStatus((previous) => ({ ...previous, dslite: 'error' }));
        return;
      }
      if (payload.reused) messageApi.info('Acompanhando a sincronização DSLite já em andamento.');
      startDslitePolling(String(payload.jobId));
      await pollDsliteJob(String(payload.jobId));
    } catch (error) {
      messageApi.error(errorMessage(error, 'Erro ao iniciar a sincronização DSLite.'));
      finalizeDsliteSync('error', false);
    }
  }, [finalizeDsliteSync, messageApi, pollDsliteJob, startDslitePolling]);

  const preparationCount = useMemo(() => sumStatuses(dashboard?.statusCounts || {}, PREPARATION_ORDER_STATUSES), [dashboard]);
  const shippingCount = useMemo(() => sumStatuses(dashboard?.statusCounts || {}, SHIPPING_ORDER_STATUSES), [dashboard]);
  const disconnectedIntegrations = useMemo(() => integracoes.filter((integration) => !integration.on).length, [integracoes]);

  const recentOrders = useMemo(() => (dashboard?.pedidosRecentes || []).map((order) => ({
    key: order.id || String(order.numero),
    href: order.id ? `/pedidos?view=all&venda=${encodeURIComponent(order.id)}` : `/pedidos?view=all&search=${encodeURIComponent(String(order.numero))}`,
    order: `#${String(order.numero).padStart(6, '0')}`,
    client: order.cliente || 'Cliente não informado', total: order.total,
    status: statusLabel[order.situacao] || order.situacao,
    color: statusColor[order.situacao] || 'default',
    date: order.data ? dayjs(order.data).format('DD/MM/YYYY HH:mm') : '—',
  })), [dashboard]);

  const topProducts = useMemo(() => (dashboard?.topProdutos || []).map((product, index) => ({ ...product, rank: index + 1 })), [dashboard]);

  const recentColumns = useMemo(() => [
    { title: 'Venda', dataIndex: 'order', key: 'order', width: 120, render: (value: string, row: { href: string }) => <Link href={row.href}>{value}</Link> },
    { title: 'Cliente', dataIndex: 'client', key: 'client', ellipsis: true },
    { title: 'Valor', dataIndex: 'total', key: 'total', width: 120, render: (value: number) => <Text strong>{formatCurrency(value)}</Text> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 130, render: (value: string, row: { color: string }) => <Tag color={row.color}>{value}</Tag> },
    { title: 'Data', dataIndex: 'date', key: 'date', width: 150 },
  ], []);

  const topColumns = useMemo(() => [
    { title: 'Posição', dataIndex: 'rank', key: 'rank', width: 44, render: (rank: number) => rank <= 3 ? <TrophyFilled style={{ color: ['#FFBD0E', '#B3AFB7', '#B46B36'][rank - 1] }} /> : <Text type="secondary">{rank}º</Text> },
    { title: 'Produto', dataIndex: 'nome', key: 'nome', ellipsis: true },
    { title: 'Vendas', dataIndex: 'vendas', key: 'vendas', width: 72 },
    { title: 'Receita', dataIndex: 'receita', key: 'receita', width: 118, render: (value: number) => formatCurrency(value) },
  ], []);

  const operationItems = [
    { key: 'preparation', label: 'Em preparação', description: 'Compra, fiscal e etiqueta', count: preparationCount, href: '/pedidos?view=preparation', color: preparationCount > 0 ? token.colorWarning : token.colorSuccess },
    { key: 'shipping', label: 'Em transporte', description: 'Acompanhar até a entrega', count: shippingCount, href: '/pedidos?view=shipping', color: token.colorInfo },
    { key: 'integrations', label: 'Integrações desconectadas', description: integrationsError ? 'Estado parcialmente indisponível' : 'Revisar conexões externas', count: integrationsLoading && integracoes.length === 0 ? null : disconnectedIntegrations, href: '/configuracoes', color: disconnectedIntegrations > 0 || integrationsError ? token.colorError : token.colorSuccess },
  ];

  const refreshLoading = summaryLoading || reputationLoading || integrationsLoading;
  const periodLabel = `${dateRange[0].format('DD/MM')} a ${dateRange[1].format('DD/MM/YYYY')}`;
  const dsliteFeedback = syncFeedback(syncStatus.dslite || 'idle');
  const anunciosFeedback = syncFeedback(syncStatus.anuncios || 'idle');
  const pedidosFeedback = syncFeedback(syncStatus.pedidos || 'idle');

  return (
    <div>
      {contextHolder}
      <Row justify="space-between" align="top" gutter={[16, 12]} style={{ marginBottom: 20 }}>
        <Col>
          <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">Visão executiva do período e do que precisa de atenção agora.</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            {lastUpdatedAt ? `Atualizado às ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando primeira atualização'}
          </Text>
        </Col>
        <Col>
          <Space wrap>
            <RangePicker value={dateRange} format="DD/MM/YYYY" allowClear={false} presets={datePresets} onChange={(dates) => { if (dates?.[0] && dates[1]) setDateRange([dates[0], dates[1]]); }} />
            <Button type="primary" icon={<ReloadOutlined />} loading={refreshLoading} onClick={() => void refreshAll()}>Atualizar</Button>
          </Space>
        </Col>
      </Row>

      {summaryError && (
        <Alert type="error" showIcon message="Resumo parcialmente indisponível" description={`${summaryError}${dashboard ? ' Os dados anteriores foram preservados.' : ''}`} action={<Button size="small" onClick={() => void fetchSummary()}>Tentar novamente</Button>} style={{ marginBottom: 16 }} />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: 'Receita', value: dashboard?.faturamento, money: true },
          { title: 'Pedidos', value: dashboard?.totalPedidos, money: false },
          { title: 'Ticket médio', value: dashboard?.ticketMedio, money: true },
          { title: 'Lucro', value: dashboard?.lucro, money: true, profit: true },
        ].map((item) => (
          <Col xs={12} lg={6} key={item.title}>
            <Card loading={summaryLoading && !dashboard} styles={{ body: { padding: '18px 20px' } }}>
              <Statistic title={item.title} value={item.value ?? 0} precision={item.money ? 2 : 0} prefix={item.money ? 'R$' : undefined} valueStyle={{ fontSize: 28, fontWeight: 700, color: item.profit && item.value !== undefined ? item.value > 0 ? token.colorSuccess : item.value < 0 ? token.colorError : token.colorText : token.colorText }} />
              <Text type="secondary" style={{ fontSize: 11 }}>{periodLabel}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}>
          <Card title="Operação agora" extra={<Text type="secondary">Ações diretas</Text>} style={{ height: '100%' }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {operationItems.map((item) => (
                <Link key={item.key} href={item.href} style={{ color: 'inherit' }}>
                  <Card size="small" hoverable styles={{ body: { padding: 12 } }} style={{ borderLeft: `3px solid ${item.color}` }}>
                    <Row justify="space-between" align="middle" wrap={false}>
                      <Col style={{ minWidth: 0 }}><Text strong>{item.label}</Text><Text type="secondary" ellipsis style={{ display: 'block', fontSize: 11 }}>{item.description}</Text></Col>
                      <Col><Space size={8}><Title level={3} style={{ margin: 0, color: item.color }}>{item.count === null ? '—' : item.count}</Title><ArrowRightOutlined style={{ color: token.colorTextSecondary }} /></Space></Col>
                    </Row>
                  </Card>
                </Link>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title="Receita diária" extra={<Text type="secondary">Dados reais · {periodLabel}</Text>} style={{ height: '100%' }}>
            {summaryLoading && !dashboard ? <Skeleton active paragraph={{ rows: 7 }} title={false} /> : dashboard?.vendasDiarias.length ? (
              <ResponsiveContainer width="100%" height={265} initialDimension={{ width: 720, height: 265 }}>
                <BarChart data={dashboard.vendasDiarias} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <XAxis dataKey="dia" tick={{ fill: token.colorTextSecondary, fontSize: 11 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(dashboard.vendasDiarias.length / 7))} />
                  <YAxis tick={{ fill: token.colorTextSecondary, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => value >= 1000 ? `R$ ${(value / 1000).toFixed(0)} mil` : `R$ ${value}`} />
                  <Tooltip cursor={{ fill: token.colorFillSecondary }} contentStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadius }} labelStyle={{ color: token.colorTextSecondary }} formatter={(value) => [formatCurrency(Number(value)), 'Receita']} />
                  <Bar dataKey="receita" fill={token.colorPrimary} radius={[5, 5, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem vendas no período selecionado." />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="Vendas recentes" extra={<Link href="/pedidos?view=all">Ver todas <ArrowRightOutlined /></Link>} style={{ height: '100%' }}>
            {summaryLoading && !dashboard ? <Skeleton active paragraph={{ rows: 6 }} title={false} /> : recentOrders.length ? <Table dataSource={recentOrders} columns={recentColumns} pagination={false} size="small" scroll={{ x: 700 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem vendas recentes no período." />}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Produtos com mais vendas" extra={<Link href="/produtos">Ver produtos <ArrowRightOutlined /></Link>} style={{ height: '100%' }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>Acumulado dos anúncios no Mercado Livre · {dashboard ? `${dashboard.produtosAtivos} de ${dashboard.totalProdutos} produtos ativos` : 'carregando catálogo'}</Text>
            {summaryLoading && !dashboard ? <Skeleton active paragraph={{ rows: 6 }} title={false} /> : topProducts.length ? <Table dataSource={topProducts} columns={topColumns} rowKey="rank" pagination={false} size="small" showHeader={false} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma venda acumulada por produto." />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Reputação no Mercado Livre" extra={<Link href="/reputacao">Ver detalhes <ArrowRightOutlined /></Link>} style={{ height: '100%' }}>
            {reputationError && <Alert type="warning" showIcon message="Reputação indisponível" description={reputationError} action={<Button size="small" onClick={() => void fetchReputation()}>Tentar novamente</Button>} style={{ marginBottom: 12 }} />}
            {reputationLoading && !reputacao ? <Skeleton active paragraph={{ rows: 5 }} /> : reputacao?.nivel === 'Desconectado' || reputacao?.conectado === false ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Space direction="vertical"><Text>Mercado Livre desconectado.</Text><Button href="/configuracoes" type="primary" size="small">Revisar integração</Button></Space>} />
            ) : reputacao ? (
              <>
                <Row justify="space-between" align="middle" style={{ marginBottom: 18 }}><Col><Text type="secondary">Nível atual</Text><Title level={3} style={{ color: reputacao.nivelCor, margin: '2px 0 0' }}>{reputacao.nivel}</Title></Col><Col><Text type="secondary">{reputacao.positivas === null ? 'Avaliação em andamento' : `${reputacao.positivas.toFixed(1)}% positivas`}</Text></Col></Row>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  {[{ label: 'Reclamações', value: reputacao.reclamacoes, limit: 2 }, { label: 'Atrasos no envio', value: reputacao.atrasos, limit: 10 }, { label: 'Cancelamentos', value: reputacao.cancelamentos, limit: 1.5 }].map((metric) => {
                    const healthy = metric.value !== null && metric.value <= metric.limit;
                    return <div key={metric.label}><Row justify="space-between"><Text>{metric.label}</Text><Text strong>{metric.value === null ? '—' : `${metric.value.toFixed(2)}%`}</Text></Row>{metric.value !== null && <Progress percent={Math.min(100, (metric.value / (metric.limit * 2)) * 100)} strokeColor={healthy ? token.colorSuccess : token.colorError} showInfo={false} size="small" />}</div>;
                  })}
                </Space>
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Reputação não disponível." />}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Integrações e sincronização" extra={<Link href="/configuracoes">Gerenciar <ArrowRightOutlined /></Link>} style={{ height: '100%' }}>
            {integrationsError && <Alert type="warning" showIcon message="Estado das integrações parcialmente indisponível" description={integrationsError} action={<Button size="small" onClick={() => void fetchIntegrations()}>Tentar novamente</Button>} style={{ marginBottom: 12 }} />}
            {integrationsLoading && integracoes.length === 0 ? <Skeleton active paragraph={{ rows: 4 }} title={false} /> : (
              <Row gutter={[8, 8]}>{integracoes.map((integration) => <Col xs={12} key={integration.label}><Card size="small" styles={{ body: { padding: 10 } }}><Text strong ellipsis style={{ display: 'block' }}>{integration.label}</Text><Tag color={integration.on ? 'success' : 'error'} style={{ marginTop: 6, marginInlineEnd: 0 }}>{integration.status}</Tag></Card></Col>)}</Row>
            )}
            <div style={{ borderTop: `1px solid ${token.colorBorder}`, marginTop: 16, paddingTop: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 10 }}>Sincronizações manuais</Text>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={8} align="middle" wrap={false}>
                  <Col flex="auto"><Button block icon={<SyncOutlined spin={syncStatus.dslite === 'running'} />} loading={syncStatus.dslite === 'running'} danger={syncStatus.dslite === 'error'} onClick={() => void triggerDsliteSync()} style={{ textAlign: 'left' }}>Sincronizar DSLite</Button></Col>
                  <Col flex="88px">{dsliteFeedback ? <Tag color={dsliteFeedback.color} style={{ margin: 0 }}>{dsliteFeedback.label}</Tag> : <Text type="secondary">Pronta</Text>}</Col>
                </Row>
                <Row gutter={8} align="middle" wrap={false}>
                  <Col flex="auto"><Button block icon={<SyncOutlined spin={syncStatus.anuncios === 'running'} />} loading={syncStatus.anuncios === 'running'} danger={syncStatus.anuncios === 'error'} onClick={() => void triggerMlSync('anuncios')} style={{ textAlign: 'left' }}>Sincronizar anúncios ML</Button></Col>
                  <Col flex="88px">{anunciosFeedback ? <Tag color={anunciosFeedback.color} style={{ margin: 0 }}>{anunciosFeedback.label}</Tag> : <Text type="secondary">Pronta</Text>}</Col>
                </Row>
                <Row gutter={8} align="middle" wrap={false}>
                  <Col flex="auto"><Button block icon={<SyncOutlined spin={syncStatus.pedidos === 'running'} />} loading={syncStatus.pedidos === 'running'} danger={syncStatus.pedidos === 'error'} onClick={() => void triggerMlSync('pedidos')} style={{ textAlign: 'left' }}>Sincronizar pedidos ML</Button></Col>
                  <Col flex="88px">{pedidosFeedback ? <Tag color={pedidosFeedback.color} style={{ margin: 0 }}>{pedidosFeedback.label}</Tag> : <Text type="secondary">Pronta</Text>}</Col>
                </Row>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
