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
  const statusCounts: Record<string, number> = {};

  for (const row of rows) {
    revenue += Number(row.total || 0);
    profit += Number(row.lucro || 0);
    const status = normalizeStatus(row.situacao);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    orders: rows.length,
    revenue: round2(revenue),
    profit: round2(profit),
    averageTicket: rows.length > 0 ? round2(revenue / rows.length) : 0,
    statusCounts,
  };
}

function hourlySales(rows: any[]) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}h`,
    revenue: 0,
    orders: 0,
  }));
  for (const row of rows) {
    const hour = saoPauloHour(row.data || row.created_at || row.updated_at);
    if (hour === null) continue;
    const bucket = buckets[hour];
    bucket.revenue = round2(bucket.revenue + Number(row.total || 0));
    bucket.orders += 1;
  }
  return buckets;
}

function actionLabel(status: string): string {
  const raw = normalizeStatus(status);
  const map: Record<string, string> = {
    aberto: "Separar pedido",
    pendente: "Resolver pendência",
    preparando: "Preparando",
    pronto_envio: "Pronto para envio",
    etiqueta_impressa: "Etiqueta impressa",
    faturado: "Faturado",
    atendido: "Atendido",
  };
  return map[raw] || raw;
}

type ProjectionMetric = {
  orders: number;
  revenue: number;
  profit: number;
};

function saoPauloDateParts(date: Date) {
  const offsetMs = -180 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

function buildProjection(params: {
  now: Date;
  month: ProjectionMetric;
  historical: ProjectionMetric;
  historicalDays: number;
}) {
  const parts = saoPauloDateParts(params.now);
  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month + 1, 0),
  ).getUTCDate();
  const daysInNextMonth = new Date(
    Date.UTC(parts.year, parts.month + 2, 0),
  ).getUTCDate();
  const dayProgress = Math.max(
    1 / 24,
    (parts.hour + parts.minute / 60 + parts.second / 3600) / 24,
  );
  const elapsedDays = Math.min(daysInMonth, parts.day - 1 + dayProgress);
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);
  const currentWeight = elapsedDays >= 3 ? 0.7 : 0.45;
  const historyWeight = 1 - currentWeight;

  const pace = {
    orders: round2(
      (params.month.orders / Math.max(1, elapsedDays)) * currentWeight +
        (params.historical.orders / Math.max(1, params.historicalDays)) *
          historyWeight,
    ),
    revenue: round2(
      (params.month.revenue / Math.max(1, elapsedDays)) * currentWeight +
        (params.historical.revenue / Math.max(1, params.historicalDays)) *
          historyWeight,
    ),
    profit: round2(
      (params.month.profit / Math.max(1, elapsedDays)) * currentWeight +
        (params.historical.profit / Math.max(1, params.historicalDays)) *
          historyWeight,
    ),
  };

  return {
    basis: {
      historicalDays: params.historicalDays,
      elapsedDays: round2(elapsedDays),
      remainingDays: round2(remainingDays),
      daysInMonth,
      daysInNextMonth,
      dailyPace: pace,
    },
    currentMonth: {
      orders: Math.round(params.month.orders + pace.orders * remainingDays),
      revenue: round2(params.month.revenue + pace.revenue * remainingDays),
      profit: round2(params.month.profit + pace.profit * remainingDays),
    },
    nextMonth: {
      orders: Math.round(pace.orders * daysInNextMonth),
      revenue: round2(pace.revenue * daysInNextMonth),
      profit: round2(pace.profit * daysInNextMonth),
    },
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

  const service = createServiceClient();
  const now = new Date();
  const { start: todayStart, end: todayEnd } = saoPauloDayBounds(now);
  const { start: yesterdayStart, end: yesterdayEnd } = saoPauloDayBounds(
    new Date(todayStart.getTime() - 1),
  );
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const historicalStart = new Date(
    todayStart.getTime() - 29 * 24 * 60 * 60 * 1000,
  );
  const { start: weekStart, end: weekEnd } = saoPauloPeriodBounds(now, "week");
  const { start: monthStart, end: monthEnd } = saoPauloPeriodBounds(
    now,
    "month",
  );

  const [
    todayResult,
    yesterdayResult,
    lastHourResult,
    weekResult,
    monthResult,
    recentResult,
    actionResult,
    activeAdsResult,
    productsResult,
    claimsResult,
    visitsResult,
    topProductsResult,
    adsStatsResult,
    catalogWinningResult,
    historicalResult,
  ] = await Promise.all([
    service
      .from("pedidos")
      .select(
        "id,numero,contato_nome,total,lucro,situacao,data,created_at,updated_at",
      )
      .gte("data", toIso(todayStart))
      .lte("data", toIso(todayEnd))
      .order("data", { ascending: true }),
    service
      .from("pedidos")
      .select("id,total,lucro,situacao,data")
      .gte("data", toIso(yesterdayStart))
      .lte("data", toIso(yesterdayEnd)),
    service
      .from("pedidos")
      .select("id,total,lucro,situacao,data")
      .gte("data", toIso(oneHourAgo))
      .lte("data", toIso(now)),
    service
      .from("pedidos")
      .select("id,total,lucro,situacao,data")
      .gte("data", toIso(weekStart))
      .lte("data", toIso(weekEnd)),
    service
      .from("pedidos")
      .select("id,total,lucro,situacao,data")
      .gte("data", toIso(monthStart))
      .lte("data", toIso(monthEnd)),
    service
      .from("pedidos")
      .select(
        "id,numero,contato_nome,total,lucro,situacao,data,ml_order_id,pedido_itens(titulo,quantidade)",
      )
      .order("data", { ascending: false })
      .limit(5),
    service
      .from("pedidos")
      .select(
        "id,numero,contato_nome,total,situacao,data,nota_fiscal_emitida,dslite_etiqueta_enviada",
      )
      .in("situacao", [
        "aberto",
        "pendente",
        "preparando",
        "pronto_envio",
        "etiqueta_impressa",
        "faturado",
      ])
      .order("data", { ascending: false })
      .limit(12),
    service
      .from("anuncios_ml")
      .select("*", { count: "exact", head: true })
      .eq("status", "ativo"),
    service
      .from("produtos")
      .select("*", { count: "exact", head: true })
      .eq("ml_status", "ativo"),
    service
      .from("pedidos")
      .select("*", { count: "exact", head: true })
      .not("ml_claim_id", "is", null)
      .or("ml_claim_status.is.null,ml_claim_status.neq.closed"),
    service.from("anuncios_ml").select("visitas,vendidos,preco_ml"),
    service
      .from("anuncios_ml")
      .select(
        "ml_item_id,titulo,sku,visitas,vendidos,preco_ml,thumbnail,permalink",
      )
      .order("vendidos", { ascending: false })
      .limit(8),
    service.from("anuncios_ml").select("status,catalogo"),
    service
      .from("catalogo_ml_snapshot")
      .select("*", { count: "exact", head: true })
      .eq("catalog_listing", true)
      .eq("status", "active")
      .eq("buy_box_winning", true),
    service
      .from("pedidos")
      .select("id,total,lucro,situacao,data")
      .gte("data", toIso(historicalStart))
      .lte("data", toIso(now)),
  ]);

  if (todayResult.error)
    return NextResponse.json(
      { erro: todayResult.error.message },
      { status: 500 },
    );
  if (yesterdayResult.error)
    return NextResponse.json(
      { erro: yesterdayResult.error.message },
      { status: 500 },
    );

  const todayRows = todayResult.data || [];
  const yesterdayRows = yesterdayResult.data || [];
  const lastHourRows = lastHourResult.data || [];
  const weekRows = weekResult.data || [];
  const monthRows = monthResult.data || [];
  const historicalRows = historicalResult.data || [];
  const today = summarizeOrders(todayRows);
  const yesterdaySummary = summarizeOrders(yesterdayRows);
  const lastHour = summarizeOrders(lastHourRows);
  const week = summarizeOrders(weekRows);
  const month = summarizeOrders(monthRows);
  const historical = summarizeOrders(historicalRows);
  const projection = buildProjection({
    now,
    month,
    historical,
    historicalDays: 30,
  });

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
      date: row.data,
      mlOrderId: row.ml_order_id || null,
    };
  });

  const actionQueue = (actionResult.data || []).map((row: any) => ({
    id: row.id,
    number: row.numero,
    customer: row.contato_nome || "Cliente ML",
    total: round2(row.total || 0),
    status: normalizeStatus(row.situacao),
    action: actionLabel(row.situacao),
    needsInvoice: row.nota_fiscal_emitida === false,
    needsLabel: row.dslite_etiqueta_enviada === false,
    date: row.data,
  }));

  let totalVisits = 0;
  let totalSold = 0;
  let catalogRevenue = 0;
  for (const row of visitsResult.data || []) {
    totalVisits += Number(row.visitas || 0);
    totalSold += Number(row.vendidos || 0);
    catalogRevenue += Number(row.vendidos || 0) * Number(row.preco_ml || 0);
  }

  const topProducts = (topProductsResult.data || []).map(
    (row: any, index: number) => ({
      rank: index + 1,
      mlItemId: row.ml_item_id,
      title: row.titulo || "Produto",
      sku: row.sku || null,
      visits: Number(row.visitas || 0),
      sold: Number(row.vendidos || 0),
      revenue: round2(Number(row.vendidos || 0) * Number(row.preco_ml || 0)),
      thumbnail: row.thumbnail || null,
      permalink: row.permalink || null,
    }),
  );

  let adsTotal = 0;
  let adsActive = 0;
  let adsPaused = 0;
  let activeCatalog = 0;
  for (const row of adsStatsResult.data || []) {
    adsTotal++;
    const status = String(row.status || "").toLowerCase();
    const isActive = status === "ativo";
    if (isActive) adsActive++;
    if (status === "pausado") adsPaused++;
    if (isActive && row.catalogo === true) activeCatalog++;
  }

  const goal = Number(process.env.TV_DAILY_REVENUE_GOAL || 7500);
  const goalProgress =
    goal > 0 ? Math.min(999, round2((today.revenue / goal) * 100)) : 0;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    realtimeSources: {
      orders: "Supabase Postgres Changes + polling 15s",
      visitors:
        "ML não expõe visitantes instantâneos; exibindo visitas sincronizadas dos anúncios e painéis online via Presence.",
    },
    today,
    week,
    month,
    yesterday: yesterdaySummary,
    lastHour,
    trends: {
      revenueVsYesterday: percentChange(
        today.revenue,
        yesterdaySummary.revenue,
      ),
      ordersVsYesterday: percentChange(today.orders, yesterdaySummary.orders),
      profitVsYesterday: percentChange(today.profit, yesterdaySummary.profit),
    },
    goal: {
      revenue: goal,
      progress: goalProgress,
      remaining: round2(Math.max(0, goal - today.revenue)),
    },
    operations: {
      activeAds: activeAdsResult.count || 0,
      activeProducts: productsResult.count || 0,
      openClaims: claimsResult.count || 0,
      actionQueueCount: actionQueue.length,
    },
    marketplace: {
      totalVisits,
      totalSold,
      estimatedListingRevenue: round2(catalogRevenue),
    },
    hourlySales: hourlySales(todayRows),
    recentOrders,
    projection,
    ads: {
      total: adsTotal,
      active: adsActive,
      paused: adsPaused,
      activeCatalog,
      winningCatalog: catalogWinningResult.count || 0,
    },
    actionQueue,
    topProducts,
  });
}
