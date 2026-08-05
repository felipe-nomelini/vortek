import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { TvLive } from "@/api/tv";
import { LoadingScreen } from "@/components/loading-screen";
import { Screen } from "@/components/screen";
import { useTvLive, useTvMetrics } from "@/hooks/use-tv";
import { colors } from "@/theme/colors";

type Summary = TvLive["today"];

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function compactCurrency(value: number) {
  if (Math.abs(value) >= 1000) {
    return `R$ ${(value / 1000).toFixed(1).replace(".", ",")} mil`;
  }
  return currency(value).replace(",00", "");
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function MetricCard({
  label,
  value,
  accent = colors.text,
  wide,
}: {
  label: string;
  value: string;
  accent?: string;
  wide: boolean;
}) {
  return (
    <View style={[styles.metricCard, { width: wide ? "48.5%" : "100%" }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function Trend({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  return (
    <View style={styles.trend}>
      <Text style={styles.trendLabel}>{label}</Text>
      <Text style={{ color: positive ? colors.success : colors.danger }}>
        {positive ? "+" : ""}{value.toFixed(1).replace(".", ",")}%
      </Text>
    </View>
  );
}

function GoalBar({
  label,
  current,
  target,
  format,
}: {
  label: string;
  current: number;
  target: number;
  format: (value: number) => string;
}) {
  const progress = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
  return (
    <View style={styles.goal}>
      <View style={styles.goalHeader}>
        <Text style={styles.goalLabel}>{label}</Text>
        <Text style={styles.goalValue}>
          {format(current)} / {format(target)}
        </Text>
      </View>
      <View style={styles.goalTrack}>
        <View
          style={[
            styles.goalProgress,
            {
              width: `${progress}%`,
              backgroundColor: progress >= 100 ? colors.success : colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );
}

function PeriodSummary({ title, data }: { title: string; data: Summary }) {
  return (
    <View style={styles.periodCard}>
      <Text style={styles.periodTitle}>{title}</Text>
      <Text style={styles.periodRevenue}>{currency(data.revenue)}</Text>
      <Text style={styles.periodText}>
        {data.orders} pedidos · lucro {currency(data.profit)}
      </Text>
    </View>
  );
}

export default function TvScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 600;
  const live = useTvLive();
  const metrics = useTvMetrics();
  const [manualRefresh, setManualRefresh] = useState(false);

  const topHours = useMemo(
    () =>
      [...(metrics.data?.hourlySales || [])]
        .filter((item) => item.orders > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 4),
    [metrics.data?.hourlySales],
  );

  async function refresh() {
    setManualRefresh(true);
    await Promise.all([live.refetch(), metrics.refetch()]);
    setManualRefresh(false);
  }

  const current = live.data || metrics.data;
  if (!current && (live.isPending || metrics.isPending)) {
    return <LoadingScreen message="Carregando TV ao vivo" />;
  }

  if (!current) {
    return (
      <Screen>
        <Text style={styles.title}>TV ao vivo</Text>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Não foi possível carregar a TV.</Text>
          <Pressable onPress={refresh} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={manualRefresh}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>TV ao vivo</Text>
          <Text style={styles.updated}>
            Atualizado {dateTime(live.data?.generatedAt || metrics.data?.generatedAt)}
          </Text>
        </View>
        {(live.isFetching || metrics.isFetching) && !manualRefresh ? (
          <View style={styles.syncDot} />
        ) : null}
      </View>

      <View style={styles.metricsGrid}>
        <MetricCard
          accent={colors.primary}
          label="Faturamento hoje"
          value={currency(current.today.revenue)}
          wide={wide}
        />
        <MetricCard
          accent={colors.success}
          label="Lucro hoje"
          value={currency(current.today.profit)}
          wide={wide}
        />
        <MetricCard
          label="Pedidos hoje"
          value={String(current.today.orders)}
          wide={wide}
        />
        <MetricCard
          label="Ticket médio"
          value={currency(current.today.averageTicket)}
          wide={wide}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Comparação com ontem</Text>
        <Trend label="Faturamento" value={current.trends.revenueVsYesterday} />
        <Trend label="Pedidos" value={current.trends.ordersVsYesterday} />
        <Trend label="Lucro" value={current.trends.profitVsYesterday} />
      </View>

      {metrics.data ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Metas de hoje</Text>
          <GoalBar
            current={current.today.profit}
            format={compactCurrency}
            label="Lucro"
            target={metrics.data.goals.profit.day}
          />
          <GoalBar
            current={current.today.revenue}
            format={compactCurrency}
            label="Faturamento"
            target={metrics.data.goals.revenue.day}
          />
          <GoalBar
            current={current.today.orders}
            format={(value) => String(Math.round(value))}
            label="Pedidos"
            target={metrics.data.goals.orders.day}
          />
        </View>
      ) : null}

      <View style={[styles.periodGrid, wide && styles.periodGridWide]}>
        <PeriodSummary data={current.week} title="Semana" />
        <PeriodSummary data={current.month} title="Mês" />
      </View>

      {metrics.data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Operação</Text>
            <View style={styles.operationGrid}>
              <Text style={styles.operationText}>
                Pendências: {metrics.data.operations.actionQueueCount}
              </Text>
              <Text style={styles.operationText}>
                Reclamações: {metrics.data.operations.openClaims}
              </Text>
              <Text style={styles.operationText}>
                Anúncios ativos: {metrics.data.operations.activeAds}
              </Text>
              <Text style={styles.operationText}>
                Catálogo ganhando: {metrics.data.ads.winningCatalog}
              </Text>
            </View>
          </View>

          {topHours.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Melhores horários de hoje</Text>
              {topHours.map((hour) => (
                <View key={hour.hour} style={styles.row}>
                  <Text style={styles.rowTitle}>{hour.label}</Text>
                  <Text style={styles.rowValue}>
                    {hour.orders} pedidos · {currency(hour.revenue)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Vendas recentes</Text>
        {current.recentOrders.length ? (
          current.recentOrders.map((order) => (
            <View key={order.id} style={styles.order}>
              <View style={styles.orderHeader}>
                <Text style={styles.orderNumber}>#{order.number}</Text>
                <Text style={styles.orderTotal}>{currency(order.total)}</Text>
              </View>
              <Text numberOfLines={1} style={styles.orderCustomer}>
                {order.customer}
              </Text>
              <Text numberOfLines={2} style={styles.orderProduct}>
                {order.productName}
              </Text>
              <View style={styles.orderFooter}>
                <Text style={styles.status}>{order.status}</Text>
                <Text style={styles.updated}>{dateTime(order.date)}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>Nenhuma venda encontrada.</Text>
        )}
      </View>

      {metrics.data?.recentQuestions.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Perguntas recentes</Text>
          {metrics.data.recentQuestions.slice(0, 5).map((question) => (
            <View key={question.id} style={styles.question}>
              <Text numberOfLines={1} style={styles.questionProduct}>
                {question.anuncio}
              </Text>
              <Text style={styles.questionText}>{question.pergunta}</Text>
              <Text style={styles.updated}>{dateTime(question.date)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {live.isError || metrics.isError ? (
        <Text style={styles.partialWarning}>
          Parte dos dados não atualizou. Tentaremos novamente automaticamente.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  updated: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  syncDot: {
    backgroundColor: colors.primary,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  metricCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  metricLabel: { color: colors.textMuted, fontSize: 13 },
  metricValue: { fontSize: 23, fontWeight: "800" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  trend: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  trendLabel: { color: colors.textMuted },
  goal: { gap: 7 },
  goalHeader: { flexDirection: "row", justifyContent: "space-between" },
  goalLabel: { color: colors.textMuted },
  goalValue: { color: colors.text, fontSize: 12 },
  goalTrack: {
    backgroundColor: colors.border,
    borderRadius: 4,
    height: 7,
    overflow: "hidden",
  },
  goalProgress: { borderRadius: 4, height: 7 },
  periodGrid: { gap: 10 },
  periodGridWide: { flexDirection: "row" },
  periodCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    padding: 16,
  },
  periodTitle: { color: colors.textMuted },
  periodRevenue: { color: colors.primary, fontSize: 20, fontWeight: "800" },
  periodText: { color: colors.textMuted, fontSize: 12 },
  operationGrid: { gap: 9 },
  operationText: { color: colors.text },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowValue: { color: colors.textMuted },
  order: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 5,
    paddingTop: 12,
  },
  orderHeader: { flexDirection: "row", justifyContent: "space-between" },
  orderNumber: { color: colors.primary, fontWeight: "800" },
  orderTotal: { color: colors.text, fontWeight: "800" },
  orderCustomer: { color: colors.text },
  orderProduct: { color: colors.textMuted, fontSize: 13 },
  orderFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  status: {
    backgroundColor: "#172554",
    borderRadius: 5,
    color: "#93c5fd",
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  empty: { color: colors.textMuted },
  question: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 5,
    paddingTop: 12,
  },
  questionProduct: { color: colors.primary, fontWeight: "700" },
  questionText: { color: colors.text, lineHeight: 20 },
  partialWarning: { color: colors.warning, fontSize: 12, textAlign: "center" },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  errorTitle: { color: colors.danger, fontSize: 17, fontWeight: "700" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 12,
  },
  primaryButtonText: { color: colors.text, fontWeight: "700" },
});
