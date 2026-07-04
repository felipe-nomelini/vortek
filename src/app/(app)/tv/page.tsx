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
  Button,
  Col,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  AlertOutlined,
  BellFilled,
  BulbOutlined,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  DollarCircleFilled,
  EyeOutlined,
  FireFilled,
  FullscreenOutlined,
  LineChartOutlined,
  RocketFilled,
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

const statusColor: Record<string, string> = {
  aberto: "#1677ff",
  pendente: "#faad14",
  preparando: "#13c2c2",
  pronto_envio: "#2f54eb",
  etiqueta_impressa: "#722ed1",
  faturado: "#eb2f96",
  atendido: "#52c41a",
  entregue: "#52c41a",
  cancelado: "#888888",
};

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

function TrendPill({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={`trendPill ${positive ? "trendUp" : "trendDown"}`}>
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(1)}% vs ontem
    </span>
  );
}

function BigMetric({
  title,
  value,
  subtitle,
  icon,
  glow,
  trend,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ReactNode;
  glow: string;
  trend?: number;
}) {
  return (
    <div className="bigMetric" style={{ ["--glow" as string]: glow }}>
      <div className="metricIcon">{icon}</div>
      <div>
        <div className="metricTitle">{title}</div>
        <div className="metricValue">{value}</div>
        <div className="metricSubtitle">{subtitle}</div>
      </div>
      {trend !== undefined ? <TrendPill value={trend} /> : null}
    </div>
  );
}

function MiniCard({
  title,
  value,
  accent,
  icon,
}: {
  title: string;
  value: string | number;
  accent: string;
  icon: ReactNode;
}) {
  return (
    <div className="miniCard" style={{ ["--accent" as string]: accent }}>
      <div className="miniIcon">{icon}</div>
      <div>
        <div className="miniTitle">{title}</div>
        <div className="miniValue">{value}</div>
      </div>
    </div>
  );
}

function playSaleSound() {
  const AudioContextImpl =
    window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextImpl) return;
  const ctx = new AudioContextImpl();
  const notes = [659.25, 783.99, 987.77];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.11);
    gain.gain.exponentialRampToValueAtTime(
      0.16,
      ctx.currentTime + index * 0.11 + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + index * 0.11 + 0.18,
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + index * 0.11);
    osc.stop(ctx.currentTime + index * 0.11 + 0.2);
  });
  setTimeout(() => void ctx.close().catch(() => null), 900);
}

export default function TvDashboardPage() {
  const [data, setData] = useState<TvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [onlineViewers, setOnlineViewers] = useState(1);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
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
        setPulseKey((value) => value + 1);

        if (newest?.id) {
          lastOrderIdRef.current = newest.id;
        }

        if (
          initializedRef.current &&
          trigger !== "initial" &&
          newest?.id &&
          previousNewestId &&
          newest.id !== previousNewestId
        ) {
          const event: Celebration = {
            id: Date.now(),
            title: "VENDA NOVA!",
            subtitle: `Pedido #${newest.number} • ${newest.customer}`,
            amount: newest.total,
          };
          setCelebration(event);
          if (soundEnabled) playSaleSound();
          window.setTimeout(
            () =>
              setCelebration((current) =>
                current?.id === event.id ? null : current,
              ),
            7000,
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

  const maxHourRevenue = useMemo(
    () => Math.max(1, ...(data?.hourlySales || []).map((item) => item.revenue)),
    [data],
  );

  if (loading && !data) {
    return (
      <div className="tvShell centerShell">
        {contextHolder}
        <Spin size="large" />
        <Text style={{ color: "#8c8c8c", marginTop: 16 }}>
          Carregando monitor Vortek...
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
        }
        @keyframes auroraShift {
          0% {
            transform: translate3d(-8%, -6%, 0) scale(1);
            opacity: 0.42;
          }
          50% {
            transform: translate3d(6%, 8%, 0) scale(1.12);
            opacity: 0.68;
          }
          100% {
            transform: translate3d(-8%, -6%, 0) scale(1);
            opacity: 0.42;
          }
        }
        @keyframes scanLine {
          0% {
            transform: translateY(-100%);
          }
          100% {
            transform: translateY(100vh);
          }
        }
        @keyframes pulseGlow {
          0%,
          100% {
            box-shadow: 0 0 28px rgba(22, 119, 255, 0.18);
          }
          50% {
            box-shadow: 0 0 48px rgba(22, 119, 255, 0.48);
          }
        }
        @keyframes popIn {
          0% {
            transform: translate(-50%, -42%) scale(0.72) rotate(-3deg);
            opacity: 0;
          }
          12% {
            transform: translate(-50%, -50%) scale(1.06) rotate(1deg);
            opacity: 1;
          }
          85% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -55%) scale(0.9);
            opacity: 0;
          }
        }
        @keyframes sparkle {
          0%,
          100% {
            opacity: 0.25;
            transform: scale(0.96);
          }
          50% {
            opacity: 1;
            transform: scale(1.05);
          }
        }
        @keyframes ticker {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .tvShell {
          min-height: calc(100vh - 48px);
          position: relative;
          overflow: hidden;
          color: #f5f5f5;
          padding: 6px;
          background:
            radial-gradient(
              circle at 10% 5%,
              rgba(22, 119, 255, 0.22),
              transparent 35%
            ),
            radial-gradient(
              circle at 90% 10%,
              rgba(82, 196, 26, 0.13),
              transparent 32%
            ),
            linear-gradient(135deg, #02040a 0%, #050505 45%, #000 100%);
        }
        .tvShell:before {
          content: "";
          position: absolute;
          inset: -20%;
          background: conic-gradient(
            from 120deg,
            rgba(22, 119, 255, 0.22),
            rgba(114, 46, 209, 0.14),
            rgba(82, 196, 26, 0.12),
            rgba(22, 119, 255, 0.22)
          );
          filter: blur(70px);
          animation: auroraShift 16s ease-in-out infinite;
          pointer-events: none;
        }
        .tvShell:after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            transparent,
            rgba(255, 255, 255, 0.08),
            transparent
          );
          height: 26vh;
          animation: scanLine 8s linear infinite;
          opacity: 0.18;
          pointer-events: none;
        }
        .centerShell {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }
        .tvContent {
          position: relative;
          z-index: 1;
        }
        .tvHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }
        .brandLine {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .brandBadge {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #1677ff, #52c41a);
          color: #fff;
          box-shadow: 0 0 35px rgba(22, 119, 255, 0.45);
          font-size: 26px;
        }
        .bigTitle {
          margin: 0 !important;
          color: #fff !important;
          font-size: clamp(28px, 3vw, 48px) !important;
          line-height: 1 !important;
          letter-spacing: 0.5px;
        }
        .livePill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(82, 196, 26, 0.45);
          background: rgba(82, 196, 26, 0.12);
          color: #b7eb8f;
          border-radius: 999px;
          padding: 6px 12px;
          font-weight: 800;
        }
        .liveDot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #52c41a;
          box-shadow: 0 0 18px #52c41a;
          animation: sparkle 1.2s ease-in-out infinite;
        }
        .bigMetric {
          min-height: 190px;
          border: 1px solid color-mix(in srgb, var(--glow) 46%, transparent);
          border-radius: 28px;
          padding: 24px;
          background: linear-gradient(
            145deg,
            rgba(20, 20, 20, 0.92),
            rgba(7, 7, 7, 0.84)
          );
          position: relative;
          overflow: hidden;
          animation: pulseGlow 4.5s ease-in-out infinite;
        }
        .bigMetric:before {
          content: "";
          position: absolute;
          inset: -50%;
          background: radial-gradient(
            circle,
            color-mix(in srgb, var(--glow) 24%, transparent),
            transparent 42%
          );
          opacity: 0.7;
          pointer-events: none;
        }
        .metricIcon {
          position: absolute;
          top: 20px;
          right: 22px;
          font-size: 42px;
          color: var(--glow);
          filter: drop-shadow(0 0 18px var(--glow));
        }
        .metricTitle {
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: 1.8px;
          font-weight: 900;
          font-size: 13px;
          position: relative;
        }
        .metricValue {
          font-size: clamp(46px, 5.4vw, 92px);
          line-height: 0.95;
          font-weight: 1000;
          color: #fff;
          margin-top: 18px;
          letter-spacing: -3px;
          position: relative;
          text-shadow: 0 0 24px color-mix(in srgb, var(--glow) 55%, transparent);
        }
        .metricSubtitle {
          color: #c8c8c8;
          font-size: 16px;
          margin-top: 12px;
          position: relative;
        }
        .trendPill {
          position: absolute;
          left: 22px;
          bottom: 18px;
          border-radius: 999px;
          padding: 6px 11px;
          font-size: 12px;
          font-weight: 900;
        }
        .trendUp {
          background: rgba(82, 196, 26, 0.13);
          color: #95de64;
          border: 1px solid rgba(82, 196, 26, 0.32);
        }
        .trendDown {
          background: rgba(255, 77, 79, 0.13);
          color: #ff7875;
          border: 1px solid rgba(255, 77, 79, 0.32);
        }
        .panel {
          height: 100%;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          background: rgba(12, 12, 12, 0.78);
          backdrop-filter: blur(16px);
          padding: 18px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .panelTitle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 14px;
          color: #fff;
          font-weight: 1000;
          text-transform: uppercase;
          letter-spacing: 1.4px;
        }
        .miniCard {
          border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
          border-radius: 20px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.07),
            rgba(255, 255, 255, 0.025)
          );
        }
        .miniIcon {
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          color: var(--accent);
          background: color-mix(in srgb, var(--accent) 15%, transparent);
          font-size: 22px;
        }
        .miniTitle {
          color: #969696;
          font-size: 12px;
          text-transform: uppercase;
          font-weight: 900;
          letter-spacing: 1px;
        }
        .miniValue {
          color: #fff;
          font-size: 28px;
          font-weight: 1000;
          line-height: 1.05;
        }
        .barRow {
          display: grid;
          grid-template-columns: 44px 1fr 54px;
          gap: 10px;
          align-items: center;
          margin: 8px 0;
        }
        .barTrack {
          height: 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .barFill {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #1677ff, #52c41a);
          box-shadow: 0 0 18px rgba(22, 119, 255, 0.55);
        }
        .orderRow,
        .productRow,
        .actionRow {
          display: grid;
          gap: 10px;
          align-items: center;
          border-radius: 16px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.045);
          border: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 8px;
        }
        .orderRow {
          grid-template-columns: 72px 1fr 118px 84px;
        }
        .productRow {
          grid-template-columns: 36px 1fr 78px 92px;
        }
        .actionRow {
          grid-template-columns: 82px 1fr 128px;
        }
        .tickerWrap {
          overflow: hidden;
          white-space: nowrap;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.04);
          padding: 10px 0;
        }
        .tickerContent {
          display: inline-flex;
          gap: 28px;
          min-width: 200%;
          animation: ticker 34s linear infinite;
        }
        .tickerItem {
          color: #d9d9d9;
          font-weight: 700;
        }
        .celebration {
          position: fixed;
          top: 50%;
          left: 50%;
          z-index: 20;
          width: min(760px, 86vw);
          border-radius: 42px;
          padding: 42px;
          background:
            radial-gradient(
              circle at 20% 10%,
              rgba(255, 255, 255, 0.22),
              transparent 30%
            ),
            linear-gradient(
              135deg,
              rgba(22, 119, 255, 0.96),
              rgba(82, 196, 26, 0.92)
            );
          color: #fff;
          text-align: center;
          box-shadow: 0 0 90px rgba(22, 119, 255, 0.8);
          animation: popIn 7s ease-in-out forwards;
          border: 2px solid rgba(255, 255, 255, 0.35);
        }
        .confetti {
          position: fixed;
          inset: 0;
          z-index: 19;
          pointer-events: none;
          background-image:
            radial-gradient(circle at 10% 20%, #fff 0 3px, transparent 4px),
            radial-gradient(circle at 18% 82%, #52c41a 0 4px, transparent 5px),
            radial-gradient(circle at 72% 22%, #ffd666 0 4px, transparent 5px),
            radial-gradient(circle at 86% 72%, #ff7875 0 4px, transparent 5px),
            radial-gradient(circle at 42% 60%, #69c0ff 0 4px, transparent 5px);
          animation: sparkle 0.8s ease-in-out infinite;
        }
        .pulse {
          animation: pulseGlow 1.5s ease-in-out;
        }
      `}</style>

      {celebration ? (
        <>
          <div className="confetti" />
          <div className="celebration">
            <RocketFilled
              style={{
                fontSize: 74,
                filter: "drop-shadow(0 0 20px rgba(255,255,255,.7))",
              }}
            />
            <div
              style={{
                fontSize: 64,
                fontWeight: 1000,
                lineHeight: 1,
                marginTop: 12,
              }}
            >
              {celebration.title}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 12 }}>
              {celebration.subtitle}
            </div>
            <div style={{ fontSize: 56, fontWeight: 1000, marginTop: 8 }}>
              {formatCurrency(celebration.amount)}
            </div>
          </div>
        </>
      ) : null}

      <div className="tvContent">
        <div className="tvHeader">
          <div className="brandLine">
            <div className="brandBadge">
              <LineChartOutlined />
            </div>
            <div>
              <Title className="bigTitle">Sala de Comando Vortek</Title>
              <Space size={10} wrap>
                <span className="livePill">
                  <span className="liveDot" /> AO VIVO
                </span>
                <Text style={{ color: "#8c8c8c" }}>
                  Atualizado {timeLabel(data.generatedAt)}
                </Text>
                <Text style={{ color: "#8c8c8c" }}>
                  Realtime: pedidos + polling 15s
                </Text>
              </Space>
            </div>
          </div>
          <Space>
            <Button
              icon={soundEnabled ? <SoundFilled /> : <SoundOutlined />}
              onClick={() => setSoundEnabled((value) => !value)}
              type={soundEnabled ? "primary" : "default"}
            >
              Som {soundEnabled ? "ON" : "OFF"}
            </Button>
            <Button
              icon={<FullscreenOutlined />}
              onClick={() => document.documentElement.requestFullscreen?.()}
            >
              Tela cheia
            </Button>
          </Space>
        </div>

        <Row gutter={[16, 16]} key={pulseKey} className="pulse">
          <Col xs={24} xl={8}>
            <BigMetric
              title="Vendas hoje"
              value={String(data.today.orders)}
              subtitle={`${data.lastHour.orders} pedido(s) na última hora`}
              icon={<ShoppingCartOutlined />}
              glow="#1677ff"
              trend={data.trends.ordersVsYesterday}
            />
          </Col>
          <Col xs={24} xl={8}>
            <BigMetric
              title="Faturamento hoje"
              value={compactCurrency(data.today.revenue)}
              subtitle={`Ticket médio ${formatCurrency(data.today.averageTicket)}`}
              icon={<DollarCircleFilled />}
              glow="#52c41a"
              trend={data.trends.revenueVsYesterday}
            />
          </Col>
          <Col xs={24} xl={8}>
            <BigMetric
              title="Lucro estimado"
              value={compactCurrency(data.today.profit)}
              subtitle={`${data.today.revenue > 0 ? ((data.today.profit / data.today.revenue) * 100).toFixed(1) : "0.0"}% de margem no dia`}
              icon={<FireFilled />}
              glow="#faad14"
              trend={data.trends.profitVsYesterday}
            />
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} xl={6}>
            <div className="panel">
              <div className="panelTitle">
                <span>Meta do dia</span>
                <TrophyFilled style={{ color: "#ffd666" }} />
              </div>
              <Progress
                type="dashboard"
                percent={Math.min(100, data.goal.progress)}
                size={170}
                strokeColor={{ "0%": "#1677ff", "100%": "#52c41a" }}
                trailColor="rgba(255,255,255,.08)"
                format={() => (
                  <span style={{ color: "#fff", fontWeight: 1000 }}>
                    {data.goal.progress.toFixed(0)}%
                  </span>
                )}
              />
              <div style={{ textAlign: "center", marginTop: -8 }}>
                <div style={{ color: "#fff", fontSize: 28, fontWeight: 1000 }}>
                  {formatCurrency(data.today.revenue)}
                </div>
                <Text style={{ color: "#8c8c8c" }}>
                  Faltam {formatCurrency(data.goal.remaining)} para{" "}
                  {formatCurrency(data.goal.revenue)}
                </Text>
              </div>
            </div>
          </Col>
          <Col xs={24} xl={6}>
            <div className="panel">
              <div className="panelTitle">
                <span>Operação</span>
                <BulbOutlined style={{ color: "#69c0ff" }} />
              </div>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <MiniCard
                  title="Anúncios ativos"
                  value={formatNumber(data.operations.activeAds)}
                  accent="#1677ff"
                  icon={<RocketFilled />}
                />
                <MiniCard
                  title="Produtos ativos"
                  value={formatNumber(data.operations.activeProducts)}
                  accent="#52c41a"
                  icon={<ShoppingCartOutlined />}
                />
                <MiniCard
                  title="Reclamações abertas"
                  value={formatNumber(data.operations.openClaims)}
                  accent="#ff4d4f"
                  icon={<AlertOutlined />}
                />
              </Space>
            </div>
          </Col>
          <Col xs={24} xl={6}>
            <div className="panel">
              <div className="panelTitle">
                <span>Marketplace</span>
                <EyeOutlined style={{ color: "#b37feb" }} />
              </div>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <MiniCard
                  title="Visitas sincronizadas"
                  value={formatNumber(data.marketplace.totalVisits)}
                  accent="#b37feb"
                  icon={<EyeOutlined />}
                />
                <MiniCard
                  title="Unidades vendidas"
                  value={formatNumber(data.marketplace.totalSold)}
                  accent="#faad14"
                  icon={<FireFilled />}
                />
                <MiniCard
                  title="Painéis online"
                  value={onlineViewers}
                  accent="#13c2c2"
                  icon={<BellFilled />}
                />
              </Space>
            </div>
          </Col>
          <Col xs={24} xl={6}>
            <div className="panel">
              <div className="panelTitle">
                <span>Status hoje</span>
                <ClockCircleOutlined style={{ color: "#95de64" }} />
              </div>
              <Space wrap size={[8, 10]}>
                {Object.entries(data.today.statusCounts).length === 0 ? (
                  <Text style={{ color: "#8c8c8c" }}>Sem pedidos hoje</Text>
                ) : null}
                {Object.entries(data.today.statusCounts).map(
                  ([status, count]) => (
                    <Tag
                      key={status}
                      color={statusColor[status] || "#595959"}
                      style={{
                        fontSize: 15,
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontWeight: 900,
                      }}
                    >
                      {statusLabel[status] || status}: {count}
                    </Tag>
                  ),
                )}
              </Space>
              <div style={{ marginTop: 18 }}>
                <Text style={{ color: "#8c8c8c" }}>Melhor hora</Text>
                <div style={{ fontSize: 34, color: "#fff", fontWeight: 1000 }}>
                  {bestHour?.label || "--"} ·{" "}
                  {formatCurrency(bestHour?.revenue || 0)}
                </div>
              </div>
            </div>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} xl={8}>
            <div className="panel">
              <div className="panelTitle">
                <span>Vendas por hora</span>
                <LineChartOutlined style={{ color: "#1677ff" }} />
              </div>
              {(data.hourlySales || [])
                .filter((item) => item.revenue > 0 || item.orders > 0)
                .slice(-12)
                .map((item) => (
                  <div className="barRow" key={item.hour}>
                    <Text style={{ color: "#bfbfbf", fontWeight: 800 }}>
                      {item.label}
                    </Text>
                    <div className="barTrack">
                      <div
                        className="barFill"
                        style={{
                          width: `${Math.max(4, (item.revenue / maxHourRevenue) * 100)}%`,
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
                      {item.orders} ped.
                    </Text>
                  </div>
                ))}
              {(data.hourlySales || []).every(
                (item) => item.revenue === 0 && item.orders === 0,
              ) ? (
                <Text style={{ color: "#8c8c8c" }}>
                  Aguardando primeiras vendas do dia.
                </Text>
              ) : null}
            </div>
          </Col>

          <Col xs={24} xl={8}>
            <div className="panel">
              <div className="panelTitle">
                <span>Últimas vendas</span>
                <CustomerServiceOutlined style={{ color: "#52c41a" }} />
              </div>
              {data.recentOrders.map((order) => (
                <div className="orderRow" key={order.id}>
                  <Text
                    style={{
                      color: "#69c0ff",
                      fontWeight: 1000,
                      fontFamily: "monospace",
                    }}
                  >
                    #{order.number}
                  </Text>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#fff",
                        fontWeight: 900,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {order.customer}
                    </div>
                    <Text style={{ color: "#8c8c8c" }}>
                      {timeLabel(order.date)}
                    </Text>
                  </div>
                  <Text style={{ color: "#95de64", fontWeight: 1000 }}>
                    {formatCurrency(order.total)}
                  </Text>
                  <Tag
                    color={statusColor[order.status] || "#595959"}
                    style={{ margin: 0 }}
                  >
                    {statusLabel[order.status] || order.status}
                  </Tag>
                </div>
              ))}
            </div>
          </Col>

          <Col xs={24} xl={8}>
            <div className="panel">
              <div className="panelTitle">
                <span>Fila que precisa atenção</span>
                <AlertOutlined style={{ color: "#ff7875" }} />
              </div>
              {data.actionQueue.length === 0 ? (
                <Text style={{ color: "#95de64", fontWeight: 900 }}>
                  Fila limpa. Loja redonda.
                </Text>
              ) : null}
              {data.actionQueue.slice(0, 8).map((order) => (
                <div className="actionRow" key={order.id}>
                  <Text
                    style={{
                      color: "#ffd666",
                      fontWeight: 1000,
                      fontFamily: "monospace",
                    }}
                  >
                    #{order.number}
                  </Text>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#fff",
                        fontWeight: 900,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {order.customer}
                    </div>
                    <Space size={6} wrap>
                      {order.needsInvoice ? (
                        <Tag color="magenta">NF</Tag>
                      ) : null}
                      {order.needsLabel ? (
                        <Tag color="blue">Etiqueta</Tag>
                      ) : null}
                    </Space>
                  </div>
                  <Tag
                    color={statusColor[order.status] || "#595959"}
                    style={{ margin: 0, textAlign: "center" }}
                  >
                    {order.action}
                  </Tag>
                </div>
              ))}
            </div>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <div className="panel">
              <div className="panelTitle">
                <span>Produtos campeões</span>
                <TrophyFilled style={{ color: "#ffd666" }} />
              </div>
              <Row gutter={[12, 12]}>
                {data.topProducts.slice(0, 6).map((product) => (
                  <Col xs={24} md={12} xl={8} key={product.mlItemId}>
                    <div className="productRow">
                      <div
                        style={{
                          color: product.rank <= 3 ? "#ffd666" : "#8c8c8c",
                          fontSize: 22,
                          fontWeight: 1000,
                        }}
                      >
                        #{product.rank}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: "#fff",
                            fontWeight: 900,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {product.title}
                        </div>
                        <Text style={{ color: "#8c8c8c" }}>
                          {product.sku || product.mlItemId}
                        </Text>
                      </div>
                      <div style={{ color: "#95de64", fontWeight: 1000 }}>
                        {product.sold} vend.
                      </div>
                      <div style={{ color: "#69c0ff", fontWeight: 1000 }}>
                        {formatNumber(product.visits)} vis.
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>
          </Col>
        </Row>

        <div className="tickerWrap" style={{ marginTop: 16 }}>
          <div className="tickerContent">
            {[...data.recentOrders, ...data.recentOrders].map(
              (order, index) => (
                <span className="tickerItem" key={`${order.id}-${index}`}>
                  🛒 #{order.number} · {order.customer} ·{" "}
                  {formatCurrency(order.total)} ·{" "}
                  {statusLabel[order.status] || order.status}
                </span>
              ),
            )}
          </div>
        </div>

        <Text
          style={{
            display: "block",
            color: "#6f6f6f",
            marginTop: 10,
            fontSize: 12,
          }}
        >
          {data.realtimeSources.visitors}
        </Text>
      </div>
    </div>
  );
}
