import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { saoPauloDayBounds, saoPauloHour } from "@/lib/timezone";

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function percentChange(current: number, previous: number): number {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return round2(((current - previous) / previous) * 100);
}

function normalizeStatus(value: unknown): string {
  return String(value || "aberto").trim() || "aberto";
}

function isCancelledStatus(value: unknown): boolean {
  return normalizeStatus(value) === "cancelado";
}

function isMissingSaleDateColumnError(
  error:
    | {
        code?: string;
        message?: string;
      }
    | null
    | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

function orderDateValue(row: any): string | null {
  return row?.data_venda || row?.data || null;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function saoPauloPeriodBounds(date: Date, period: "week" | "month") {
  const offsetMs = -180 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const weekday = local.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const startLocal =
    period === "month"
      ? new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month, day - mondayOffset, 0, 0, 0, 0));
  const endLocal =
    period === "month"
      ? new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      : new Date(
          Date.UTC(year, month, day - mondayOffset + 6, 23, 59, 59, 999),
        );
  return {
    start: new Date(startLocal.getTime() - offsetMs),
    end: new Date(endLocal.getTime() - offsetMs),
  };
}

function summarizeOrders(rows: any[]) {
  let revenue = 0;
  let profit = 0;
  let salesCount = 0;
  const statusCounts: Record<string, number> = {};

  for (const row of rows) {
    const status = normalizeStatus(row.situacao);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (isCancelledStatus(status)) continue;
    revenue += Number(row.total || 0);
    profit += Number(row.lucro || 0);
    salesCount += 1;
  }

  return {
    orders: salesCount,
    revenue: round2(revenue),
    profit: round2(profit),
    averageTicket: salesCount > 0 ? round2(revenue / salesCount) : 0,
    statusCounts,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();
  const { start: todayStart, end: todayEnd } = saoPauloDayBounds(now);
  const { start: yesterdayStart, end: yesterdayEnd } = saoPauloDayBounds(
    new Date(todayStart.getTime() - 1),
  );
  const { start: weekStart, end: weekEnd } = saoPauloPeriodBounds(now, "week");
  const { start: monthStart, end: monthEnd } = saoPauloPeriodBounds(
    now,
    "month",
  );

  async function runLiveQueries(useSaleDate: boolean) {
    const dateColumn = useSaleDate ? "data_venda" : "data";
    const fullDateSelect = useSaleDate ? "data_venda,data" : "data";

    return Promise.all([
      service
        .from("pedidos")
        .select(`id,total,lucro,situacao,${fullDateSelect}`)
        .gte(dateColumn, toIso(todayStart))
        .lte(dateColumn, toIso(todayEnd))
        .order(dateColumn, { ascending: true }),
      service
        .from("pedidos")
        .select(`id,total,lucro,situacao,${fullDateSelect}`)
        .gte(dateColumn, toIso(yesterdayStart))
        .lte(dateColumn, toIso(yesterdayEnd)),
      service
        .from("pedidos")
        .select(`id,total,lucro,situacao,${fullDateSelect}`)
        .gte(dateColumn, toIso(weekStart))
        .lte(dateColumn, toIso(weekEnd)),
      service
        .from("pedidos")
        .select(`id,total,lucro,situacao,${fullDateSelect}`)
        .gte(dateColumn, toIso(monthStart))
        .lte(dateColumn, toIso(monthEnd)),
      service
        .from("pedidos")
        .select(
          `id,numero,contato_nome,total,lucro,situacao,${fullDateSelect},ml_order_id,pedido_itens(titulo,quantidade)`,
        )
        .order(dateColumn, { ascending: false })
        .limit(5),
    ]);
  }

  let [todayResult, yesterdayResult, weekResult, monthResult, recentResult] =
    await runLiveQueries(true);

  const missingSaleDateColumn = [
    todayResult,
    yesterdayResult,
    weekResult,
    monthResult,
    recentResult,
  ].some((result) => isMissingSaleDateColumnError(result.error));

  if (missingSaleDateColumn) {
    [todayResult, yesterdayResult, weekResult, monthResult, recentResult] =
      await runLiveQueries(false);
  }

  if (todayResult.error) {
    return NextResponse.json({ erro: todayResult.error.message }, { status: 500 });
  }
  if (yesterdayResult.error) {
    return NextResponse.json(
      { erro: yesterdayResult.error.message },
      { status: 500 },
    );
  }
  if (weekResult.error) {
    return NextResponse.json({ erro: weekResult.error.message }, { status: 500 });
  }
  if (monthResult.error) {
    return NextResponse.json({ erro: monthResult.error.message }, { status: 500 });
  }
  if (recentResult.error) {
    return NextResponse.json({ erro: recentResult.error.message }, { status: 500 });
  }

  const todayRows = todayResult.data || [];
  const yesterdayRows = yesterdayResult.data || [];
  const weekRows = weekResult.data || [];
  const monthRows = monthResult.data || [];

  const today = summarizeOrders(todayRows);
  const yesterdaySummary = summarizeOrders(yesterdayRows);
  const week = summarizeOrders(weekRows);
  const month = summarizeOrders(monthRows);

  const recentOrders = (recentResult.data || []).map((row: any) => {
    const items = Array.isArray(row.pedido_itens) ? row.pedido_itens : [];
    const firstItem = items[0];
    const firstTitle = String(firstItem?.titulo || "").trim();
    return {
      id: row.id,
      number: row.numero,
      customer: row.contato_nome || "Cliente ML",
      productName: firstTitle || "Produto não informado",
      productCount: items.length,
      total: round2(row.total || 0),
      profit: round2(row.lucro || 0),
      status: normalizeStatus(row.situacao),
      date: orderDateValue(row),
      mlOrderId: row.ml_order_id || null,
    };
  });

  return NextResponse.json({
    generatedAt: now.toISOString(),
    refreshIntervalMs: 1000,
    today,
    week,
    month,
    trends: {
      revenueVsYesterday: percentChange(today.revenue, yesterdaySummary.revenue),
      ordersVsYesterday: percentChange(today.orders, yesterdaySummary.orders),
      profitVsYesterday: percentChange(today.profit, yesterdaySummary.profit),
    },
    recentOrders,
  });
}
