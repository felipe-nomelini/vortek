"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Badge,
  Button,
  Card,
  Progress,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from "antd";
import {
  AlertOutlined,
  BellFilled,
  ClockCircleOutlined,
  DollarCircleFilled,
  EyeOutlined,
  FullscreenOutlined,
  LineChartOutlined,
  ShoppingCartOutlined,
  SoundFilled,
  SoundOutlined,
  TrophyFilled,
} from "@ant-design/icons";
import { createClient } from "@/lib/supabase-client";
import { formatCurrency } from "@/lib/format";

const { Text, Title } = Typography;

type TvMetrics = {
  generatedAt: string;
  realtimeSources: { orders: string; visitors: string };
  today: {
    orders: number;
    revenue: number;
    profit: number;
    averageTicket: number;
    statusCounts: Record<string, number>;
  };
  yesterday: {
    orders: number;
    revenue: number;
    profit: number;
    averageTicket: number;
    statusCounts: Record<string, number>;
  };
  lastHour: {
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
  goal: { revenue: number; progress: number; remaining: number };
  operations: {
    activeAds: number;
    activeProducts: number;
    openClaims: number;
    actionQueueCount: number;
  };
  marketplace: {
    totalVisits: number;
    totalSold: number;
    estimatedListingRevenue: number;
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
  actionQueue: Array<{
    id: string;
    number: number;
    customer: string;
    total: number;
    status: string;
    action: string;
    needsInvoice: boolean;
    needsLabel: boolean;
    date: string;
  }>;
  topProducts: Array<{
    rank: number;
    mlItemId: string;
    title: string;
    sku: string | null;
    visits: number;
    sold: number;
    revenue: number;
    thumbnail: string | null;
    permalink: string | null;
  }>;
};

type Celebration = {
  id: number;
  title: string;
  subtitle: string;
  amount: number;
};

const BLUE = "#1677ff";
const GREEN = "#52c41a";
const TEXT = "#f5f5f5";
const MUTED = "#8c8c8c";

const statusLabel: Record<string, string> = {
  aberto: "Aberto",
  pendente: "Pendente",
  preparando: "Preparando",
  pronto_envio: "Pronto envio",
  etiqueta_impressa: "Etiqueta",
  faturado: "Faturado",
  atendido: "Atendido",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

type Tone = "blue" | "green" | "red" | "neutral";

const statusTone: Record<string, Tone> = {
  aberto: "blue",
  pendente: "neutral",
  preparando: "blue",
  pronto_envio: "blue",
  etiqueta_impressa: "blue",
  faturado: "green",
  atendido: "green",
  entregue: "green",
  cancelado: "neutral",
};

function darkTagStyle(tone: Tone = "neutral") {
  const colorByTone: Record<Tone, string> = {
    blue: BLUE,
    green: GREEN,
    red: "#ff7875",
    neutral: "#bfbfbf",
  };
  const color = colorByTone[tone];
  return {
    margin: 0,
    borderRadius: 999,
    borderColor: tone === "neutral" ? "#303030" : `${color}66`,
    background: "#101010",
    color,
    fontWeight: 800,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function compactCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: Math.abs(value) >= 100000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 100000 ? 1 : 2,
  }).format(Number(value || 0));
}

function timeLabel(value: string | null | undefined): string {
  if (!value) return "--:--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function TrendText({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={positive ? "trendUp" : "trendDown"}>
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(1)}% vs ontem
    </span>
  );
}

function MainMetric({
  title,
  value,
  subtitle,
  icon,
  tone = "blue",
  trend,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ReactNode;
  tone?: "blue" | "green";
  trend?: number;
}) {
  return (
    <Card
      className={`mainMetric ${tone}`}
      variant="outlined"
      styles={{ body: { height: "100%" } }}
    >
      <Statistic
        title={
          <div className="metricTop">
            <span>{title}</span>
            <span className="metricIcon">{icon}</span>
          </div>
        }
        value={value}
        formatter={() => <span className="metricValue">{value}</span>}
      />
      <div className="metricBottom">
        <span>{subtitle}</span>
        {trend !== undefined ? <TrendText value={trend} /> : null}
      </div>
    </Card>
  );
}

function CompactStat({
  label,
  value,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: "blue" | "green" | "neutral" | "red";
}) {
  return (
    <div className={`compactStat ${tone}`}>
      <span className="compactIcon">{icon}</span>
      <span className="compactLabel">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function playSaleSound() {
  const audio = new Audio("/sounds/cash-register-sale.mp3");
  audio.volume = 0.95;
  void audio.play().catch(() => null);
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [onlineViewers, setOnlineViewers] = useState(1);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const lastOrderIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const loadMetrics = useCallback(
    async (trigger: "initial" | "poll" | "realtime" = "poll") => {
      try {
        const res = await fetch("/api/tv/metrics", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.erro || json?.error || "Erro ao carregar TV");

        const next = json as TvMetrics;
        const newest = next.recentOrders?.[0];
        const previousNewestId = lastOrderIdRef.current;
        setData(next);

        if (newest?.id) lastOrderIdRef.current = newest.id;

        if (
          initializedRef.current &&
          trigger !== "initial" &&
          newest?.id &&
          previousNewestId &&
          newest.id !== previousNewestId
        ) {
          const event: Celebration = {
            id: Date.now(),
            title: "VOCÊ VENDEU!!!",
            subtitle: `Pedido #${newest.number} · ${newest.customer}`,
            amount: newest.total,
          };
          setCelebration(event);
          if (soundEnabled) playSaleSound();
          window.setTimeout(
            () =>
              setCelebration((current) =>
                current?.id === event.id ? null : current,
              ),
            5200,
          );
        }

        initializedRef.current = true;
      } catch (err: any) {
        messageApi.error(err?.message || "Erro ao carregar monitor");
      } finally {
        setLoading(false);
      }
    },
    [messageApi, soundEnabled],
  );

  useEffect(() => {
    void loadMetrics("initial");
    const timer = window.setInterval(() => void loadMetrics("poll"), 15000);
    return () => window.clearInterval(timer);
  }, [loadMetrics]);

  useEffect(() => {
    const supabase = createClient();
    const clientId = `tv-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel("vortek-tv-monitor", { config: { presence: { key: clientId } } })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const count = Object.values(state).reduce(
          (sum, entries) => sum + entries.length,
          0,
        );
        setOnlineViewers(Math.max(1, count));
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos" },
        () => {
          void loadMetrics("realtime");
        },
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            online_at: new Date().toISOString(),
            page: "tv",
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMetrics]);

  const bestHour = useMemo(() => {
    if (!data?.hourlySales?.length) return null;
    return data.hourlySales.reduce(
      (best, item) => (item.revenue > best.revenue ? item : best),
      data.hourlySales[0],
    );
  }, [data]);

  const salesHours = useMemo(
    () =>
      (data?.hourlySales || [])
        .filter((item) => item.revenue > 0 || item.orders > 0)
        .slice(-8),
    [data],
  );
  const maxHourRevenue = useMemo(
    () => Math.max(1, ...salesHours.map((item) => item.revenue)),
    [salesHours],
  );
  const topProduct = data?.topProducts?.[0];

  if (loading && !data) {
    return (
      <div className="tvShell centerShell">
        {contextHolder}
        <Spin size="large" />
        <Text style={{ color: MUTED, marginTop: 16 }}>
          Carregando TV ao Vivo...
        </Text>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="tvShell centerShell">
        {contextHolder}
        <Text style={{ color: "#ff4d4f" }}>Sem dados para exibir.</Text>
      </div>
    );
  }

  return (
    <div className="tvShell">
      {contextHolder}
      <style jsx global>{`
        body {
          background: #000 !important;
          overflow: hidden;
        }
        @keyframes softGlow {
          0%,
          100% {
            box-shadow: 0 0 0 rgba(22, 119, 255, 0);
          }
          50% {
            box-shadow: 0 0 28px rgba(22, 119, 255, 0.22);
          }
        }
        @keyframes ambientLine {
          0% {
            transform: translateX(-40%);
            opacity: 0.1;
          }
          50% {
            opacity: 0.45;
          }
          100% {
            transform: translateX(140%);
            opacity: 0.1;
          }
        }
        @keyframes livePulse {
          0%,
          100% {
            opacity: 0.6;
            transform: scale(0.94);
          }
          50% {
            opacity: 1;
            transform: scale(1.08);
          }
        }
        @keyframes logoFloat {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-3px);
          }
        }
        @keyframes popIn {
          0% {
            transform: translate(-50%, -45%) scale(0.82);
            opacity: 0;
          }
          16% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          84% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -54%) scale(0.92);
            opacity: 0;
          }
        }
        .tvShell {
          position: fixed;
          inset: 0;
          z-index: 9999;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
          padding: clamp(12px, 1.2vw, 18px);
          color: ${TEXT};
          background:
            radial-gradient(
              circle at 80% 0%,
              rgba(22, 119, 255, 0.1),
              transparent 32%
            ),
            radial-gradient(
              circle at 12% 100%,
              rgba(82, 196, 26, 0.07),
              transparent 26%
            ),
            #000;
        }
        .tvShell:before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 42%;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(22, 119, 255, 0.9),
            transparent
          );
          animation: ambientLine 7s linear infinite;
          pointer-events: none;
        }
        .centerShell {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }
        .tvGrid {
          height: 100%;
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: clamp(10px, 1vw, 14px);
        }
        .tvHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          min-height: 58px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }
        .brandLogo {
          height: clamp(42px, 5vw, 68px);
          width: auto;
          display: block;
          object-fit: contain;
          filter: drop-shadow(0 0 18px rgba(22, 119, 255, 0.2));
          animation: logoFloat 5s ease-in-out infinite;
        }
        .subline {
          display: flex;
          gap: 12px;
          align-items: center;
          color: ${MUTED};
          font-size: 12px;
          margin-top: 5px;
        }
        .live {
          color: ${GREEN};
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .live:before {
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${GREEN};
          box-shadow: 0 0 10px ${GREEN};
          animation: livePulse 1.8s ease-in-out infinite;
        }
        .topMetrics {
          display: grid;
          grid-template-columns: 1fr 1.25fr 1fr;
          gap: clamp(10px, 1vw, 14px);
        }
        .mainMetric {
          min-height: clamp(132px, 19vh, 170px);
          background: #141414 !important;
          border: 1px solid #242424 !important;
          border-radius: 22px;
          overflow: hidden;
          animation: softGlow 8s ease-in-out infinite;
        }
        .mainMetric .ant-card-body {
          padding: clamp(16px, 1.45vw, 22px) !important;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .mainMetric.blue {
          border-color: rgba(22, 119, 255, 0.34);
        }
        .mainMetric.green {
          border-color: rgba(82, 196, 26, 0.28);
        }
        .metricTop,
        .metricBottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: ${MUTED};
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.4px;
        }
        .metricIcon {
          color: ${BLUE};
          font-size: 25px;
        }
        .mainMetric.green .metricIcon {
          color: ${GREEN};
        }
        .metricValue {
          font-size: clamp(46px, 5.8vw, 86px);
          line-height: 0.95;
          font-weight: 1000;
          letter-spacing: -3px;
          color: #fff;
          text-shadow: 0 0 18px rgba(255, 255, 255, 0.08);
        }
        .mainMetric .ant-statistic-title,
        .mainMetric .ant-statistic-content {
          margin: 0;
        }
        .trendUp {
          color: ${GREEN};
          font-size: 12px;
          font-weight: 900;
          text-transform: none;
          letter-spacing: 0;
        }
        .trendDown {
          color: #ff7875;
          font-size: 12px;
          font-weight: 900;
          text-transform: none;
          letter-spacing: 0;
        }
        .middle {
          display: grid;
          grid-template-columns: 0.9fr 1fr 1fr 1.15fr;
          gap: clamp(10px, 1vw, 14px);
          min-height: 0;
        }
        .panel {
          min-height: 0;
          background: #141414;
          border: 1px solid #242424;
          border-radius: 22px;
          padding: clamp(14px, 1.25vw, 18px);
          overflow: hidden;
        }
        .panelTitle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: #fff;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 13px;
          margin-bottom: 12px;
        }
        .goalBox {
          display: grid;
          place-items: center;
          height: calc(100% - 28px);
          text-align: center;
        }
        .goalValue {
          font-size: clamp(24px, 2.7vw, 38px);
          font-weight: 1000;
          color: #fff;
          margin-top: -6px;
        }
        .compactList {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .compactStat {
          height: clamp(58px, 8.2vh, 74px);
          display: grid;
          grid-template-columns: 36px 1fr auto;
          align-items: center;
          gap: 10px;
          border-radius: 16px;
          background: #1a1a1a;
          border: 1px solid #292929;
          padding: 10px 12px;
        }
        .compactStat.blue {
          border-color: rgba(22, 119, 255, 0.22);
        }
        .compactStat.green {
          border-color: rgba(82, 196, 26, 0.22);
        }
        .compactStat.red {
          border-color: rgba(255, 77, 79, 0.22);
        }
        .compactIcon {
          color: ${BLUE};
          font-size: 19px;
        }
        .compactStat.green .compactIcon {
          color: ${GREEN};
        }
        .compactStat.red .compactIcon {
          color: #ff7875;
        }
        .compactLabel {
          color: ${MUTED};
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .compactStat strong {
          color: #fff;
          font-size: clamp(22px, 2vw, 30px);
          line-height: 1;
        }
        .statusTags {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-content: flex-start;
        }
        .bestHour {
          margin-top: 14px;
          color: ${MUTED};
        }
        .bestHour strong {
          display: block;
          color: #fff;
          font-size: clamp(24px, 2.5vw, 36px);
          line-height: 1.1;
        }
        .bottom {
          display: grid;
          grid-template-columns: 1fr 1.25fr 1.25fr;
          gap: clamp(10px, 1vw, 14px);
          min-height: 0;
        }
        .barRow {
          display: grid;
          grid-template-columns: 42px 1fr 48px;
          gap: 10px;
          align-items: center;
          margin: 8px 0;
        }
        .barTrack {
          height: 10px;
          border-radius: 999px;
          background: #242424;
          overflow: hidden;
        }
        .barFill {
          height: 100%;
          border-radius: inherit;
          background: ${BLUE};
        }
        .orderRow,
        .actionRow {
          display: grid;
          align-items: center;
          gap: 10px;
          border-radius: 14px;
          padding: 9px 10px;
          background: #1a1a1a;
          border: 1px solid #262626;
          margin-bottom: 8px;
          min-height: 50px;
        }
        .orderRow {
          grid-template-columns: 78px 1fr 105px 92px;
        }
        .actionRow {
          grid-template-columns: 82px 1fr 122px;
        }
        .cellTitle {
          color: #fff;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cellSub {
          color: ${MUTED};
          font-size: 12px;
        }
        .footerStrip {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 14px;
          align-items: center;
          min-height: 40px;
          background: #101010;
          border: 1px solid #222;
          border-radius: 16px;
          padding: 8px 12px;
          color: ${MUTED};
          font-size: 12px;
        }
        .champion {
          color: #fff;
          font-weight: 900;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .celebration {
          position: fixed;
          top: 50%;
          left: 50%;
          z-index: 10001;
          width: min(860px, 90vw);
          border-radius: 30px;
          padding: clamp(34px, 4vw, 58px);
          background: #141414;
          border: 1px solid rgba(82, 196, 26, 0.7);
          color: #fff;
          text-align: center;
          box-shadow: 0 0 120px rgba(82, 196, 26, 0.38);
          animation:
            popIn 5.2s ease-in-out forwards,
            softGlow 1.4s ease-in-out infinite;
        }
        .celebrationBackdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background: radial-gradient(
            circle,
            rgba(82, 196, 26, 0.18),
            rgba(0, 0, 0, 0.72)
          );
          pointer-events: none;
        }
        @media (max-width: 1100px) {
          .topMetrics {
            grid-template-columns: 1fr;
          }
          .middle,
          .bottom {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>

      {celebration ? (
        <>
          <div className="celebrationBackdrop" />
          <Card className="celebration" variant="outlined">
            <ShoppingCartOutlined style={{ fontSize: 78, color: GREEN }} />
            <div
              style={{
                fontSize: "clamp(54px, 7vw, 112px)",
                fontWeight: 1000,
                lineHeight: 0.92,
                marginTop: 16,
                letterSpacing: -2,
              }}
            >
              {celebration.title}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                marginTop: 18,
                color: "#d9d9d9",
              }}
            >
              {celebration.subtitle}
            </div>
            <Statistic
              value={formatCurrency(celebration.amount)}
              formatter={() => (
                <span style={{ color: GREEN, fontSize: 58, fontWeight: 1000 }}>
                  {formatCurrency(celebration.amount)}
                </span>
              )}
            />
            <Tag style={darkTagStyle("green")}>CAIXA REGISTRADORA ATIVA</Tag>
          </Card>
        </>
      ) : null}

      <div className="tvGrid">
        <header className="tvHeader">
          <div className="brand">
            <img className="brandLogo" src="/logo.png" alt="Vortek" />
            <div style={{ minWidth: 0 }}>
              <div className="subline">
                <Badge
                  status="processing"
                  color={GREEN}
                  text={<span className="live">AO VIVO</span>}
                />
                <span>Atualizado {timeLabel(data.generatedAt)}</span>
                <span>Realtime pedidos · polling 15s</span>
              </div>
            </div>
          </div>
          <Space>
            <Button
              size="small"
              icon={soundEnabled ? <SoundFilled /> : <SoundOutlined />}
              onClick={() => setSoundEnabled((value) => !value)}
              type={soundEnabled ? "primary" : "default"}
            >
              Som {soundEnabled ? "ON" : "OFF"}
            </Button>
            <Button size="small" icon={<SoundFilled />} onClick={playSaleSound}>
              Testar som
            </Button>
            <Button
              size="small"
              icon={<FullscreenOutlined />}
              onClick={() => document.documentElement.requestFullscreen?.()}
            >
              Tela cheia
            </Button>
          </Space>
        </header>

        <main
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto 1fr 1fr",
            gap: "clamp(10px, 1vw, 14px)",
          }}
        >
          <section className="topMetrics">
            <MainMetric
              title="Vendas hoje"
              value={String(data.today.orders)}
              subtitle={`${data.lastHour.orders} na última hora`}
              icon={<ShoppingCartOutlined />}
              trend={data.trends.ordersVsYesterday}
            />
            <MainMetric
              title="Faturamento hoje"
              value={compactCurrency(data.today.revenue)}
              subtitle={`Ticket médio ${formatCurrency(data.today.averageTicket)}`}
              icon={<DollarCircleFilled />}
              tone="green"
              trend={data.trends.revenueVsYesterday}
            />
            <MainMetric
              title="Lucro estimado"
              value={compactCurrency(data.today.profit)}
              subtitle={`${data.today.revenue > 0 ? ((data.today.profit / data.today.revenue) * 100).toFixed(1) : "0.0"}% de margem`}
              icon={<LineChartOutlined />}
              trend={data.trends.profitVsYesterday}
            />
          </section>

          <section className="middle">
            <div className="panel">
              <div className="panelTitle">
                <span>Meta do dia</span>
                <TrophyFilled style={{ color: GREEN }} />
              </div>
              <div className="goalBox">
                <Progress
                  type="dashboard"
                  percent={Math.min(100, data.goal.progress)}
                  size={118}
                  strokeColor={data.goal.progress >= 100 ? GREEN : BLUE}
                  trailColor="#262626"
                  format={() => (
                    <span style={{ color: "#fff", fontWeight: 1000 }}>
                      {data.goal.progress.toFixed(0)}%
                    </span>
                  )}
                />
                <div className="goalValue">
                  {formatCurrency(data.today.revenue)}
                </div>
                <Text style={{ color: MUTED }}>
                  Meta {formatCurrency(data.goal.revenue)}
                </Text>
              </div>
            </div>

            <div className="panel">
              <div className="panelTitle">
                <span>Operação</span>
                <ClockCircleOutlined style={{ color: BLUE }} />
              </div>
              <div className="compactList">
                <CompactStat
                  label="Anúncios ativos"
                  value={formatNumber(data.operations.activeAds)}
                  icon={<LineChartOutlined />}
                />
                <CompactStat
                  label="Produtos ativos"
                  value={formatNumber(data.operations.activeProducts)}
                  icon={<ShoppingCartOutlined />}
                  tone="green"
                />
                <CompactStat
                  label="Reclamações"
                  value={formatNumber(data.operations.openClaims)}
                  icon={<AlertOutlined />}
                  tone={data.operations.openClaims > 0 ? "red" : "neutral"}
                />
              </div>
            </div>

            <div className="panel">
              <div className="panelTitle">
                <span>Marketplace</span>
                <EyeOutlined style={{ color: BLUE }} />
              </div>
              <div className="compactList">
                <CompactStat
                  label="Visitas sync"
                  value={formatNumber(data.marketplace.totalVisits)}
                  icon={<EyeOutlined />}
                />
                <CompactStat
                  label="Unid. vendidas"
                  value={formatNumber(data.marketplace.totalSold)}
                  icon={<ShoppingCartOutlined />}
                  tone="green"
                />
                <CompactStat
                  label="Painéis online"
                  value={onlineViewers}
                  icon={<BellFilled />}
                  tone="neutral"
                />
              </div>
            </div>

            <div className="panel">
              <div className="panelTitle">
                <span>Status hoje</span>
                <ClockCircleOutlined style={{ color: GREEN }} />
              </div>
              <div className="statusTags">
                {Object.entries(data.today.statusCounts).length === 0 ? (
                  <Text style={{ color: MUTED }}>Sem pedidos hoje</Text>
                ) : null}
                {Object.entries(data.today.statusCounts).map(
                  ([status, count]) => (
                    <Tag key={status} style={darkTagStyle(statusTone[status])}>
                      {statusLabel[status] || status}: {count}
                    </Tag>
                  ),
                )}
              </div>
              <div className="bestHour">
                Melhor hora
                <strong>
                  {bestHour?.label || "--"} ·{" "}
                  {formatCurrency(bestHour?.revenue || 0)}
                </strong>
              </div>
            </div>
          </section>

          <section className="bottom">
            <div className="panel">
              <div className="panelTitle">
                <span>Vendas por hora</span>
                <LineChartOutlined style={{ color: BLUE }} />
              </div>
              {salesHours.length === 0 ? (
                <Text style={{ color: MUTED }}>
                  Aguardando primeiras vendas.
                </Text>
              ) : null}
              {salesHours.map((item) => (
                <div className="barRow" key={item.hour}>
                  <Text style={{ color: "#bfbfbf", fontWeight: 800 }}>
                    {item.label}
                  </Text>
                  <div className="barTrack">
                    <div
                      className="barFill"
                      style={{
                        width: `${Math.max(5, (item.revenue / maxHourRevenue) * 100)}%`,
                      }}
                    />
                  </div>
                  <Text
                    style={{
                      color: "#fff",
                      fontWeight: 900,
                      textAlign: "right",
                    }}
                  >
                    {item.orders}
                  </Text>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panelTitle">
                <span>Últimas vendas</span>
                <ShoppingCartOutlined style={{ color: GREEN }} />
              </div>
              {data.recentOrders.slice(0, 5).map((order) => (
                <div className="orderRow" key={order.id}>
                  <Text
                    style={{
                      color: BLUE,
                      fontWeight: 1000,
                      fontFamily: "monospace",
                    }}
                  >
                    #{order.number}
                  </Text>
                  <div style={{ minWidth: 0 }}>
                    <div className="cellTitle">{order.customer}</div>
                    <div className="cellSub">{timeLabel(order.date)}</div>
                  </div>
                  <Text style={{ color: GREEN, fontWeight: 1000 }}>
                    {formatCurrency(order.total)}
                  </Text>
                  <Tag style={darkTagStyle(statusTone[order.status])}>
                    {statusLabel[order.status] || order.status}
                  </Tag>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panelTitle">
                <span>Fila de atenção</span>
                <AlertOutlined
                  style={{ color: data.actionQueue.length ? "#ff7875" : GREEN }}
                />
              </div>
              {data.actionQueue.length === 0 ? (
                <Text style={{ color: GREEN, fontWeight: 900 }}>
                  Fila limpa.
                </Text>
              ) : null}
              {data.actionQueue.slice(0, 5).map((order) => (
                <div className="actionRow" key={order.id}>
                  <Text
                    style={{
                      color: BLUE,
                      fontWeight: 1000,
                      fontFamily: "monospace",
                    }}
                  >
                    #{order.number}
                  </Text>
                  <div style={{ minWidth: 0 }}>
                    <div className="cellTitle">{order.customer}</div>
                    <Space size={6} wrap>
                      {order.needsInvoice ? (
                        <Tag style={darkTagStyle("blue")}>NF</Tag>
                      ) : null}
                      {order.needsLabel ? (
                        <Tag style={darkTagStyle("blue")}>Etiqueta</Tag>
                      ) : null}
                    </Space>
                  </div>
                  <Tag
                    style={{
                      ...darkTagStyle(statusTone[order.status]),
                      textAlign: "center",
                    }}
                  >
                    {order.action}
                  </Tag>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="footerStrip">
          <div className="champion">
            Campeão:{" "}
            {topProduct
              ? `${topProduct.title} · ${topProduct.sold} vendas · ${formatNumber(topProduct.visits)} visitas`
              : "Aguardando dados dos anúncios"}
          </div>
          <div>{data.realtimeSources.visitors}</div>
        </footer>
      </div>
    </div>
  );
}
