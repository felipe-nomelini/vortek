'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Row, Col, Statistic, Tag, Typography, Table, Progress, Button, Space, message, DatePicker, Spin, Select,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined, LoadingOutlined, TrophyFilled, SyncOutlined,
} from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@/lib/format';
import dayjs, { Dayjs } from 'dayjs';


const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const cardBg = { background: '#141414', border: '1px solid #303030', borderRadius: 8 };

const statusLabel: Record<string, string> = {
  aberto: 'Aberto',
  pendente: 'Pendente',
  preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta Impressa',
  coletado: 'Coletado',
  em_transito: 'Em Trânsito',
  saiu_entrega: 'Saiu para Entrega',
  dest_ausente: 'Dest. Ausente',
  atendido: 'Atendido',
  faturado: 'Faturado',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};

const statusColor: Record<string, string> = {
  aberto: '#1677ff',
  pendente: '#fa8c16',
  preparando: '#1677ff',
  pronto_envio: '#13c2c2',
  etiqueta_impressa: '#1677ff',
  coletado: '#2f54eb',
  em_transito: '#722ed1',
  saiu_entrega: '#13c2c2',
  dest_ausente: '#ff4d4f',
  atendido: '#1677ff',
  faturado: '#722ed1',
  entregue: '#52c41a',
  recusado: '#ff4d4f',
  devolvido: '#eb2f96',
  cancelado: '#888',
};

const datePresets: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: 'Últimos 7 dias', value: [dayjs().subtract(6, 'day'), dayjs()] },
  { label: 'Últimos 30 dias', value: [dayjs().subtract(29, 'day'), dayjs()] },
  { label: 'Este mês', value: [dayjs().startOf('month'), dayjs()] },
  { label: 'Mês passado', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
];

interface DashboardData {
  faturamento: number;
  lucro: number;
  totalPedidos: number;
  ticketMedio: number;
  vendasDiarias: { dia: string; receita: number }[];
  statusCounts: Record<string, number>;
  pedidosRecentes: { numero: number; cliente: string; total: number; situacao: string; data: string }[];
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
}

interface IntegracaoData {
  label: string;
  status: string;
  on: boolean;
}

type SyncJobStatus = 'pendente' | 'rodando' | 'completo' | 'completo_parcial' | 'erro' | 'cancelado';
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
    last_event?: {
      event_type: string | null;
      message: string | null;
      timestamp: string | null;
    } | null;
    updated_at?: string | null;
  };
  failures?: string[];
  error?: string;
}

const topColumns = [
  {
    title: '', dataIndex: 'rank', key: 'rank', width: 36,
    render: (r: number) => r <= 3
      ? <TrophyFilled style={{ color: ['#ffd700', '#c0c0c0', '#cd7f32'][r - 1], fontSize: 16 }} />
      : <span style={{ color: '#666', fontSize: 13 }}>{r}º</span>,
  },
  { title: 'Produto', dataIndex: 'nome', key: 'nome', render: (n: string) => <span style={{ color: '#c0c0c0', fontSize: 13 }}>{n}</span> },
  { title: 'Vendas', dataIndex: 'vendas', key: 'vendas', width: 60, render: (v: number) => <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{v || '—'}</span> },
  { title: 'Receita', dataIndex: 'receita', key: 'receita', width: 90, render: (r: number) => <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{r ? formatCurrency(r) : '—'}</span> },
];

const recentColumns = [
  { title: 'Pedido', dataIndex: 'num', key: 'num', width: 85, render: (n: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{n}</span> },
  { title: 'Cliente', dataIndex: 'cliente', key: 'cliente', render: (c: string) => <span style={{ fontSize: 13 }}>{c}</span> },
  { title: 'Total', dataIndex: 'total', key: 'total', width: 90, render: (t: number) => <span style={{ fontSize: 13 }}>{t ? formatCurrency(t) : '—'}</span> },
  { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (s: string, r: any) => <Tag color={r.cor || '#888'} style={{ margin: 0 }}>{s}</Tag> },
  { title: 'Data', dataIndex: 'data', key: 'data', width: 100, render: (d: string) => <span style={{ color: '#a0a0a0', fontSize: 12 }}>{d}</span> },
];

function Trend({ value, label }: { value: number; label: string }) {
  const up = value >= 0;
  return (
    <span style={{ color: up ? '#52c41a' : '#ff4d4f', fontSize: 12, display: 'flex', alignItems: 'center', gap: 2 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {Math.abs(value)}% {label}
    </span>
  );
}

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day'), dayjs()]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reputacao, setReputacao] = useState<ReputacaoData | null>(null);
  const [integracoes, setIntegracoes] = useState<IntegracaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  const [redirecting, setRedirecting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const dslitePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dsliteJobRef = useRef<string | null>(null);
  const dslitePollingInFlightRef = useRef(false);
  const dslitePollingStartedAtRef = useRef<number | null>(null);
  const mlPollRefs = useRef<Record<MlSyncTipo, ReturnType<typeof setTimeout> | null>>({ anuncios: null, pedidos: null });
  const mlJobRefs = useRef<Record<MlSyncTipo, string | null>>({ anuncios: null, pedidos: null });
  const mlPollingInFlightRefs = useRef<Record<MlSyncTipo, boolean>>({ anuncios: false, pedidos: false });
  const mlPollingStartedAtRefs = useRef<Record<MlSyncTipo, number | null>>({ anuncios: null, pedidos: null });


  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [from, to] = dateRange;
      const params = new URLSearchParams({
        dateFrom: from.format('YYYY-MM-DD'),
        dateTo: to.format('YYYY-MM-DD'),
      });

      const [dashRes, repRes, intRes] = await Promise.all([
        fetch(`/api/dashboard/resumo?${params}`),
        fetch('/api/ml/reputacao'),
        fetch('/api/integracoes/status'),
      ]);

      if (dashRes.ok) setDashboard(await dashRes.json());
      if (repRes.ok) setReputacao(await repRes.json());
      if (intRes.ok) {
        const json = await intRes.json();
        setIntegracoes(json.integracoes || []);
      }
    } catch (err) {
      messageApi.error('Erro ao carregar dados do dashboard');
    } finally {
      setLoading(false);
    }
  }, [dateRange, messageApi]);

  const clearDslitePolling = useCallback(() => {
    if (dslitePollRef.current) {
      clearTimeout(dslitePollRef.current);
      dslitePollRef.current = null;
    }
    dsliteJobRef.current = null;
    dslitePollingInFlightRef.current = false;
    dslitePollingStartedAtRef.current = null;
  }, []);

  const finalizeDsliteSync = useCallback((shouldReloadDashboard: boolean) => {
    clearDslitePolling();
    setSyncStatus(prev => ({ ...prev, dslite: 'done' }));
    if (shouldReloadDashboard) {
      fetchData();
    }
    setTimeout(() => {
      setSyncStatus(prev => ({ ...prev, dslite: 'idle' }));
    }, 3000);
  }, [clearDslitePolling, fetchData]);

  const pollDsliteJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/sync/dslite/status?jobId=${encodeURIComponent(jobId)}`);
    const payload: SyncJobStatusResponse = await res.json().catch(() => ({ success: false }));

    if (!res.ok || !payload.success || !payload.job) {
      throw new Error(payload.error || 'Não foi possível consultar o status da sincronização');
    }

    const currentStatus = payload.job.status;
    if (currentStatus === 'pendente' || currentStatus === 'rodando') {
      return;
    }

    if (currentStatus === 'completo') {
      messageApi.success('Sync DSLite concluído com sucesso!');
      finalizeDsliteSync(true);
      return;
    }

    if (currentStatus === 'completo_parcial') {
      const detalhes = (payload.failures || []).slice(0, 2).join(' | ');
      const msg = detalhes
        ? `Sync DSLite concluído com alertas: ${detalhes}`
        : 'Sync DSLite concluído com alertas';
      messageApi.warning(msg);
      finalizeDsliteSync(true);
      return;
    }

    if (currentStatus === 'erro' || currentStatus === 'cancelado') {
      const detalheErro = payload.failures?.[0] || 'Falha na sincronização DSLite';
      messageApi.error(detalheErro);
      finalizeDsliteSync(false);
      return;
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

    const delay = getAdaptiveDslitePollingInterval();
    dslitePollRef.current = setTimeout(() => {
      const runningJobId = dsliteJobRef.current;
      if (!runningJobId) return;
      if (dslitePollingInFlightRef.current) {
        scheduleNextDslitePoll();
        return;
      }

      dslitePollingInFlightRef.current = true;
      pollDsliteJob(runningJobId)
        .catch((err: any) => {
          messageApi.error(err?.message || 'Erro ao consultar status da sincronização DSLite');
          finalizeDsliteSync(false);
        })
        .finally(() => {
          dslitePollingInFlightRef.current = false;
          if (dsliteJobRef.current === runningJobId) {
            scheduleNextDslitePoll();
          }
        });
    }, delay);
  }, [finalizeDsliteSync, getAdaptiveDslitePollingInterval, messageApi, pollDsliteJob]);

  const startDslitePolling = useCallback((jobId: string) => {
    clearDslitePolling();
    dsliteJobRef.current = jobId;
    dslitePollingStartedAtRef.current = Date.now();
    scheduleNextDslitePoll();
  }, [clearDslitePolling, scheduleNextDslitePoll]);

  const resumeDsliteSyncIfRunning = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/dslite/status');
      const payload: SyncJobStatusResponse = await res.json().catch(() => ({ success: false }));

      if (!res.ok || !payload.success || !payload.job) {
        return;
      }

      if (payload.job.status === 'pendente' || payload.job.status === 'rodando') {
        setSyncStatus(prev => ({ ...prev, dslite: 'running' }));
        startDslitePolling(payload.job.id);
        await pollDsliteJob(payload.job.id);
      }
    } catch {
      // Retomada silenciosa: ignora erros de reattach no mount.
    }
  }, [pollDsliteJob, startDslitePolling]);

  const clearMlPolling = useCallback((tipo: MlSyncTipo) => {
    const timer = mlPollRefs.current[tipo];
    if (timer) {
      clearTimeout(timer);
      mlPollRefs.current[tipo] = null;
    }
    mlJobRefs.current[tipo] = null;
    mlPollingInFlightRefs.current[tipo] = false;
    mlPollingStartedAtRefs.current[tipo] = null;
  }, []);

  const finalizeMlSync = useCallback((tipo: MlSyncTipo, shouldReloadDashboard: boolean) => {
    clearMlPolling(tipo);
    setSyncStatus(prev => ({ ...prev, [tipo]: 'done' }));
    if (shouldReloadDashboard) {
      fetchData();
    }
    setTimeout(() => {
      setSyncStatus(prev => ({ ...prev, [tipo]: 'idle' }));
    }, 3000);
  }, [clearMlPolling, fetchData]);

  const getAdaptiveMlPollingInterval = useCallback((tipo: MlSyncTipo) => {
    const startedAt = mlPollingStartedAtRefs.current[tipo];
    if (!startedAt) return 2000;
    const elapsed = Date.now() - startedAt;
    if (elapsed > 180000) return 5000;
    if (elapsed > 60000) return 4000;
    return 2000;
  }, []);

  const pollMlJob = useCallback(async (tipo: MlSyncTipo, jobId: string) => {
    const res = await fetch(`/api/sync/${tipo}/status?jobId=${encodeURIComponent(jobId)}`);
    const payload: SyncJobStatusResponse = await res.json().catch(() => ({ success: false }));

    if (!res.ok || !payload.success || !payload.job) {
      throw new Error(payload.error || `Não foi possível consultar o status do sync de ${tipo}`);
    }

    const currentStatus = payload.job.status;
    if (currentStatus === 'pendente' || currentStatus === 'rodando') {
      return;
    }

    const tipoLabel = tipo === 'anuncios' ? 'Anúncios ML' : 'Pedidos ML';

    if (currentStatus === 'completo') {
      messageApi.success(`Sync ${tipoLabel} concluído com sucesso!`);
      finalizeMlSync(tipo, true);
      return;
    }

    if (currentStatus === 'completo_parcial') {
      const detalhes = (payload.failures || []).slice(0, 2).join(' | ');
      const msg = detalhes
        ? `Sync ${tipoLabel} concluído com alertas: ${detalhes}`
        : `Sync ${tipoLabel} concluído com alertas`;
      messageApi.warning(msg);
      finalizeMlSync(tipo, true);
      return;
    }

    if (currentStatus === 'erro' || currentStatus === 'cancelado') {
      const detalheErro = payload.failures?.[0] || `Falha na sincronização de ${tipoLabel}`;
      messageApi.error(detalheErro);
      finalizeMlSync(tipo, false);
    }
  }, [finalizeMlSync, messageApi]);

  const scheduleNextMlPoll = useCallback((tipo: MlSyncTipo) => {
    const currentJobId = mlJobRefs.current[tipo];
    if (!currentJobId) return;

    const delay = getAdaptiveMlPollingInterval(tipo);
    mlPollRefs.current[tipo] = setTimeout(() => {
      const runningJobId = mlJobRefs.current[tipo];
      if (!runningJobId) return;
      if (mlPollingInFlightRefs.current[tipo]) {
        scheduleNextMlPoll(tipo);
        return;
      }

      mlPollingInFlightRefs.current[tipo] = true;
      pollMlJob(tipo, runningJobId)
        .catch((err: any) => {
          messageApi.error(err?.message || `Erro ao consultar status do sync de ${tipo}`);
          finalizeMlSync(tipo, false);
        })
        .finally(() => {
          mlPollingInFlightRefs.current[tipo] = false;
          if (mlJobRefs.current[tipo] === runningJobId) {
            scheduleNextMlPoll(tipo);
          }
        });
    }, delay);
  }, [finalizeMlSync, getAdaptiveMlPollingInterval, messageApi, pollMlJob]);

  const startMlPolling = useCallback((tipo: MlSyncTipo, jobId: string) => {
    clearMlPolling(tipo);
    mlJobRefs.current[tipo] = jobId;
    mlPollingStartedAtRefs.current[tipo] = Date.now();
    scheduleNextMlPoll(tipo);
  }, [clearMlPolling, scheduleNextMlPoll]);

  const resumeMlSyncIfRunning = useCallback(async (tipo: MlSyncTipo) => {
    try {
      const res = await fetch(`/api/sync/${tipo}/status`);
      const payload: SyncJobStatusResponse = await res.json().catch(() => ({ success: false }));

      if (!res.ok || !payload.success || !payload.job) {
        return;
      }

      if (payload.job.status === 'pendente' || payload.job.status === 'rodando') {
        setSyncStatus(prev => ({ ...prev, [tipo]: 'running' }));
        startMlPolling(tipo, payload.job.id);
        await pollMlJob(tipo, payload.job.id);
      }
    } catch {
      // Retomada silenciosa
    }
  }, [pollMlJob, startMlPolling]);

  useEffect(() => {
    fetch('/api/ml/estado')
      .then(r => r.json())
      .then(({ conectado, precisaReconectar, erro }) => {
        if (precisaReconectar) {
          setRedirecting(true);
          messageApi.warning('Token do Mercado Livre expirado. Redirecionando para reconexão...');
          setTimeout(() => {
            window.location.href = '/api/integracao/ml/connect';
          }, 2000);
        } else {
          if (erro && conectado) {
            messageApi.warning('Mercado Livre instável no momento. Tentando novamente em background.');
          }
          fetchData();
          void Promise.all([
            resumeDsliteSyncIfRunning(),
            resumeMlSyncIfRunning('anuncios'),
            resumeMlSyncIfRunning('pedidos'),
          ]);
        }
      })
      .catch(() => {
        fetchData();
        void Promise.all([
          resumeDsliteSyncIfRunning(),
          resumeMlSyncIfRunning('anuncios'),
          resumeMlSyncIfRunning('pedidos'),
        ]);
      });
  }, [fetchData, messageApi, resumeDsliteSyncIfRunning, resumeMlSyncIfRunning]);

  useEffect(() => {
    return () => {
      clearDslitePolling();
      clearMlPolling('anuncios');
      clearMlPolling('pedidos');
    };
  }, [clearDslitePolling, clearMlPolling]);

  const triggerSyncMl = useCallback(async (tipo: MlSyncTipo) => {
    setSyncStatus(prev => ({ ...prev, [tipo]: 'running' }));
    const tipoLabel = tipo === 'anuncios' ? 'Anúncios ML' : 'Pedidos ML';

    try {
      const res = await fetch(`/api/sync/${tipo}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success || !data?.jobId) {
        messageApi.error(data?.error || `Erro ao iniciar sync de ${tipoLabel}`);
        setSyncStatus(prev => ({ ...prev, [tipo]: 'idle' }));
        return;
      }

      if (data.reused) {
        messageApi.info(`Já existe um sync ${tipoLabel} em andamento. Acompanhando progresso atual.`);
      } else {
        messageApi.info(`Sync ${tipoLabel} iniciado.`);
      }

      startMlPolling(tipo, String(data.jobId));
      await pollMlJob(tipo, String(data.jobId));
    } catch (err: any) {
      messageApi.error(err?.message || `Erro ao iniciar sync de ${tipoLabel}`);
      finalizeMlSync(tipo, false);
      setSyncStatus(prev => ({ ...prev, [tipo]: 'idle' }));
    }
  }, [finalizeMlSync, messageApi, pollMlJob, startMlPolling]);

  const triggerSyncDslite = async () => {
    setSyncStatus(prev => ({ ...prev, dslite: 'running' }));
    messageApi.info('Sync DSLite iniciado, isso pode levar alguns minutos.');

    try {
      const res = await fetch('/api/sync/dslite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success || !data?.jobId) {
        messageApi.error(data?.error || 'Falha ao iniciar sincronização DSLite');
        setSyncStatus(prev => ({ ...prev, dslite: 'idle' }));
        return;
      }

      if (data.reused) {
        messageApi.info('Já existe uma sincronização DSLite em andamento. Acompanhando progresso atual.');
      }

      startDslitePolling(String(data.jobId));
      await pollDsliteJob(String(data.jobId));
    } catch (err: any) {
      messageApi.error(err?.message || 'Erro ao iniciar sync DSLite');
      finalizeDsliteSync(false);
    }
  };

  const totalStatus = useMemo(() => {
    if (!dashboard) return [];
    const entries = Object.entries(dashboard.statusCounts);
    const total = entries.reduce((sum, [, c]) => sum + c, 0);
    return entries.map(([status, count]) => ({
      status: statusLabel[status] || status,
      qtd: count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
      cor: statusColor[status] || '#888',
    })).sort((a, b) => b.qtd - a.qtd);
  }, [dashboard]);

  const pedidosRecentesData = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.pedidosRecentes.map((p, i) => ({
      key: String(i),
      num: `#${String(p.numero).padStart(6, '0')}`,
      cliente: p.cliente,
      total: p.total,
      status: statusLabel[p.situacao] || p.situacao,
      cor: statusColor[p.situacao] || '#888',
      data: dayjs(p.data).format('DD/MM HH:mm'),
    }));
  }, [dashboard]);

  const topProdutosData = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.topProdutos.map((p, i) => ({ ...p, rank: i + 1 }));
  }, [dashboard]);

  const handleDateChange = (dates: any) => {
    if (dates && dates[0] && dates[1]) {
      setDateRange([dates[0], dates[1]]);
    }
  };

  return (
    <div>
      {contextHolder}
      {redirecting ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '60vh', gap: 16,
        }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
          <Text style={{ color: '#e0e0e0', fontSize: 16 }}>Token do Mercado Livre expirado</Text>
          <Text style={{ color: '#888', fontSize: 13 }}>Redirecionando para reconexão automática...</Text>
        </div>
      ) : (
        <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <Title level={4} style={{ color: '#e0e0e0', margin: 0 }}>Dashboard</Title>
          <Space>
            <Select
              size="small"
              style={{ width: 140 }}
              placeholder="Período"
              options={datePresets.map(p => ({ label: p.label, value: p.label }))}
              onChange={(val) => {
                const preset = datePresets.find(p => p.label === val);
                if (preset) setDateRange(preset.value);
              }}
              defaultValue="Últimos 7 dias"
            />
            <RangePicker
              size="small"
              value={dateRange}
              onChange={handleDateChange}
              presets={datePresets.map(p => ({ label: p.label, value: p.value }))}
              style={{ background: '#141414', borderColor: '#303030' }}
            />
          </Space>
        </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          {[
            { title: 'Faturamento', value: dashboard?.faturamento ?? 0, prefix: 'R$', color: '#1677ff' },
            { title: 'Pedidos', value: dashboard?.totalPedidos ?? 0, color: '#52c41a' },
            { title: 'Ticket Médio', value: dashboard?.ticketMedio ?? 0, prefix: 'R$', color: '#faad14' },
            { title: 'Lucro', value: dashboard?.lucro ?? 0, prefix: 'R$', color: '#722ed1' },
          ].map(card => (
            <Col xs={12} lg={6} key={card.title}>
              <Card styles={{ body: { padding: '16px 20px' } }} style={cardBg}>
                <Statistic
                  title={<span style={{ color: '#a0a0a0', fontSize: 12 }}>{card.title}</span>}
                  value={card.value}
                  precision={card.prefix ? 2 : 0}
                  prefix={card.prefix ? <span style={{ fontSize: 16 }}>{card.prefix}</span> : undefined}
                  valueStyle={{ color: '#e0e0e0', fontSize: 26, fontWeight: 700 }}
                  suffix={card.value === 0 && loading ? null : undefined}
                />
                {card.value === 0 && !loading && (
                  <Text style={{ color: '#666', fontSize: 12 }}>—</Text>
                )}
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} lg={14}>
            <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
              <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                Vendas - Período
              </Title>
              {dashboard?.vendasDiarias && dashboard.vendasDiarias.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dashboard.vendasDiarias} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="dia" tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(dashboard.vendasDiarias.length / 6)} />
                    <YAxis tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`} />
                    <Tooltip
                      contentStyle={{ background: '#1f1f1f', border: '1px solid #303030', borderRadius: 6 }}
                      labelStyle={{ color: '#a0a0a0' }}
                      formatter={(val: any) => formatCurrency(Number(val))}
                    />
                    <Bar dataKey="receita" fill="#5aab2c" radius={[4, 4, 0, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#666' }}>Sem dados de vendas no período</Text>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
              <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                Status dos Pedidos
              </Title>
              {totalStatus.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {totalStatus.map(s => (
                    <div key={s.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 5, background: s.cor }} />
                          <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{s.status}</Text>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{s.qtd}</Text>
                          <Text style={{ color: '#666', fontSize: 13 }}>{s.pct}%</Text>
                        </div>
                      </div>
                      <Progress percent={s.pct} strokeColor={s.cor} trailColor="#303030" size="small" showInfo={false} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#666' }}>Sem dados de pedidos no período</Text>
                </div>
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} lg={8}>
            <Card styles={{ body: { padding: 20 } }} style={cardBg}>
              <Title level={5} style={{ color: '#a0a0a0', marginBottom: 12, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                Top Produtos
              </Title>
              {topProdutosData.length > 0 ? (
                <>
                  <Table
                    dataSource={topProdutosData}
                    columns={topColumns}
                    rowKey="rank"
                    pagination={false}
                    size="small"
                    style={{ background: 'transparent' }}
                    showHeader={false}
                  />
                  <div style={{ marginTop: 8 }}>
                    <a style={{ color: '#1677ff', fontSize: 12 }} href="/produtos">Ver todos os produtos →</a>
                  </div>
                </>
              ) : (
                <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#666' }}>Sem dados de produtos</Text>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Card styles={{ body: { padding: 20 } }} style={cardBg}>
              <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                Saúde do Negócio
              </Title>
              {reputacao && reputacao.nivel !== 'Desconectado' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[
                    { label: 'Reclamações', rate: reputacao.reclamacoes, max: 2 },
                    { label: 'Atraso na Entrega', rate: reputacao.atrasos, max: 10 },
                    { label: 'Cancelamentos', rate: reputacao.cancelamentos, max: 1.5 },
                  ].map(m => {
                    const rate = m.rate ?? 0;
                    const good = m.rate !== null && rate <= m.max;
                    return (
                      <div key={m.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{m.label}</Text>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>
                              {m.rate !== null ? `${rate}%` : '—'}
                            </Text>
                            {m.rate !== null && (
                              <div style={{ width: 8, height: 8, borderRadius: 4, background: good ? '#52c41a' : '#ff4d4f' }} />
                            )}
                          </div>
                        </div>
                        {m.rate !== null && (
                          <Progress
                            percent={(rate / (m.max * 2)) * 100}
                            strokeColor={good ? '#5aab2c' : '#ff4d4f'}
                            trailColor="#303030"
                            size="small"
                            showInfo={false}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div style={{ borderTop: '1px solid #303030', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, color: reputacao.nivelCor }}>🏆</span>
                    <div>
                      <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{reputacao.nivel}</Text>
                      <br />
                      <Text style={{ color: '#808080', fontSize: 12 }}>
                        {reputacao.positivas !== null ? `Reputação ${reputacao.nivelKey} · ${reputacao.positivas}% positivas` : 'Reputação em análise'}
                      </Text>
                    </div>
                  </div>
                </div>
              ) : reputacao?.nivel === 'Desconectado' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
                  <Text style={{ color: '#888', fontSize: 14 }}>Mercado Livre Desconectado</Text>
                  <Text style={{ color: '#666', fontSize: 12 }}>Reconecte para ver métricas de reputação</Text>
                  <Button type="primary" href="/api/integracao/ml/connect" size="small">
                    Reconectar ML
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
                  <Text style={{ color: '#666' }}>Carregando...</Text>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Card styles={{ body: { padding: 20 } }} style={cardBg}>
              <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                Integrações
              </Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {integracoes.map(i => (
                  <div key={i.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 6, background: i.on ? '#111d2e' : '#1a1a1a', border: `1px solid ${i.on ? '#1677ff' : '#303030'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 5, background: i.on ? '#1677ff' : '#555' }} />
                      <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{i.label}</Text>
                    </div>
                    <Tag color={i.on ? 'green' : 'default'} style={{ margin: 0, fontSize: 11 }}>{i.status}</Tag>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <a style={{ color: '#1677ff', fontSize: 12 }} href="/configuracoes">Gerenciar integrações →</a>
              </div>
              <div style={{ borderTop: '1px solid #303030', marginTop: 16, paddingTop: 16 }}>
                <Text style={{ color: '#a0a0a0', fontSize: 12, display: 'block', marginBottom: 10 }}>Sincronizações</Text>
                <Space direction="vertical" style={{ width: '100%' }} size={6}>
                  <Button
                    size="small"
                    block
                    type="primary"
                    icon={<SyncOutlined spin={syncStatus['dslite'] === 'running'} />}
                    loading={syncStatus['dslite'] === 'running'}
                    onClick={triggerSyncDslite}
                    style={{ textAlign: 'left', height: 32 }}
                  >
                    {syncStatus['dslite'] === 'done' ? '✅' : ''} Sync DSLite
                  </Button>
                  <Button
                    size="small"
                    block
                    icon={<SyncOutlined spin={syncStatus['anuncios'] === 'running'} />}
                    loading={syncStatus['anuncios'] === 'running'}
                    onClick={() => triggerSyncMl('anuncios')}
                    style={{ textAlign: 'left', height: 32 }}
                  >
                    {syncStatus['anuncios'] === 'done' ? '✅' : ''} Sync Anúncios ML
                  </Button>
                  <Button
                    size="small"
                    block
                    icon={<SyncOutlined spin={syncStatus['pedidos'] === 'running'} />}
                    loading={syncStatus['pedidos'] === 'running'}
                    onClick={() => triggerSyncMl('pedidos')}
                    style={{ textAlign: 'left', height: 32 }}
                  >
                    {syncStatus['pedidos'] === 'done' ? '✅' : ''} Sync Pedidos ML
                  </Button>
                </Space>
              </div>
            </Card>
          </Col>
        </Row>

        <Card styles={{ body: { padding: 20 } }} style={cardBg}>
          <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
            Pedidos Recentes
          </Title>
          {pedidosRecentesData.length > 0 ? (
            <Table
              dataSource={pedidosRecentesData}
              columns={recentColumns}
              rowKey="key"
              pagination={false}
              size="small"
              style={{ background: 'transparent' }}
            />
          ) : (
            <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#666' }}>Sem pedidos no período</Text>
            </div>
          )}
        </Card>
      </Spin>
        </>
      )}
    </div>
  );
}
