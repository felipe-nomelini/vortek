import { NextResponse } from "next/server";
import { fetchMLResult, getMLConnectionStatus } from "@/services/integration";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const desconectado = {
  reclamacoes: null,
  atrasos: null,
  cancelamentos: null,
  positivas: null,
  nivel: "Desconectado",
  nivelCor: "#888",
  nivelKey: "",
  conectado: false,
  precisaReconectar: true,
};

const levelMap: Record<
  string,
  { color: string; label: string; shortKey: string }
> = {
  "5_green": { color: "#52c41a", label: "Verde", shortKey: "green" },
  "4_light_green": {
    color: "#73d13d",
    label: "Verde claro",
    shortKey: "light_green",
  },
  "4_light_blue": {
    color: "#73d13d",
    label: "Verde claro",
    shortKey: "light_green",
  },
  "3_yellow": { color: "#faad14", label: "Amarelo", shortKey: "yellow" },
  "2_orange": { color: "#fa8c16", label: "Laranja", shortKey: "orange" },
  "1_red": { color: "#ff4d4f", label: "Vermelho", shortKey: "red" },
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : parsed * 100;
}

function metric(raw: any) {
  return {
    rate: toNumber(raw?.rate),
    percent: percent(raw?.rate),
    value: toNumber(raw?.value),
    period: raw?.period || null,
    excluded: toNumber(raw?.excluded?.real_value ?? raw?.excluded?.value),
  };
}

function powerSellerLabel(status: string | null) {
  if (status === "silver") return "Mercado Líder";
  if (status === "gold") return "Mercado Líder Gold";
  if (status === "platinum") return "Mercado Líder Platinum";
  return null;
}

function monthsAgoIso(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

async function orderSearchTotal(
  sellerId: number | string,
  params: Record<string, string>,
): Promise<number | null> {
  const search = new URLSearchParams({
    seller: String(sellerId),
    limit: "1",
    sort: "date_desc",
    ...params,
  });
  const result = await fetchMLResult<any>(
    `/orders/search?${search.toString()}`,
  );
  return result.ok ? toNumber(result.data?.paging?.total) : null;
}

export async function GET() {
  try {
    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return NextResponse.json(desconectado);
    }

    const meResult = await fetchMLResult<any>("/users/me");
    const me = meResult.ok ? meResult.data : null;
    if (!me?.id) {
      return NextResponse.json({
        ...desconectado,
        conectado: true,
        precisaReconectar: false,
        indisponivel: true,
      });
    }

    const userResult = me?.seller_reputation
      ? { ok: true, data: me }
      : await fetchMLResult<any>(`/users/${me.id}`);
    const user = userResult.ok ? userResult.data : null;
    if (!user?.seller_reputation) {
      return NextResponse.json({
        ...desconectado,
        conectado: true,
        precisaReconectar: false,
        indisponivel: true,
      });
    }

    const sr = user.seller_reputation || {};
    const metrics = sr.metrics || {};
    const transactions = sr.transactions || {};
    const ratings = transactions.ratings || {};
    const levelId = sr.level_id || "";
    const level = levelMap[levelId];
    const powerStatus = sr.power_seller_status || null;
    const claims = metric(metrics.claims);
    const delayedHandling = metric(metrics.delayed_handling_time);
    const cancellations = metric(metrics.cancellations);
    const sixMonthsFrom = monthsAgoIso(6);
    const twelveMonthsFrom = monthsAgoIso(12);

    const [
      sold6m,
      sold12m,
      canceled6m,
      canceled12m,
      positive6m,
      positive12m,
      neutral6m,
      neutral12m,
      negative6m,
      negative12m,
    ] = await Promise.all([
      orderSearchTotal(me.id, {
        "order.date_created.from": sixMonthsFrom,
        "order.status": "paid,confirmed",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": twelveMonthsFrom,
        "order.status": "paid,confirmed",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": sixMonthsFrom,
        "order.status": "cancelled",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": twelveMonthsFrom,
        "order.status": "cancelled",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": sixMonthsFrom,
        "feedback.sale.rating": "positive",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": twelveMonthsFrom,
        "feedback.sale.rating": "positive",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": sixMonthsFrom,
        "feedback.sale.rating": "neutral",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": twelveMonthsFrom,
        "feedback.sale.rating": "neutral",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": sixMonthsFrom,
        "feedback.sale.rating": "negative",
      }),
      orderSearchTotal(me.id, {
        "order.date_created.from": twelveMonthsFrom,
        "feedback.sale.rating": "negative",
      }),
    ]);

    const feedbackTotal12m = [positive12m, neutral12m, negative12m].every(
      (value) => value !== null,
    )
      ? Number(positive12m) + Number(neutral12m) + Number(negative12m)
      : null;
    const positiveFeedbackPercent =
      feedbackTotal12m && positive12m !== null
        ? (positive12m / feedbackTotal12m) * 100
        : null;
    const powerLabel = powerSellerLabel(powerStatus);
    const nivelLabel = powerLabel || level?.label || "Sem reputação";
    const salesCompleted = toNumber(
      metrics.sales?.completed ?? metrics.sales_completed,
    );
    return NextResponse.json({
      conectado: true,
      precisaReconectar: false,
      indisponivel: false,
      user: {
        id: user.id,
        nickname: user.nickname || null,
        permalink: user.permalink || null,
        registration_date: user.registration_date || null,
        site_id: user.site_id || null,
        tags: Array.isArray(user.tags) ? user.tags : [],
      },
      seller_reputation: {
        level_id: levelId,
        power_seller_status: powerStatus,
        real_level: sr.real_level || null,
        protection_end_date: sr.protection_end_date || null,
      },
      transactions: {
        total: toNumber(transactions.total) || 0,
        completed: toNumber(transactions.completed) || 0,
        canceled: toNumber(transactions.canceled) || 0,
        period: transactions.period || null,
        ratings: {
          positive: toNumber(ratings.positive),
          neutral: toNumber(ratings.neutral),
          negative: toNumber(ratings.negative),
        },
      },
      metrics: {
        claims,
        delayed_handling_time: delayedHandling,
        cancellations,
        sales_completed: salesCompleted,
        period:
          metrics.sales?.period ||
          claims.period ||
          delayedHandling.period ||
          cancellations.period ||
          null,
      },
      orders_summary: {
        six_months: {
          sold: sold6m,
          canceled: canceled6m,
          feedback: {
            positive: positive6m,
            neutral: neutral6m,
            negative: negative6m,
          },
        },
        twelve_months: {
          sold: sold12m,
          canceled: canceled12m,
          feedback: {
            positive: positive12m,
            neutral: neutral12m,
            negative: negative12m,
          },
        },
      },
      feedback: {
        source: "orders/search feedback.sale.rating",
        period: "12 meses",
        positive: positive12m,
        neutral: neutral12m,
        negative: negative12m,
        total: feedbackTotal12m,
        positive_percent: positiveFeedbackPercent,
      },
      reclamacoes: claims.percent,
      atrasos: delayedHandling.percent,
      cancelamentos: cancellations.percent,
      positivas: positiveFeedbackPercent,
      nivel: nivelLabel,
      nivelCor: level?.color || "#888",
      nivelKey: level?.shortKey || "",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ...desconectado,
        erro: error?.message || "Falha ao carregar reputação",
      },
      { status: 500 },
    );
  }
}
