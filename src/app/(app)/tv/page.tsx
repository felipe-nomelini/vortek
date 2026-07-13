"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Flex,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  FireFilled,
  FullscreenOutlined,
  LineChartOutlined,
  ReloadOutlined,
  SoundFilled,
  MutedOutlined,
} from "@ant-design/icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

const { Text, Title } = Typography;
const DAILY_GOAL = 7500;
const TV_GOALS = {
  orders: { day: 10, week: 70, month: 300 },
  revenue: { day: DAILY_GOAL, week: DAILY_GOAL * 7, month: DAILY_GOAL * 30 },
  profit: { day: 1500, week: 10500, month: 45000 },
};
const SALE_SOUND_SRC = "/sounds/dreigue.mp3";

type TvOrderSummary = {
  id: string;
  number: number;
  customer: string;
  productName: string;
  productCount: number;
  total: number;
  profit: number;
  status: string;
  date: string;
  mlOrderId: string | null;
};

type TvMetrics = {
  generatedAt: string;
  today: {
    orders: number;
    revenue: number;
    profit: number;
    averageTicket: number;
    statusCounts: Record<string, number>;
  };
  week: {
    orders: number;
    revenue: number;
    profit: number;
    averageTicket: number;
    statusCounts: Record<string, number>;
  };
  month: {
    orders: number;
    revenue: number;
    profit: number;
    averageTicket: number;
    statusCounts: Record<string, number>;
  };
  trends: {
    revenueVsYesterday: number;
    ordersVsYesterday: number;
    profitVsYesterday: number;
  };
  hourlySales: Array<{
    hour: number;
    label: string;
    revenue: number;
    orders: number;
  }>;
  recentOrders: TvOrderSummary[];
  projection: {
    basis: {
      historicalDays: number;
      elapsedDays: number;
      remainingDays: number;
      daysInMonth: number;
      daysInNextMonth: number;
      dailyPace: {
        orders: number;
        revenue: number;
        profit: number;
      };
    };
    currentMonth: {
      orders: number;
      revenue: number;
      profit: number;
    };
    nextMonth: {
      orders: number;
      revenue: number;
      profit: number;
    };
  };
  ads: {
    total: number;
    active: number;
    paused: number;
    activeCatalog: number;
    winningCatalog: number;
  };
};

type TvLiveMetrics = Pick<
  TvMetrics,
  "generatedAt" | "today" | "week" | "month" | "trends" | "recentOrders"
>;

type Celebration = {
  id: number;
  orderNumber: number;
  customer: string;
  total: number;
};

function statusColor(status: string) {
  const map: Record<string, string> = {
    aberto: "blue",
    pendente: "gold",
    preparando: "purple",
    pronto_envio: "cyan",
    etiqueta_impressa: "geekblue",
    faturado: "green",
    atendido: "green",
    entregue: "success",
    cancelado: "red",
  };
  return map[status] || "default";
}

function formatDateTime(value: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateFull(value: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatGoal(value: number, kind: "currency" | "number") {
  if (kind === "currency") {
    if (value >= 1000)
      return `R$ ${(value / 1000).toFixed(1).replace(".", ",")}k`;
    return formatCurrency(value).replace(",00", "");
  }
  return String(Math.round(value));
}

function GoalRow({
  label,
  current,
  target,
  kind,
}: {
  label: string;
  current: number;
  target: number;
  kind: "currency" | "number";
}) {
  const safeTarget = Math.max(1, target);
  const progress = Math.min(100, Math.round((current / safeTarget) * 100));
  const missing = Math.max(0, target - current);
  return (
    <div className="goal-row">
      <div className="goal-row-line">
        <span className="goal-label">{label}</span>
        <span className="goal-current">{formatGoal(current, kind)}</span>
        <Progress
          percent={progress}
          showInfo={false}
          size="small"
          strokeColor={progress >= 100 ? "#52c41a" : "#1677ff"}
          trailColor="#262626"
        />
        <span className="goal-target">{formatGoal(target, kind)}</span>
      </div>
      <Text type="secondary" className="goal-missing">
        Falta {formatGoal(missing, kind)}
      </Text>
    </div>
  );
}

function GoalTargets({
  goals,
  current,
  kind,
}: {
  goals: { day: number; week: number; month: number };
  current: { day: number; week: number; month: number };
  kind: "currency" | "number";
}) {
  return (
    <div className="goal-targets">
      <GoalRow
        label="Dia"
        current={current.day}
        target={goals.day}
        kind={kind}
      />
      <GoalRow
        label="Semana"
        current={current.week}
        target={goals.week}
        kind={kind}
      />
      <GoalRow
        label="Mês"
        current={current.month}
        target={goals.month}
        kind={kind}
      />
    </div>
  );
}

function trendText(value: number) {
  if (value > 0) return `+${value}% vs ontem`;
  if (value < 0) return `${value}% vs ontem`;
  return "igual ontem";
}

function ProjectionValue({
  label,
  orders,
  revenue,
  profit,
}: {
  label: string;
  orders: number;
  revenue: number;
  profit: number;
}) {
  return (
    <div className="projection-block">
      <Text type="secondary" className="projection-label">
        {label}
      </Text>
      <div className="projection-grid">
        <div>
          <Text type="secondary">Vendas</Text>
          <Title level={3}>{orders}</Title>
        </div>
        <div>
          <Text type="secondary">Faturamento</Text>
          <Title level={3}>{formatCurrency(revenue)}</Title>
        </div>
        <div>
          <Text type="secondary">Lucro</Text>
          <Title level={3}>{formatCurrency(profit)}</Title>
        </div>
      </div>
    </div>
  );
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const lastOrderIdRef = useRef<string | null>(null);
  const playedOrderIdsRef = useRef<Set<string>>(new Set());
  const celebrationTimerRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tvShellRef = useRef<HTMLElement | null>(null);
  const fullRefreshInFlightRef = useRef(false);
  const liveRefreshInFlightRef = useRef(false);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playSaleSound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !soundEnabledRef.current) return;
    audio.currentTime = 0;
    audio.play().catch(() => undefined);
  }, []);

  const handleNewestOrder = useCallback(
    (orders: TvOrderSummary[] | undefined) => {
      const newest = orders?.[0];
      const previousNewestId = lastOrderIdRef.current;

      if (!previousNewestId) {
        lastOrderIdRef.current = newest?.id || null;
        if (newest?.id) playedOrderIdsRef.current.add(newest.id);
        return;
      }

      if (newest?.id && newest.id !== previousNewestId) {
        lastOrderIdRef.current = newest.id;
        if (playedOrderIdsRef.current.has(newest.id)) return;
        playedOrderIdsRef.current.add(newest.id);
        setCelebration({
          id: Date.now(),
          orderNumber: newest.number,
          customer: newest.customer,
          total: newest.total,
        });
        playSaleSound();
        if (celebrationTimerRef.current) {
          window.clearTimeout(celebrationTimerRef.current);
        }
        celebrationTimerRef.current = window.setTimeout(() => {
          setCelebration(null);
          celebrationTimerRef.current = null;
        }, 7000);
      }
    },
    [playSaleSound],
  );

  const loadMetrics = useCallback(async () => {
    if (fullRefreshInFlightRef.current) return;
    fullRefreshInFlightRef.current = true;
    try {
      setError(null);
      const res = await fetch("/api/tv/metrics", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.erro || json?.error || "Erro ao carregar TV ao Vivo",
        );
      }

      const next = json as TvMetrics;
      setData(next);
      handleNewestOrder(next.recentOrders);
    } catch (err: any) {
      setError(err?.message || "Erro ao carregar TV ao Vivo");
    } finally {
      fullRefreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [handleNewestOrder]);

  const loadLiveMetrics = useCallback(async () => {
    if (liveRefreshInFlightRef.current) return;
    liveRefreshInFlightRef.current = true;
    try {
      const res = await fetch("/api/tv/live", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.erro || json?.error || "Erro ao carregar TV ao Vivo",
        );
      }

      const live = json as TvLiveMetrics;
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          generatedAt: live.generatedAt,
          today: live.today,
          week: live.week,
          month: live.month,
          trends: live.trends,
          recentOrders: live.recentOrders,
        };
      });
      handleNewestOrder(live.recentOrders);
    } catch {
      // endpoint leve é best-effort; endpoint completo segue em 15s
    } finally {
      liveRefreshInFlightRef.current = false;
    }
  }, [handleNewestOrder]);

  useEffect(() => {
    loadMetrics();
    const liveInterval = window.setInterval(loadLiveMetrics, 1000);
    const fullInterval = window.setInterval(loadMetrics, 15000);
    return () => {
      window.clearInterval(liveInterval);
      window.clearInterval(fullInterval);
      if (celebrationTimerRef.current) {
        window.clearTimeout(celebrationTimerRef.current);
      }
    };
  }, [loadLiveMetrics, loadMetrics]);

  const hourly = useMemo(() => data?.hourlySales || [], [data]);
  const recentOrders = useMemo(
    () => (data?.recentOrders || []).slice(0, 5),
    [data],
  );
  const bestHour = useMemo(
    () =>
      hourly.reduce(
        (best, item) => (item.revenue > best.revenue ? item : best),
        { hour: 0, label: "--", revenue: 0, orders: 0 },
      ),
    [hourly],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    tvShellRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const columns: ColumnsType<TvOrderSummary> = [
    {
      title: "Venda",
      dataIndex: "number",
      key: "number",
      render: (value) => <Text strong>#{value}</Text>,
    },
    {
      title: "Data",
      dataIndex: "date",
      key: "date",
      width: 120,
      render: formatDateFull,
    },
    {
      title: "Cliente",
      dataIndex: "customer",
      key: "customer",
      ellipsis: true,
    },
    {
      title: "Produto",
      dataIndex: "productName",
      key: "productName",
      ellipsis: true,
      render: (value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{value}</Text>
          {record.productCount > 1 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              +{record.productCount - 1} produto(s)
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: "Valor",
      dataIndex: "total",
      key: "total",
      align: "right",
      render: (value) => (
        <Text strong style={{ color: "#52c41a" }}>
          {formatCurrency(value)}
        </Text>
      ),
    },
    {
      title: "Lucro",
      dataIndex: "profit",
      key: "profit",
      align: "right",
      render: (value) => (
        <Text strong style={{ color: "#52c41a" }}>
          {formatCurrency(value)}
        </Text>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (value) => <Tag color={statusColor(value)}>{value}</Tag>,
    },
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorBgBase: "#000000",
          colorBgContainer: "#141414",
          colorPrimary: "#1677ff",
          borderRadius: 8,
        },
      }}
    >
      <main ref={tvShellRef} className="tv-shell">
        <audio ref={audioRef} src={SALE_SOUND_SRC} preload="auto" />

        <Flex
          align="center"
          justify="space-between"
          gap={24}
          className="tv-header"
        >
          <Space size={18} align="center">
            <div className="logo-card">
              <Image
                src="/logo.png"
                alt="Vortek"
                width={220}
                height={31}
                priority
                style={{ width: 220, height: "auto" }}
              />
            </div>
            <div>
              <div className="live-badge">
                <span className="live-radar" aria-hidden="true" />
                <Text strong>AO VIVO</Text>
              </div>
              <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                vendas ao vivo a cada 1s · painel completo a cada 15s ·{" "}
                {data?.generatedAt
                  ? `última leitura ${formatDateTime(data.generatedAt)}`
                  : "carregando"}
              </Text>
            </div>
          </Space>

          <Space>
            <Button
              type={soundEnabled ? "primary" : "default"}
              icon={soundEnabled ? <SoundFilled /> : <MutedOutlined />}
              onClick={() => {
                setSoundEnabled((current) => !current);
                audioRef.current?.load();
              }}
            >
              Som {soundEnabled ? "ligado" : "desligado"}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadMetrics}>
              Atualizar
            </Button>
            <Button icon={<FullscreenOutlined />} onClick={toggleFullscreen}>
              Tela cheia
            </Button>
          </Space>
        </Flex>

        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 16 }}
          />
        )}

        {loading && !data ? (
          <Flex align="center" justify="center" style={{ minHeight: "70vh" }}>
            <Spin size="large" />
          </Flex>
        ) : (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={6}>
                <Card className="metric-card metric-card-feature pulse-card">
                  <Statistic
                    title="Vendas de hoje"
                    value={data?.today.orders || 0}
                    prefix={<span className="metric-emoji">🛒</span>}
                  />
                  <Tag color="blue">
                    {trendText(data?.trends.ordersVsYesterday || 0)}
                  </Tag>
                  <GoalTargets
                    goals={TV_GOALS.orders}
                    current={{
                      day: data?.today.orders || 0,
                      week: data?.week.orders || 0,
                      month: data?.month.orders || 0,
                    }}
                    kind="number"
                  />
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card className="metric-card metric-card-feature glow-green">
                  <Statistic
                    title="Faturamento de hoje"
                    value={data?.today.revenue || 0}
                    prefix={<span className="metric-emoji">💰</span>}
                    formatter={(value) => formatCurrency(Number(value || 0))}
                  />
                  <Tag color="green">
                    {trendText(data?.trends.revenueVsYesterday || 0)}
                  </Tag>
                  <GoalTargets
                    goals={TV_GOALS.revenue}
                    current={{
                      day: data?.today.revenue || 0,
                      week: data?.week.revenue || 0,
                      month: data?.month.revenue || 0,
                    }}
                    kind="currency"
                  />
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card className="metric-card metric-card-feature">
                  <Statistic
                    title="Lucro de hoje"
                    value={data?.today.profit || 0}
                    prefix={<span className="metric-emoji">🏆</span>}
                    formatter={(value) => formatCurrency(Number(value || 0))}
                  />
                  <Tag color="purple">
                    {trendText(data?.trends.profitVsYesterday || 0)}
                  </Tag>
                  <GoalTargets
                    goals={TV_GOALS.profit}
                    current={{
                      day: data?.today.profit || 0,
                      week: data?.week.profit || 0,
                      month: data?.month.profit || 0,
                    }}
                    kind="currency"
                  />
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card
                  title={
                    <Space>
                      <LineChartOutlined /> Vendas por hora
                    </Space>
                  }
                  extra={
                    <Tag color="gold">
                      <FireFilled /> {bestHour.label}
                    </Tag>
                  }
                  className="chart-card hour-card"
                >
                  <div className="compact-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={hourly}
                        barCategoryGap={4}
                        margin={{ top: 18, right: 4, left: -28, bottom: 0 }}
                      >
                        <CartesianGrid stroke="#262626" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="#8c8c8c"
                          tickLine={false}
                          axisLine={false}
                          interval={2}
                          fontSize={10}
                        />
                        <YAxis hide />
                        <Tooltip
                          cursor={{ fill: "rgba(22, 119, 255, 0.12)" }}
                          contentStyle={{
                            background: "#141414",
                            border: "1px solid #303030",
                            borderRadius: 8,
                            color: "#f5f5f5",
                          }}
                          labelStyle={{ color: "#f5f5f5" }}
                          itemStyle={{ color: "#f5f5f5" }}
                          formatter={(value, name) => [
                            name === "revenue"
                              ? formatCurrency(Number(value))
                              : value,
                            name === "revenue" ? "Faturamento" : "Vendas",
                          ]}
                        />
                        <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                          {hourly.map((item) => (
                            <Cell
                              key={item.hour}
                              fill={
                                item.revenue === bestHour.revenue &&
                                item.revenue > 0
                                  ? "#52c41a"
                                  : "#1677ff"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </Col>
            </Row>

            <Card
              title={
                <Space>
                  <LineChartOutlined /> Projeção de resultado
                </Space>
              }
              extra={
                <Tag color="blue">
                  ritmo{" "}
                  {formatCurrency(
                    data?.projection.basis.dailyPace.revenue || 0,
                  )}{" "}
                  / dia
                </Tag>
              }
              className="projection-card"
            >
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} lg={10}>
                  <ProjectionValue
                    label="Fechamento previsto do mês atual"
                    orders={data?.projection.currentMonth.orders || 0}
                    revenue={data?.projection.currentMonth.revenue || 0}
                    profit={data?.projection.currentMonth.profit || 0}
                  />
                </Col>
                <Col xs={24} lg={10}>
                  <ProjectionValue
                    label="Se mantiver o ritmo no próximo mês"
                    orders={data?.projection.nextMonth.orders || 0}
                    revenue={data?.projection.nextMonth.revenue || 0}
                    profit={data?.projection.nextMonth.profit || 0}
                  />
                </Col>
                <Col xs={24} lg={4}>
                  <div className="projection-basis">
                    <Text type="secondary">Base</Text>
                    <Text strong>
                      {data?.projection.basis.historicalDays || 30} dias + mês
                      atual
                    </Text>
                    <Text type="secondary">Restam</Text>
                    <Text strong>
                      {Math.ceil(data?.projection.basis.remainingDays || 0)}{" "}
                      dias
                    </Text>
                  </div>
                </Col>
              </Row>
            </Card>

            <Card title="Últimas 5 vendas" className="sales-card">
              {recentOrders.length ? (
                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={recentOrders}
                  pagination={false}
                  size="small"
                />
              ) : (
                <Empty description="Nenhuma venda registrada" />
              )}
            </Card>

            <footer className="ads-footer">
              <div>
                <Text type="secondary">Total</Text>
                <Text strong>{data?.ads.total || 0}</Text>
              </div>
              <div>
                <Text type="secondary">Ativos</Text>
                <Text strong style={{ color: "#52c41a" }}>
                  {data?.ads.active || 0}
                </Text>
              </div>
              <div>
                <Text type="secondary">Pausados</Text>
                <Text strong style={{ color: "#faad14" }}>
                  {data?.ads.paused || 0}
                </Text>
              </div>
              <div>
                <Text type="secondary">Ativos Catálogo</Text>
                <Text strong style={{ color: "#1677ff" }}>
                  {data?.ads.activeCatalog || 0}
                </Text>
              </div>
              <div>
                <Text type="secondary">Ganhando Catálogo</Text>
                <Text strong style={{ color: "#52c41a" }}>
                  {data?.ads.winningCatalog || 0}
                </Text>
              </div>
            </footer>
          </Space>
        )}

        {celebration && (
          <div className="celebration" key={celebration.id}>
            <div className="confetti c1" />
            <div className="confetti c2" />
            <div className="confetti c3" />
            <Card className="celebration-card">
              <Title level={1}>VOCÊ VENDEU!!!</Title>
              <Text>
                Pedido #{celebration.orderNumber} · {celebration.customer}
              </Text>
              <Title level={2}>{formatCurrency(celebration.total)}</Title>
            </Card>
          </div>
        )}

        <style jsx global>{`
          body {
            background: #000000;
          }
          .tv-shell {
            min-height: 100vh;
            padding: clamp(10px, 1.2vw, 18px);
            background:
              radial-gradient(
                circle at 18% 10%,
                rgba(22, 119, 255, 0.18),
                transparent 28%
              ),
              radial-gradient(
                circle at 85% 18%,
                rgba(82, 196, 26, 0.12),
                transparent 24%
              ),
              #000000;
            overflow: hidden;
          }
          .tv-shell:fullscreen {
            width: 100vw;
            height: 100vh;
            min-height: 100vh;
          }
          .tv-header {
            margin-bottom: 10px;
          }
          .logo-card {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 220px;
            min-height: 31px;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
          }
          .live-badge {
            display: inline-flex;
            align-items: center;
            gap: 10px;
          }
          .live-radar {
            position: relative;
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #52c41a;
            box-shadow: 0 0 12px rgba(82, 196, 26, 0.55);
          }
          .live-radar::before,
          .live-radar::after {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 999px;
            border: 1px solid rgba(82, 196, 26, 0.5);
            animation: liveRadar 2s ease-out infinite;
          }
          .live-radar::after {
            animation-delay: 1s;
          }
          .metric-card,
          .chart-card,
          .projection-card,
          .sales-card {
            border-color: #262626 !important;
            background: rgba(20, 20, 20, 0.94) !important;
            box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
          }
          .metric-card {
            min-height: 190px;
          }
          .metric-card-feature {
            border-color: rgba(22, 119, 255, 0.34) !important;
            box-shadow:
              0 0 34px rgba(22, 119, 255, 0.12),
              0 14px 40px rgba(0, 0, 0, 0.28);
          }
          .metric-card .ant-statistic-title {
            color: #8c8c8c;
            font-size: 13px;
          }
          .metric-card .ant-statistic-content {
            font-size: clamp(24px, 2.3vw, 38px);
            font-weight: 900;
          }
          .metric-emoji {
            margin-right: 8px;
            filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.22));
          }
          .goal-targets {
            display: grid;
            gap: 7px;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid #262626;
          }
          .goal-row {
            display: grid;
            gap: 2px;
          }
          .goal-row-line {
            display: grid;
            grid-template-columns: 48px 44px 1fr 54px;
            align-items: center;
            gap: 8px;
          }
          .goal-label,
          .goal-current,
          .goal-target {
            color: #a0a0a0;
            font-size: 11px;
            line-height: 1.2;
            white-space: nowrap;
          }
          .goal-current,
          .goal-target {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }
          .goal-missing {
            display: block;
            margin-left: 100px;
            font-size: 10px;
            line-height: 1;
          }
          .pulse-card {
            box-shadow: 0 0 0 rgba(22, 119, 255, 0.35);
            animation: pulseBlue 2.8s ease-in-out infinite;
          }
          .glow-green {
            box-shadow: 0 0 26px rgba(82, 196, 26, 0.16);
          }
          .hour-card {
            min-height: 190px;
          }
          .hour-card .ant-card-body {
            min-height: 148px;
            display: flex;
            align-items: stretch;
          }
          .compact-chart {
            flex: 1;
            height: 148px;
          }
          .projection-card {
            border-color: rgba(82, 196, 26, 0.26) !important;
          }
          .projection-block {
            padding: 10px 12px;
            border: 1px solid #262626;
            border-radius: 10px;
            background: #0f0f0f;
          }
          .projection-label {
            display: block;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-size: 11px;
          }
          .projection-grid {
            display: grid;
            grid-template-columns: 0.8fr 1.2fr 1fr;
            gap: 10px;
          }
          .projection-grid h3 {
            margin: 2px 0 0 !important;
            font-size: clamp(18px, 1.7vw, 28px) !important;
            white-space: nowrap;
          }
          .projection-basis {
            display: grid;
            grid-template-columns: 1fr;
            gap: 3px;
            padding: 10px 12px;
            border: 1px solid #262626;
            border-radius: 10px;
            background: #0f0f0f;
          }
          .ads-footer {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 10px;
            padding: 10px 14px;
            border: 1px solid #262626;
            border-radius: 10px;
            background: rgba(20, 20, 20, 0.94);
            box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
          }
          .ads-footer > div {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 10px;
            border-radius: 8px;
            background: #0f0f0f;
          }
          .ant-table,
          .ant-table-container,
          .ant-table-cell {
            background: transparent !important;
          }
          .ant-table-thead > tr > th {
            background: #1f1f1f !important;
          }
          .tv-shell .ant-card-head {
            min-height: 42px;
            padding: 0 16px;
          }
          .tv-shell .ant-card-body {
            padding: 14px 16px;
          }
          .recharts-default-tooltip {
            color: #f5f5f5 !important;
          }
          .recharts-tooltip-label {
            color: #f5f5f5 !important;
          }
          .tv-shell .ant-table-cell {
            padding-top: 7px !important;
            padding-bottom: 7px !important;
          }
          .celebration {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            background: rgba(0, 0, 0, 0.52);
            animation: fadeIn 180ms ease-out;
          }
          .celebration-card {
            width: min(760px, 88vw);
            text-align: center;
            border: 1px solid rgba(82, 196, 26, 0.7) !important;
            background: linear-gradient(135deg, #141414, #071707) !important;
            box-shadow: 0 0 80px rgba(82, 196, 26, 0.35);
            animation:
              salePop 700ms cubic-bezier(0.2, 1.4, 0.4, 1),
              floatCard 2.4s ease-in-out infinite;
          }
          .celebration-card h1 {
            color: #52c41a !important;
            font-size: clamp(46px, 7vw, 104px);
            margin-bottom: 8px !important;
            letter-spacing: -0.05em;
            text-shadow: 0 0 24px rgba(82, 196, 26, 0.45);
          }
          .celebration-card h2 {
            color: #ffffff !important;
            font-size: clamp(34px, 5vw, 72px);
            margin-top: 12px !important;
          }
          .confetti {
            position: fixed;
            top: -20vh;
            width: 18px;
            height: 18px;
            border-radius: 5px;
            animation: confettiFall 3.4s linear infinite;
          }
          .c1 {
            left: 18%;
            background: #1677ff;
            animation-delay: 0s;
          }
          .c2 {
            left: 52%;
            background: #52c41a;
            animation-delay: 0.25s;
          }
          .c3 {
            left: 78%;
            background: #faad14;
            animation-delay: 0.5s;
          }
          @keyframes floatCard {
            0%,
            100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-5px);
            }
          }
          @keyframes pulseBlue {
            0%,
            100% {
              box-shadow: 0 0 0 rgba(22, 119, 255, 0.1);
            }
            50% {
              box-shadow: 0 0 32px rgba(22, 119, 255, 0.28);
            }
          }
          @keyframes liveRadar {
            0% {
              transform: scale(1);
              opacity: 0.8;
            }
            100% {
              transform: scale(3.2);
              opacity: 0;
            }
          }
          @keyframes salePop {
            0% {
              transform: scale(0.75) rotate(-2deg);
              opacity: 0;
            }
            70% {
              transform: scale(1.04) rotate(1deg);
              opacity: 1;
            }
            100% {
              transform: scale(1) rotate(0);
              opacity: 1;
            }
          }
          @keyframes confettiFall {
            0% {
              transform: translate3d(0, 0, 0) rotate(0);
              opacity: 0;
            }
            10% {
              opacity: 1;
            }
            100% {
              transform: translate3d(10vw, 125vh, 0) rotate(720deg);
              opacity: 0;
            }
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        `}</style>
      </main>
    </ConfigProvider>
  );
}
