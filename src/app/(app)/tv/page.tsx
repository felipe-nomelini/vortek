"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Flex,
  List,
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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

const { Text, Title } = Typography;
const DAILY_GOAL = 7500;
const SALE_SOUND_SRC = "/sounds/dreigue.mp3";

type TvMetrics = {
  generatedAt: string;
  today: {
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
  recentOrders: Array<{
    id: string;
    number: number;
    customer: string;
    total: number;
    profit: number;
    status: string;
    date: string;
    mlOrderId: string | null;
  }>;
};

type Celebration = {
  id: number;
  orderNumber: number;
  customer: string;
  total: number;
};

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

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

function trendText(value: number) {
  if (value > 0) return `+${value}% vs ontem`;
  if (value < 0) return `${value}% vs ontem`;
  return "igual ontem";
}

function formatBarLabel(value: unknown) {
  const amount = Number(value || 0);
  if (!amount) return "";
  if (amount >= 1000)
    return `R$ ${(amount / 1000).toFixed(1).replace(".", ",")}k`;
  return formatCurrency(amount).replace(",00", "");
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const lastOrderIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tvShellRef = useRef<HTMLElement | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/tv/metrics", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json?.erro || json?.error || "Erro ao carregar TV ao Vivo",
        );

      const next = json as TvMetrics;
      const newest = next.recentOrders?.[0];
      const previousNewestId = lastOrderIdRef.current;
      setData(next);

      if (!previousNewestId) {
        lastOrderIdRef.current = newest?.id || null;
        return;
      }

      if (newest?.id && newest.id !== previousNewestId) {
        lastOrderIdRef.current = newest.id;
        setCelebration({
          id: Date.now(),
          orderNumber: newest.number,
          customer: newest.customer,
          total: newest.total,
        });
        if (soundEnabled) {
          audioRef.current?.play().catch(() => undefined);
        }
        window.setTimeout(() => setCelebration(null), 7000);
      }
    } catch (err: any) {
      setError(err?.message || "Erro ao carregar TV ao Vivo");
    } finally {
      setLoading(false);
    }
  }, [soundEnabled]);

  useEffect(() => {
    loadMetrics();
    const interval = window.setInterval(loadMetrics, 15000);
    return () => window.clearInterval(interval);
  }, [loadMetrics]);

  const goalProgress = pct(data?.today.revenue || 0, DAILY_GOAL);
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

  const columns: ColumnsType<TvMetrics["recentOrders"][number]> = [
    {
      title: "Venda",
      dataIndex: "number",
      key: "number",
      render: (value) => <Text strong>#{value}</Text>,
    },
    {
      title: "Cliente",
      dataIndex: "customer",
      key: "customer",
      ellipsis: true,
    },
    {
      title: "Hora",
      dataIndex: "date",
      key: "date",
      width: 90,
      render: formatDateTime,
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
              <Badge
                status="processing"
                color="#52c41a"
                text={<Text strong>AO VIVO</Text>}
              />
              <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                Atualiza a cada 15s ·{" "}
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
                <Card className="metric-card pulse-card">
                  <Statistic
                    title="Vendas de hoje"
                    value={data?.today.orders || 0}
                    prefix={<span className="metric-emoji">🛒</span>}
                    suffix="vendas"
                  />
                  <Tag color="blue">
                    {trendText(data?.trends.ordersVsYesterday || 0)}
                  </Tag>
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card className="metric-card glow-green">
                  <Statistic
                    title="Faturamento de hoje"
                    value={data?.today.revenue || 0}
                    prefix={<span className="metric-emoji">💰</span>}
                    formatter={(value) => formatCurrency(Number(value || 0))}
                  />
                  <Tag color="green">
                    {trendText(data?.trends.revenueVsYesterday || 0)}
                  </Tag>
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card className="metric-card">
                  <Statistic
                    title="Lucro de hoje"
                    value={data?.today.profit || 0}
                    prefix={<span className="metric-emoji">🏆</span>}
                    formatter={(value) => formatCurrency(Number(value || 0))}
                  />
                  <Tag color="purple">
                    {trendText(data?.trends.profitVsYesterday || 0)}
                  </Tag>
                </Card>
              </Col>
              <Col xs={24} lg={6}>
                <Card className="metric-card goal-card">
                  <Flex align="center" justify="space-between">
                    <div>
                      <Text type="secondary">Meta do dia</Text>
                      <Title level={3} style={{ margin: "4px 0" }}>
                        {formatCurrency(DAILY_GOAL)}
                      </Title>
                    </div>
                    <Progress
                      type="circle"
                      percent={goalProgress}
                      size={76}
                      strokeColor={goalProgress >= 100 ? "#52c41a" : "#1677ff"}
                    />
                  </Flex>
                  <Progress
                    percent={goalProgress}
                    showInfo={false}
                    strokeColor={{ from: "#1677ff", to: "#52c41a" }}
                    trailColor="#262626"
                  />
                  <Text type="secondary">
                    Faltam{" "}
                    {formatCurrency(
                      Math.max(0, DAILY_GOAL - (data?.today.revenue || 0)),
                    )}
                  </Text>
                </Card>
              </Col>
            </Row>

            <Row gutter={[12, 12]}>
              <Col xs={24} xl={16}>
                <Card
                  title={
                    <Space>
                      <LineChartOutlined /> Vendas por hora
                    </Space>
                  }
                  extra={
                    <Tag color="gold">
                      <FireFilled /> melhor: {bestHour.label}
                    </Tag>
                  }
                  className="chart-card"
                >
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourly} barCategoryGap={8}>
                        <CartesianGrid stroke="#262626" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="#8c8c8c"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#8c8c8c"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `R$${Number(v) / 1000}k`}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(22, 119, 255, 0.12)" }}
                          contentStyle={{
                            background: "#141414",
                            border: "1px solid #303030",
                            borderRadius: 8,
                          }}
                          formatter={(value, name) => [
                            name === "revenue"
                              ? formatCurrency(Number(value))
                              : value,
                            name === "revenue" ? "Faturamento" : "Vendas",
                          ]}
                        />
                        <Bar dataKey="revenue" radius={[8, 8, 0, 0]}>
                          <LabelList
                            dataKey="revenue"
                            position="top"
                            formatter={formatBarLabel}
                            fill="#d9d9d9"
                            fontSize={11}
                          />
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

              <Col xs={24} xl={8}>
                <Card title="Ritmo do dia" className="chart-card">
                  <div className="mini-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={hourly}>
                        <defs>
                          <linearGradient
                            id="revenueGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#1677ff"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="#1677ff"
                              stopOpacity={0.05}
                            />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" hide />
                        <YAxis hide />
                        <Tooltip
                          contentStyle={{
                            background: "#141414",
                            border: "1px solid #303030",
                            borderRadius: 8,
                          }}
                          formatter={(value) => formatCurrency(Number(value))}
                        />
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          stroke="#1677ff"
                          strokeWidth={3}
                          fill="url(#revenueGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <List
                    size="small"
                    dataSource={[
                      {
                        label: "Ticket médio",
                        value: formatCurrency(data?.today.averageTicket || 0),
                      },
                      {
                        label: "Melhor hora",
                        value: bestHour.orders
                          ? `${bestHour.label} · ${formatCurrency(bestHour.revenue)}`
                          : "sem vendas",
                      },
                      { label: "Progresso", value: `${goalProgress}% da meta` },
                    ]}
                    renderItem={(item) => (
                      <List.Item>
                        <Text type="secondary">{item.label}</Text>
                        <Text strong>{item.value}</Text>
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
            </Row>

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
                <Empty description="Nenhuma venda hoje ainda" />
              )}
            </Card>
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
            min-height: 54px;
            padding: 8px 16px;
            border: 1px solid #1f1f1f;
            border-radius: 14px;
            background: rgba(20, 20, 20, 0.92);
            box-shadow: 0 0 28px rgba(22, 119, 255, 0.18);
          }
          .metric-card,
          .chart-card,
          .sales-card {
            border-color: #262626 !important;
            background: rgba(20, 20, 20, 0.94) !important;
            box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
          }
          .metric-card {
            min-height: 132px;
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
          .pulse-card {
            box-shadow: 0 0 0 rgba(22, 119, 255, 0.35);
            animation: pulseBlue 2.8s ease-in-out infinite;
          }
          .glow-green {
            box-shadow: 0 0 26px rgba(82, 196, 26, 0.16);
          }
          .chart-wrap {
            height: clamp(230px, 32vh, 330px);
          }
          .mini-chart {
            height: 125px;
            margin-bottom: 8px;
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
