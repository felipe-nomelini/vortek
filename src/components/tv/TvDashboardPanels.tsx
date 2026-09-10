"use client";

import { Empty, Progress, Tag, Typography } from "antd";
import { formatCurrency } from "@/lib/format";
import type {
  TvDynamicGoals,
  TvGoalValues,
  TvMetrics,
  TvOrderSummary,
  TvQuestionSummary,
} from "@/lib/tv/dashboard";
import styles from "@/app/(app)/tv/tv.module.css";

const { Text } = Typography;

function compactCurrency(value: number) {
  if (Math.abs(value) >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")} mil`;
  }
  return formatCurrency(value).replace(",00", "");
}

function formatDateTime(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (status === "concretizada_ml") return "Concretizada pelo ML";
  return status.replaceAll("_", " ");
}

function statusColor(status: string) {
  const colors: Record<string, string> = {
    aberto: "blue",
    pendente: "gold",
    preparando: "purple",
    pronto_envio: "cyan",
    etiqueta_impressa: "geekblue",
    faturado: "green",
    atendido: "green",
    entregue: "success",
    concretizada_ml: "gold",
    cancelado: "red",
  };
  return colors[status] || "default";
}

export function TvMetricStrip({ data }: { data: TvMetrics }) {
  return (
    <section className={styles.metricStrip} aria-label="Resultado de hoje">
      <article className={`${styles.metric} ${styles.metricPrimary}`}>
        <span>Faturamento hoje</span>
        <strong>{formatCurrency(data.today.revenue)}</strong>
        <small>{data.trends.revenueVsYesterday >= 0 ? "+" : ""}{data.trends.revenueVsYesterday}% vs. ontem</small>
      </article>
      <article className={styles.metric}>
        <span>Vendas</span>
        <strong>{data.today.orders}</strong>
        <small>ticket médio {formatCurrency(data.today.averageTicket)}</small>
      </article>
      <article className={`${styles.metric} ${styles.metricProfit}`}>
        <span>Lucro hoje</span>
        <strong>{formatCurrency(data.today.profit)}</strong>
        <small>{data.trends.profitVsYesterday >= 0 ? "+" : ""}{data.trends.profitVsYesterday}% vs. ontem</small>
      </article>
    </section>
  );
}

function goalProgress(current: number, target: number) {
  return Math.min(100, Math.max(0, Math.round((current / Math.max(1, target)) * 100)));
}

function GoalLine({
  label,
  current,
  targets,
  values,
  currency,
}: {
  label: string;
  current: number;
  targets: TvGoalValues;
  values: TvGoalValues;
  currency?: boolean;
}) {
  const format = currency ? compactCurrency : (value: number) => String(Math.round(value));
  const percent = goalProgress(current, targets.day);
  return (
    <div className={styles.goalLine}>
      <div className={styles.goalHeader}>
        <span>{label}</span>
        <strong>{format(current)} <small>/ {format(targets.day)}</small></strong>
      </div>
      <Progress
        aria-label={`${label}: ${percent}% da meta diária`}
        percent={percent}
        showInfo={false}
        strokeColor={percent >= 100 ? "#52c41a" : "#ffbd0e"}
        trailColor="#34313a"
      />
      <small className={styles.goalPeriods}>
        Semana {format(values.week)} / {format(targets.week)} · Mês {format(values.month)} / {format(targets.month)}
      </small>
    </div>
  );
}

export function TvGoalsPanel({
  data,
  goals,
}: {
  data: TvMetrics;
  goals: Pick<TvDynamicGoals, "orders" | "revenue" | "profit">;
}) {
  return (
    <section className={styles.panel} aria-labelledby="tv-goals-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Ritmo comercial</span>
          <h2 id="tv-goals-title">Metas</h2>
        </div>
        <span className={styles.panelHint}>progresso de hoje</span>
      </header>
      <div className={styles.goals}>
        <GoalLine
          label="Lucro"
          current={data.today.profit}
          targets={goals.profit}
          values={{ day: data.today.profit, week: data.week.profit, month: data.month.profit }}
          currency
        />
        <GoalLine
          label="Faturamento"
          current={data.today.revenue}
          targets={goals.revenue}
          values={{ day: data.today.revenue, week: data.week.revenue, month: data.month.revenue }}
          currency
        />
        <GoalLine
          label="Vendas"
          current={data.today.orders}
          targets={goals.orders}
          values={{ day: data.today.orders, week: data.week.orders, month: data.month.orders }}
        />
      </div>
    </section>
  );
}

export function TvProjectionPanel({ data }: { data: TvMetrics }) {
  return (
    <section className={styles.panel} aria-labelledby="tv-projection-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Tendência</span>
          <h2 id="tv-projection-title">Projeção</h2>
        </div>
        <span className={styles.panelHint}>{compactCurrency(data.projection.basis.dailyPace.revenue)} / dia</span>
      </header>
      <div className={styles.projectionGrid}>
        <div>
          <span>Fechamento do mês</span>
          <strong>{compactCurrency(data.projection.currentMonth.revenue)}</strong>
          <small>{data.projection.currentMonth.orders} vendas · lucro {compactCurrency(data.projection.currentMonth.profit)}</small>
        </div>
        <div>
          <span>Próximo mês no ritmo</span>
          <strong>{compactCurrency(data.projection.nextMonth.revenue)}</strong>
          <small>{data.projection.nextMonth.orders} vendas · lucro {compactCurrency(data.projection.nextMonth.profit)}</small>
        </div>
      </div>
      <div className={styles.trendGrid}>
        <span>Faturamento <strong>{data.trends.revenueVsYesterday >= 0 ? "+" : ""}{data.trends.revenueVsYesterday}%</strong></span>
        <span>Vendas <strong>{data.trends.ordersVsYesterday >= 0 ? "+" : ""}{data.trends.ordersVsYesterday}%</strong></span>
        <span>Lucro <strong>{data.trends.profitVsYesterday >= 0 ? "+" : ""}{data.trends.profitVsYesterday}%</strong></span>
      </div>
    </section>
  );
}

export function TvRecentSales({ orders }: { orders: TvOrderSummary[] }) {
  return (
    <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby="tv-sales-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Entrada mais recente</span>
          <h2 id="tv-sales-title">Vendas</h2>
        </div>
        <span className={styles.panelHint}>últimas {Math.min(5, orders.length)}</span>
      </header>
      {orders.length ? (
        <div className={styles.salesList}>
          {orders.slice(0, 5).map((order) => (
            <article className={styles.saleRow} key={order.id}>
              <div className={styles.saleIdentity}>
                <strong>#{order.number}</strong>
                <small>{formatDateTime(order.date)}</small>
              </div>
              <div className={styles.saleDescription}>
                <strong>{order.customer}</strong>
                <small>{order.productName}{order.productCount > 1 ? ` +${order.productCount - 1}` : ""}</small>
              </div>
              <div className={styles.saleValue}>
                <strong>{formatCurrency(order.total)}</strong>
                <small>lucro {formatCurrency(order.profit)}</small>
              </div>
              <Tag color={statusColor(order.status)}>{statusLabel(order.status)}</Tag>
            </article>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma venda registrada" />}
    </section>
  );
}

export function TvRecentQuestions({ questions }: { questions: TvQuestionSummary[] }) {
  return (
    <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby="tv-questions-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Atendimento</span>
          <h2 id="tv-questions-title">Perguntas</h2>
        </div>
        <span className={styles.panelHint}>últimas {Math.min(3, questions.length)}</span>
      </header>
      {questions.length ? (
        <div className={styles.questionList}>
          {questions.slice(0, 3).map((question) => (
            <article className={styles.questionRow} key={question.id}>
              <div>
                <strong>{question.anuncio}</strong>
                <small>{formatDateTime(question.date)}</small>
              </div>
              <Text ellipsis={{ tooltip: question.pergunta }}>{question.pergunta}</Text>
            </article>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma pergunta recente" />}
    </section>
  );
}

export function TvChannelFooter({ ads }: { ads: TvMetrics["ads"] }) {
  return (
    <footer className={styles.channelFooter} aria-label="Saúde dos anúncios">
      <span>Anúncios <strong>{ads.total}</strong></span>
      <span>Ativos <strong className={styles.positive}>{ads.active}</strong></span>
      <span>Pausados <strong className={styles.warning}>{ads.paused}</strong></span>
      <span>Catálogo ativo <strong>{ads.activeCatalog}</strong></span>
      <span>Ganhando catálogo <strong className={styles.positive}>{ads.winningCatalog}</strong></span>
    </footer>
  );
}

export function TvCelebrations({
  sale,
  question,
}: {
  sale: { id: number; orderNumber: number; customer: string; total: number } | null;
  question: (TvQuestionSummary & { celebrationId: number }) | null;
}) {
  return (
    <>
      {sale ? (
        <div className={styles.celebration} key={sale.id} role="status" aria-live="polite">
          <i className={`${styles.confetti} ${styles.confettiOne}`} />
          <i className={`${styles.confetti} ${styles.confettiTwo}`} />
          <i className={`${styles.confetti} ${styles.confettiThree}`} />
          <div className={styles.celebrationCard}>
            <span>Nova venda</span>
            <h2>VOCÊ VENDEU!</h2>
            <p>Pedido #{sale.orderNumber} · {sale.customer}</p>
            <strong>{formatCurrency(sale.total)}</strong>
          </div>
        </div>
      ) : null}
      {question ? (
        <div className={styles.celebration} key={question.celebrationId} role="status" aria-live="polite">
          <div className={`${styles.celebrationCard} ${styles.questionCelebration}`}>
            <span>Atendimento</span>
            <h2>NOVA PERGUNTA</h2>
            <p>{question.anuncio}</p>
            <strong>{question.pergunta}</strong>
          </div>
        </div>
      ) : null}
    </>
  );
}
