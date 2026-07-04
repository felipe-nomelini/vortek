import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
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
    const date = new Date(row.data || row.created_at || row.updated_at);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = buckets[date.getHours()];
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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

  const service = createServiceClient();
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterday = new Date(todayStart);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = startOfDay(yesterday);
  const yesterdayEnd = endOfDay(yesterday);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    todayResult,
    yesterdayResult,
    lastHourResult,
    recentResult,
    actionResult,
    activeAdsResult,
    productsResult,
    claimsResult,
    visitsResult,
    topProductsResult,
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
      .select("id,numero,contato_nome,total,lucro,situacao,data,ml_order_id")
      .order("data", { ascending: false })
      .limit(8),
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
  const today = summarizeOrders(todayRows);
  const yesterdaySummary = summarizeOrders(yesterdayRows);
  const lastHour = summarizeOrders(lastHourRows);

  const recentOrders = (recentResult.data || []).map((row: any) => ({
    id: row.id,
    number: row.numero,
    customer: row.contato_nome || "Cliente ML",
    total: round2(row.total || 0),
    profit: round2(row.lucro || 0),
    status: normalizeStatus(row.situacao),
    date: row.data,
    mlOrderId: row.ml_order_id || null,
  }));

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

  const goal = Number(process.env.TV_DAILY_REVENUE_GOAL || 5000);
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
    actionQueue,
    topProducts,
  });
}
