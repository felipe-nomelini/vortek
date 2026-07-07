"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Progress,
  Row,
  Spin,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  DislikeFilled,
  LikeFilled,
  RocketFilled,
  StarFilled,
  ThunderboltFilled,
  TrophyFilled,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type ReputationMetric = {
  rate: number | null;
  percent: number | null;
  value: number | null;
  period: string | null;
  excluded?: number | null;
};

type ReputacaoResponse = {
  conectado?: boolean;
  precisaReconectar?: boolean;
  indisponivel?: boolean;
  erro?: string;
  user?: {
    id: number | string;
    nickname: string | null;
    permalink: string | null;
    registration_date: string | null;
    site_id?: string | null;
    tags?: string[];
  };
  seller_reputation?: {
    level_id: string;
    power_seller_status: string | null;
    real_level: string | null;
    protection_end_date: string | null;
  };
  transactions?: {
    total: number;
    completed: number;
    canceled: number;
    period: string | null;
    ratings: {
      positive: number | null;
      neutral: number | null;
      negative: number | null;
    };
  };
  metrics?: {
    claims: ReputationMetric;
    delayed_handling_time: ReputationMetric;
    cancellations: ReputationMetric;
    sales_completed: number | null;
    period: string | null;
  };
  orders_summary?: {
    six_months: {
      sold: number | null;
      canceled: number | null;
      feedback: {
        positive: number | null;
        neutral: number | null;
        negative: number | null;
      };
    };
    twelve_months: {
      sold: number | null;
      canceled: number | null;
      feedback: {
        positive: number | null;
        neutral: number | null;
        negative: number | null;
      };
    };
  };
  feedback?: {
    source: string;
    period: string;
    positive: number | null;
    neutral: number | null;
    negative: number | null;
    total: number | null;
    positive_percent: number | null;
  };

  reclamacoes: number | null;
  atrasos: number | null;
  cancelamentos: number | null;
  positivas: number | null;
  nivel: string;
  nivelCor: string;
  nivelKey: string;
};

const levelConfig: Record<
  string,
  { color: string; bg: string; label: string; icon: React.ReactNode }
> = {
  "5_green": {
    color: "#5aab2c",
    bg: "#162312",
    label: "Verde",
    icon: <StarFilled />,
  },
  "4_light_green": {
    color: "#73d13d",
    bg: "#162812",
    label: "Verde claro",
    icon: <StarFilled />,
  },
  "4_light_blue": {
    color: "#73d13d",
    bg: "#162812",
    label: "Verde claro",
    icon: <StarFilled />,
  },
  "3_yellow": {
    color: "#faad14",
    bg: "#2a1f0a",
    label: "Amarelo",
    icon: <StarFilled />,
  },
  "2_orange": {
    color: "#fa8c16",
    bg: "#2a1706",
    label: "Laranja",
    icon: <StarFilled />,
  },
  "1_red": {
    color: "#ff4d4f",
    bg: "#2a0d0e",
    label: "Vermelho",
    icon: <StarFilled />,
  },
  default: {
    color: "#888",
    bg: "#1f1f1f",
    label: "Sem reputação",
    icon: <StarFilled />,
  },
};

const psConfig: Record<string, { label: string; color: string; bg: string }> = {
  platinum: {
    label: "Mercado Líder Platinum",
    color: "#d9d9d9",
    bg: "#1a1919",
  },
  gold: { label: "Mercado Líder Gold", color: "#faad14", bg: "#2a1f0a" },
  silver: { label: "Mercado Líder", color: "#a0a0a0", bg: "#141414" },
  bronze: { label: "Mercado Líder", color: "#cd7f32", bg: "#1f150e" },
};

const levelOrder = [
  "1_red",
  "2_orange",
  "3_yellow",
  "4_light_green",
  "5_green",
] as const;
const softRed = "#ff4d4f";
const softOrange = "#fa8c16";
const softYellow = "#faad14";
const softBlue = "#1677ff";
const softGreen = "#5aab2c";

function formatPercent(value: number | null | undefined, decimals = 1): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(decimals)}%`
    : "—";
}

function formatNumber(value: number | null | undefined): string | number {
  return typeof value === "number" && Number.isFinite(value) ? value : "—";
}

function metricInfo(
  rate: number | null | undefined,
  thresholds: [number, number, number, number],
): { color: string; label: string } {
  if (rate === null || rate === undefined || !Number.isFinite(rate))
    return { color: "#888", label: "Sem dados" };
  if (rate <= thresholds[1]) return { color: softGreen, label: "Excelente" };
  if (rate <= thresholds[2]) return { color: softYellow, label: "Bom" };
  if (rate <= thresholds[3]) return { color: softOrange, label: "Atenção" };
  return { color: softRed, label: "Crítico" };
}

export default function ReputacaoPage() {
  const [data, setData] = useState<ReputacaoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/ml/reputacao", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            json?.erro || "Falha ao carregar reputação do Mercado Livre.",
          );
        if (active) setData(json as ReputacaoResponse);
      } catch (err: any) {
        if (active)
          setError(
            err?.message || "Falha ao carregar reputação do Mercado Livre.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const levelId = data?.seller_reputation?.level_id || "";
  const lvl = levelConfig[levelId] || levelConfig.default;
  const powerSeller = data?.seller_reputation?.power_seller_status || "";
  const ps = powerSeller ? psConfig[powerSeller] : null;
  const psLabel = ps?.label || "";
  const transactions = data?.transactions;
  const feedback = data?.feedback;
  const feedbackTotal = feedback?.total || 0;
  const positivePct = feedback?.positive_percent ?? null;
  const neutralPct =
    feedbackTotal > 0 && typeof feedback?.neutral === "number"
      ? (feedback.neutral / feedbackTotal) * 100
      : null;
  const negativePct =
    feedbackTotal > 0 && typeof feedback?.negative === "number"
      ? (feedback.negative / feedbackTotal) * 100
      : null;
  const cancelRate = transactions?.total
    ? (transactions.canceled / transactions.total) * 100
    : null;
  const m = data?.metrics;
  const badges = useMemo(() => {
    const list = [];
    if (psLabel && ps)
      list.push({
        icon: <TrophyFilled />,
        color: ps.color,
        label: psLabel,
        desc: "Reconhecimento informado pelo Mercado Livre",
      });
    list.push({
      icon: <RocketFilled />,
      color: lvl.color,
      label: `Nível ${lvl.label}`,
      desc: levelId
        ? "Termômetro atual do Mercado Livre"
        : "Conta sem nível público retornado",
    });
    if (m?.period)
      list.push({
        icon: <ThunderboltFilled />,
        color: softYellow,
        label: `Período ${m.period}`,
        desc: "Janela de métricas retornada pelo Mercado Livre",
      });
    return list;
  }, [levelId, lvl.color, lvl.label, m?.period, ps, psLabel]);

  const cardBg = {
    background: "#141414",
    border: "1px solid #303030",
    borderRadius: 8,
  };
  const claimsTh: [number, number, number, number] = [0.01, 0.02, 0.045, 0.08];
  const handlingTh: [number, number, number, number] = [0.06, 0.1, 0.18, 0.22];
  const cancelTh: [number, number, number, number] = [
    0.005, 0.015, 0.035, 0.04,
  ];

  if (loading) {
    return (
      <div>
        <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
          Reputação - Mercado Livre
        </Title>
        <Card
          styles={{ body: { padding: 40, textAlign: "center" } }}
          style={cardBg}
        >
          <Spin />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
          Reputação - Mercado Livre
        </Title>
        <Alert type="error" showIcon message={error} />
      </div>
    );
  }

  if (!data?.conectado || data?.precisaReconectar) {
    return (
      <div>
        <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
          Reputação - Mercado Livre
        </Title>
        <Card
          styles={{ body: { padding: 32, textAlign: "center" } }}
          style={cardBg}
        >
          <Text style={{ color: "#888", display: "block", marginBottom: 12 }}>
            Mercado Livre desconectado.
          </Text>
          <Button type="primary" href="/api/integracao/ml/connect">
            Reconectar ML
          </Button>
        </Card>
      </div>
    );
  }

  if (data?.indisponivel) {
    return (
      <div>
        <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
          Reputação - Mercado Livre
        </Title>
        <Alert
          type="warning"
          showIcon
          message="Mercado Livre não retornou reputação para esta conta."
        />
      </div>
    );
  }

  return (
    <div>
      <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
        Reputação - Mercado Livre
      </Title>

      <Card
        styles={{ body: { padding: 24 } }}
        style={{ ...cardBg, marginBottom: 20 }}
      >
        <Row align="middle" gutter={24}>
          <Col>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                background: lvl.bg,
                color: lvl.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
              }}
            >
              {lvl.icon}
            </div>
          </Col>
          <Col flex="auto">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 4,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, color: "#e0e0e0" }}>
                {data.user?.nickname || "Loja Mercado Livre"}
              </span>
              {psLabel && ps && (
                <Tag color={ps.color} style={{ margin: 0, fontWeight: 600 }}>
                  {psLabel}
                </Tag>
              )}
              <Tag
                color={lvl.color === softGreen ? undefined : lvl.color}
                style={{
                  margin: 0,
                  fontWeight: 600,
                  ...(lvl.color === softGreen
                    ? {
                        color: softGreen,
                        background: "#162312",
                        borderColor: softGreen,
                      }
                    : {}),
                }}
              >
                {lvl.label}
              </Tag>
            </div>
            <Text style={{ color: "#808080", fontSize: 12 }}>
              Dados reais do Mercado Livre · usuário {data.user?.id || "—"}
            </Text>
            <div
              style={{ display: "flex", gap: 4, marginTop: 10, maxWidth: 400 }}
            >
              {levelOrder.map((key) => {
                const lc = levelConfig[key];
                const active = levelId === key;
                return (
                  <div
                    key={key}
                    style={{
                      flex: 1,
                      height: 12,
                      borderRadius: 4,
                      background: active ? lc.color : "#252525",
                      transition: "all .3s",
                    }}
                  />
                );
              })}
            </div>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} md={8}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic
              title={
                <span style={{ color: "#a0a0a0" }}>Vendas Concluídas</span>
              }
              value={formatNumber(transactions?.completed)}
              prefix={<LikeFilled style={{ color: softGreen }} />}
              valueStyle={{ color: "#e0e0e0" }}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic
              title={<span style={{ color: "#a0a0a0" }}>Cancelamentos</span>}
              value={formatNumber(transactions?.canceled)}
              suffix={
                <span style={{ fontSize: 14, color: "#a0a0a0" }}>
                  ({formatPercent(cancelRate)})
                </span>
              }
              prefix={<DislikeFilled style={{ color: softRed }} />}
              valueStyle={{ color: "#e0e0e0" }}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic
              title={<span style={{ color: "#a0a0a0" }}>Total Transações</span>}
              value={formatNumber(transactions?.total)}
              prefix={<StarFilled style={{ color: softBlue }} />}
              valueStyle={{ color: "#e0e0e0" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card
            styles={{ body: { padding: 20 } }}
            style={{ ...cardBg, height: "100%" }}
          >
            <Title
              level={5}
              style={{
                color: "#a0a0a0",
                marginBottom: 16,
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Métricas de Qualidade{m?.period ? ` · ${m.period}` : ""}
            </Title>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {[
                {
                  label: "Reclamações",
                  metric: m?.claims,
                  thresholds: claimsTh,
                },
                {
                  label: "Atraso na Entrega",
                  metric: m?.delayed_handling_time,
                  thresholds: handlingTh,
                },
                {
                  label: "Cancelamentos",
                  metric: m?.cancellations,
                  thresholds: cancelTh,
                },
              ].map((item) => {
                const pct = item.metric?.percent;
                const info = metricInfo(item.metric?.rate, item.thresholds);
                return (
                  <div key={item.label}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 6,
                        gap: 12,
                      }}
                    >
                      <Text style={{ color: "#c0c0c0", fontSize: 13 }}>
                        {item.label}
                      </Text>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Text style={{ color: "#a0a0a0", fontSize: 12 }}>
                          {formatNumber(item.metric?.value)} ocorrências
                        </Text>
                        <Tag
                          color={
                            info.color === softGreen ? undefined : info.color
                          }
                          style={{
                            margin: 0,
                            fontWeight: 600,
                            fontSize: 11,
                            ...(info.color === softGreen
                              ? {
                                  color: softGreen,
                                  background: "#162312",
                                  borderColor: softGreen,
                                }
                              : {}),
                          }}
                        >
                          {info.label}
                        </Tag>
                      </div>
                    </div>
                    <Progress
                      percent={
                        pct === null || pct === undefined
                          ? 0
                          : Number(pct.toFixed(2))
                      }
                      strokeColor={info.color}
                      trailColor="#303030"
                      format={() => formatPercent(pct)}
                      size="small"
                    />
                  </div>
                );
              })}
            </div>
            <Divider style={{ borderColor: "#303030", margin: "16px 0" }} />
            <Text style={{ color: "#666", fontSize: 12 }}>
              Vendas no período: {formatNumber(m?.sales_completed)}
            </Text>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            styles={{ body: { padding: 20 } }}
            style={{ ...cardBg, height: "100%" }}
          >
            <Title
              level={5}
              style={{
                color: "#a0a0a0",
                marginBottom: 16,
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Feedbacks de vendas · últimos 12 meses
            </Title>
            {feedbackTotal > 0 ? (
              <>
                <div
                  style={{
                    display: "flex",
                    borderRadius: 6,
                    overflow: "hidden",
                    height: 32,
                    marginBottom: 12,
                    background: "#252525",
                  }}
                >
                  {positivePct !== null && positivePct > 0 && (
                    <div
                      style={{
                        flex: positivePct,
                        background: softGreen,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {positivePct.toFixed(1)}%
                    </div>
                  )}
                  {neutralPct !== null && neutralPct > 0 && (
                    <div
                      style={{
                        flex: neutralPct,
                        background: softBlue,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {neutralPct.toFixed(1)}%
                    </div>
                  )}
                  {negativePct !== null && negativePct > 0 && (
                    <div
                      style={{
                        flex: negativePct,
                        background: softRed,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {negativePct.toFixed(1)}%
                    </div>
                  )}
                </div>
                <Row gutter={[16, 8]} style={{ marginBottom: 20 }}>
                  <Col>
                    <Text style={{ color: softGreen }}>
                      Positivas: {formatNumber(feedback?.positive)} (
                      {formatPercent(positivePct)})
                    </Text>
                  </Col>
                  <Col>
                    <Text style={{ color: softBlue }}>
                      Neutras: {formatNumber(feedback?.neutral)} (
                      {formatPercent(neutralPct)})
                    </Text>
                  </Col>
                  <Col>
                    <Text style={{ color: softRed }}>
                      Negativas: {formatNumber(feedback?.negative)} (
                      {formatPercent(negativePct)})
                    </Text>
                  </Col>
                </Row>
              </>
            ) : (
              <Text
                style={{ color: "#808080", display: "block", marginBottom: 20 }}
              >
                Mercado Livre não retornou feedbacks de vendas no período.
              </Text>
            )}

            <Title
              level={5}
              style={{
                color: "#a0a0a0",
                marginBottom: 12,
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Selos & Conquistas
            </Title>
            <Row gutter={[12, 12]}>
              {badges.map((badge, i) => (
                <Col xs={24} sm={12} key={i}>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      padding: 12,
                      borderRadius: 8,
                      background: "#1a1a1a",
                      border: "1px solid #303030",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 24,
                        color: badge.color,
                        flexShrink: 0,
                      }}
                    >
                      {badge.icon}
                    </div>
                    <div>
                      <Text
                        style={{
                          color: "#e0e0e0",
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        {badge.label}
                      </Text>
                      <br />
                      <Text style={{ color: "#808080", fontSize: 12 }}>
                        {badge.desc}
                      </Text>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
