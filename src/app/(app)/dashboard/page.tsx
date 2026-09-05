'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Empty,
  Progress,
  Segmented,
  Skeleton,
  Statistic,
  Tag,
  Tooltip as AntTooltip,
  Typography,
  theme,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  ReloadOutlined,
  RiseOutlined,
  ThunderboltFilled,
  TrophyFilled,
} from '@ant-design/icons';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/format';
import styles from './dashboard.module.css';

const { Text, Title } = Typography;

type DashboardPreset = 'today' | '7d' | '30d';
type ChartMetric = 'revenue' | 'profit' | 'orders';

type Summary = {
  revenue: number;
  profit: number;
  orders: number;
  averageTicket: number;
  margin: number;
  profitPending: number;
  averageKnownProfit: number | null;
};

interface DashboardData {
  generatedAt: string;
  period: {
    preset: DashboardPreset;
    days: number;
    currentFrom: string;
    currentTo: string;
    previousFrom: string;
    previousTo: string;
  };
  performance: {
    current: Summary;
    previous: Summary;
    deltas: {
      revenue: number | null;
      profit: number | null;
      orders: number | null;
      averageTicket: number | null;
      marginPoints: number;
    };
  };
  profitGoal: {
    target: number;
    actual: number;
    percentage: number;
    remaining: number;
    estimatedOrdersRemaining: number | null;
  };
  timeline: Array<{
    label: string;
    current: Record<ChartMetric, number>;
    previous: Record<ChartMetric, number>;
  }>;
  operation: {
    urgent: number;
    preparation: number;
    shipping: number;
    delivered: number;
  };
  topProducts: Array<{
    id: string;
    name: string;
    sku: string | null;
    units: number;
    revenue: number;
  }>;
  recentOrders: Array<{
    id?: string | null;
    number?: number | null;
    customer: string;
    total: number;
    profit: number | null;
    status: string;
    date?: string | null;
  }>;
}

const presetOptions = [
  { label: 'Hoje', value: 'today' },
  { label: '7 dias', value: '7d' },
  { label: '30 dias', value: '30d' },
];

const metricOptions = [
  { label: 'Faturamento', value: 'revenue' },
  { label: 'Lucro', value: 'profit' },
  { label: 'Pedidos', value: 'orders' },
];

const statusLabels: Record<string, string> = {
  aberto: 'Aberto',
  pendente: 'Pendente',
  preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta impressa',
  faturado: 'Faturado',
  coletado: 'Coletado',
  em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu para entrega',
  dest_ausente: 'Destinatário ausente',
  atendido: 'Atendido',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  concretizada_ml: 'Concretizada pelo ML',
  cancelado: 'Cancelado',
};

const statusColors: Record<string, string> = {
  aberto: 'blue',
  pendente: 'orange',
  preparando: 'processing',
  pronto_envio: 'cyan',
  etiqueta_impressa: 'blue',
  faturado: 'purple',
  coletado: 'geekblue',
  em_transito: 'purple',
  saiu_entrega: 'cyan',
  dest_ausente: 'red',
  atendido: 'processing',
  entregue: 'green',
  recusado: 'red',
  devolvido: 'magenta',
  concretizada_ml: 'gold',
  cancelado: 'default',
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Erro ao carregar o dashboard';
}

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => null) as { erro?: string } | null;
  return new Error(payload?.erro || 'Falha ao carregar o dashboard');
}

function Delta({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return <Text type="secondary" className={styles.delta}>Sem base anterior</Text>;
  }
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span className={`${styles.delta} ${positive ? styles.deltaPositive : negative ? styles.deltaNegative : ''}`}>
      {positive ? <ArrowUpOutlined /> : negative ? <ArrowDownOutlined /> : null}
      {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{suffix}
    </span>
  );
}

function periodDescription(preset: DashboardPreset): string {
  if (preset === 'today') return 'hoje contra ontem até o mesmo horário';
  return `últimos ${preset === '30d' ? 30 : 7} dias contra o período anterior`;
}

function chartValue(value: number, metric: ChartMetric): string {
  return metric === 'orders' ? String(value) : formatCurrency(value);
}

export default function DashboardPage() {
  const { token } = theme.useToken();
  const [preset, setPreset] = useState<DashboardPreset>('7d');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('revenue');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const fetchDashboard = useCallback(async (selectedPreset: DashboardPreset) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/resumo?preset=${selectedPreset}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw await responseError(response);
      const payload = await response.json() as DashboardData;
      if (sequence === requestSequence.current) setDashboard(payload);
    } catch (fetchError) {
      if (sequence === requestSequence.current) setError(errorMessage(fetchError));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard(preset);
  }, [fetchDashboard, preset]);

  const chartData = useMemo(() => (dashboard?.timeline || []).map((point) => ({
    label: point.label,
    current: point.current[chartMetric],
    previous: point.previous[chartMetric],
  })), [chartMetric, dashboard]);

  const current = dashboard?.performance.current;
  const deltas = dashboard?.performance.deltas;
  const goal = dashboard?.profitGoal;
  const goalPercent = Math.max(0, Math.min(100, goal?.percentage || 0));
  const goalReached = Boolean(goal && goal.actual >= goal.target);
  const maxProductRevenue = Math.max(1, ...(dashboard?.topProducts || []).map((product) => product.revenue));

  const operationItems = dashboard ? [
    {
      label: 'Exigem ação',
      value: dashboard.operation.urgent,
      detail: 'Priorize bloqueios',
      href: '/pedidos?view=urgent',
      tone: 'urgent',
    },
    {
      label: 'Em preparação',
      value: dashboard.operation.preparation,
      detail: 'Compra, fiscal e etiqueta',
      href: '/pedidos?view=preparation',
      tone: 'preparation',
    },
    {
      label: 'Em transporte',
      value: dashboard.operation.shipping,
      detail: 'Acompanhe a entrega',
      href: '/pedidos?view=shipping',
      tone: 'shipping',
    },
    {
      label: 'Entregues no período',
      value: dashboard.operation.delivered,
      detail: 'Fluxos concluídos',
      href: '/pedidos?view=delivered',
      tone: 'delivered',
    },
  ] : [];

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <Title level={2} className={styles.title}>Dashboard</Title>
          <Text type="secondary">Resultado, ritmo de vendas e operação em uma única leitura.</Text>
          <Text type="secondary" className={styles.updatedAt}>
            {dashboard?.generatedAt
              ? `Atualizado às ${dayjs(dashboard.generatedAt).format('HH:mm:ss')}`
              : 'Aguardando primeira atualização'}
          </Text>
        </div>
        <div className={styles.headerActions}>
          <Segmented
            aria-label="Período do dashboard"
            options={presetOptions}
            value={preset}
            onChange={(value) => setPreset(value as DashboardPreset)}
            shape="round"
          />
          <Button
            aria-label="Atualizar dashboard"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void fetchDashboard(preset)}
          >
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Dashboard indisponível"
          description={`${error}${dashboard ? ' Os últimos dados carregados foram preservados.' : ''}`}
          action={<Button size="small" onClick={() => void fetchDashboard(preset)}>Tentar novamente</Button>}
        />
      )}

      {loading && !dashboard ? (
        <div className={styles.initialLoading}>
          <Skeleton active paragraph={{ rows: 14 }} />
        </div>
      ) : dashboard && current && deltas && goal ? (
        <>
          <section className={styles.hero} aria-labelledby="profit-title">
            <div className={styles.heroResult}>
              <div className={styles.eyebrow}><RiseOutlined /> Resultado do período</div>
              <Statistic
                title={<span id="profit-title">Lucro</span>}
                value={current.profit}
                formatter={(value) => formatCurrency(Number(value))}
                valueStyle={{
                  color: current.profit < 0 ? token.colorError : token.colorText,
                  fontSize: 46,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  lineHeight: 1.05,
                }}
              />
              <div className={styles.heroComparison}>
                <Delta value={deltas.profit} />
                <Text type="secondary">{periodDescription(preset)}</Text>
              </div>

              <div className={styles.metricStrip}>
                <div>
                  <Text type="secondary">Faturamento</Text>
                  <strong>{formatCurrency(current.revenue)}</strong>
                  <Delta value={deltas.revenue} />
                </div>
                <div>
                  <Text type="secondary">Pedidos</Text>
                  <strong>{current.orders.toLocaleString('pt-BR')}</strong>
                  <Delta value={deltas.orders} />
                </div>
                <div>
                  <Text type="secondary">Ticket médio</Text>
                  <strong>{formatCurrency(current.averageTicket)}</strong>
                  <Delta value={deltas.averageTicket} />
                </div>
                <div>
                  <Text type="secondary">Margem</Text>
                  <strong>{current.margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong>
                  <Delta value={deltas.marginPoints} suffix=" p.p." />
                </div>
              </div>

              {current.profitPending > 0 && (
                <Text className={styles.pendingProfit}>
                  {current.profitPending} {current.profitPending === 1 ? 'venda ainda não entrou' : 'vendas ainda não entraram'} no cálculo de lucro.
                </Text>
              )}
            </div>

            <div className={styles.goalPanel}>
              <div className={styles.goalHeading}>
                <div>
                  <Text className={styles.goalKicker}><ThunderboltFilled /> Meta de lucro</Text>
                  <Title level={4}>{goalReached ? 'Meta batida!' : 'Rumo à meta'}</Title>
                </div>
                {goalReached && <CheckCircleFilled className={styles.goalSuccessIcon} />}
              </div>
              <Progress
                type="dashboard"
                percent={goalPercent}
                gapDegree={82}
                gapPosition="bottom"
                strokeWidth={9}
                strokeColor={goalReached ? token.colorSuccess : token.colorPrimary}
                trailColor="rgba(255,255,255,.10)"
                size={210}
                format={() => (
                  <span className={styles.goalProgressText}>
                    <strong>{Math.max(0, goal.percentage).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</strong>
                    <small>da meta</small>
                  </span>
                )}
              />
              <div className={styles.milestones} aria-label="Marcos da meta de lucro">
                {[25, 50, 75, 100].map((milestone) => (
                  <span key={milestone} className={goal.percentage >= milestone ? styles.milestoneReached : ''}>
                    {milestone}%
                  </span>
                ))}
              </div>
              <div className={styles.goalNumbers}>
                <span><small>Realizado</small><strong>{formatCurrency(goal.actual)}</strong></span>
                <span><small>Meta</small><strong>{formatCurrency(goal.target)}</strong></span>
              </div>
              <Text className={styles.goalNextStep}>
                {goalReached
                  ? `${formatCurrency(goal.actual - goal.target)} acima do objetivo.`
                  : goal.estimatedOrdersRemaining
                    ? `Faltam ${formatCurrency(goal.remaining)} — cerca de ${goal.estimatedOrdersRemaining} ${goal.estimatedOrdersRemaining === 1 ? 'pedido' : 'pedidos'} no lucro médio atual.`
                    : `Faltam ${formatCurrency(goal.remaining)} para alcançar o objetivo.`}
              </Text>
            </div>
          </section>

          <section className={styles.trendSection} aria-labelledby="trend-title">
            <div className={styles.sectionHeading}>
              <div>
                <Text className={styles.sectionKicker}>Desempenho comparado</Text>
                <Title level={3} id="trend-title">Ritmo comercial</Title>
                <Text type="secondary">A linha pontilhada representa o período anterior equivalente.</Text>
              </div>
              <Segmented
                aria-label="Métrica do gráfico"
                options={metricOptions}
                value={chartMetric}
                onChange={(value) => setChartMetric(value as ChartMetric)}
              />
            </div>
            {chartData.some((point) => point.current !== 0 || point.previous !== 0) ? (
              <div className={styles.chart}>
                <ResponsiveContainer width="100%" height={330} initialDimension={{ width: 960, height: 330 }}>
                  <ComposedChart data={chartData} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} accessibilityLayer>
                    <defs>
                      <linearGradient id="dashboardCurrentArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={token.colorPrimary} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={token.colorPrimary} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={token.colorBorderSecondary} strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: token.colorTextSecondary, fontSize: 11 }} interval={preset === '30d' ? 3 : 0} />
                    <YAxis axisLine={false} tickLine={false} width={70} tick={{ fill: token.colorTextSecondary, fontSize: 11 }} tickFormatter={(value) => chartMetric === 'orders' ? String(value) : value >= 1000 ? `R$${Math.round(value / 1000)}k` : `R$${value}`} />
                    <ChartTooltip
                      cursor={{ stroke: token.colorBorder, strokeDasharray: '3 3' }}
                      contentStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadiusLG }}
                      formatter={(value, name) => [chartValue(Number(value), chartMetric), name === 'current' ? 'Período atual' : 'Período anterior']}
                    />
                    <Area type="monotone" dataKey="current" stroke={token.colorPrimary} strokeWidth={3} fill="url(#dashboardCurrentArea)" dot={false} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="previous" stroke={token.colorTextTertiary} strokeWidth={2} strokeDasharray="6 6" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ainda não há vendas para comparar neste período." />
            )}
          </section>

          <section className={styles.operationSection} aria-labelledby="operation-title">
            <div className={styles.sectionHeadingInline}>
              <div>
                <Text className={styles.sectionKicker}>Pulso da operação</Text>
                <Title level={3} id="operation-title">Da venda à entrega</Title>
              </div>
              <Link href="/pedidos?view=urgent">Abrir operação <ArrowRightOutlined /></Link>
            </div>
            <div className={styles.operationTrack}>
              {operationItems.map((item) => (
                <Link key={item.label} href={item.href} className={`${styles.operationItem} ${styles[`operation_${item.tone}`]}`}>
                  <span className={styles.operationDot} />
                  <strong>{item.value.toLocaleString('pt-BR')}</strong>
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                  <ArrowRightOutlined className={styles.operationArrow} />
                </Link>
              ))}
            </div>
          </section>

          <div className={styles.lowerGrid}>
            <section className={styles.productsSection} aria-labelledby="products-title">
              <div className={styles.sectionHeadingInline}>
                <div>
                  <Text className={styles.sectionKicker}>Mix de vendas</Text>
                  <Title level={3} id="products-title">Produtos que puxaram o resultado</Title>
                </div>
                <Link href="/produtos">Ver produtos <ArrowRightOutlined /></Link>
              </div>
              {dashboard.topProducts.length ? (
                <div className={styles.productRanking}>
                  {dashboard.topProducts.map((product, index) => (
                    <div key={product.id} className={styles.productRow}>
                      <span className={styles.productRank}>
                        {index < 3 ? <TrophyFilled /> : `${index + 1}º`}
                      </span>
                      <div className={styles.productBody}>
                        <div className={styles.productLabels}>
                          <AntTooltip title={product.name}>
                            <strong>{product.name}</strong>
                          </AntTooltip>
                          <span>{product.sku ? `SKU ${product.sku} · ` : ''}{product.units} {product.units === 1 ? 'unidade' : 'unidades'}</span>
                        </div>
                        <div className={styles.productBar}>
                          <span style={{ width: `${Math.max(4, (product.revenue / maxProductRevenue) * 100)}%` }} />
                        </div>
                      </div>
                      <strong className={styles.productRevenue}>{formatCurrency(product.revenue)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem produtos vendidos no período." />
              )}
            </section>

            <section className={styles.salesSection} aria-labelledby="sales-title">
              <div className={styles.sectionHeadingInline}>
                <div>
                  <Text className={styles.sectionKicker}>Agora</Text>
                  <Title level={3} id="sales-title">Vendas recentes</Title>
                </div>
                <Link href="/pedidos?view=all">Ver todas <ArrowRightOutlined /></Link>
              </div>
              {dashboard.recentOrders.length ? (
                <div className={styles.salesFeed}>
                  {dashboard.recentOrders.map((order) => {
                    const href = order.id
                      ? `/pedidos?view=all&venda=${encodeURIComponent(order.id)}`
                      : `/pedidos?view=all&search=${encodeURIComponent(String(order.number || ''))}`;
                    return (
                      <Link href={href} key={order.id || order.number} className={styles.saleRow}>
                        <span className={styles.salePulse} />
                        <div className={styles.saleIdentity}>
                          <strong>Venda #{order.number || '—'}</strong>
                          <span>{order.customer}</span>
                        </div>
                        <div className={styles.saleValue}>
                          <strong>{formatCurrency(order.total)}</strong>
                          <span className={order.profit === null ? '' : order.profit < 0 ? styles.negative : styles.positive}>
                            {order.profit === null ? 'Lucro pendente' : `Lucro ${formatCurrency(order.profit)}`}
                          </span>
                        </div>
                        <div className={styles.saleMeta}>
                          <Tag color={statusColors[order.status] || 'default'}>{statusLabels[order.status] || order.status}</Tag>
                          <span>{order.date ? dayjs(order.date).format('DD/MM · HH:mm') : '—'}</span>
                        </div>
                        <ArrowRightOutlined />
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem vendas recentes no período." />
              )}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
