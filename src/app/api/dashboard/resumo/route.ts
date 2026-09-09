import { type DashboardPreset, type OrderRow, round2, normalizeStatus, periodBounds, summarize, loadRowsInRange } from '@/services/dashboard-read-model';
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import {
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
  matchesOrdersOperationalView,
} from "@/lib/orders/operational-view";
import { enrichOrdersWithWhatsappStatus } from "@/services/order-operational-status";
import {
  saoPauloDayLabel,
  saoPauloHour,
} from "@/lib/timezone";
import { loadOperationRuntimeConfiguration } from "@/services/operation-configuration";

type MetricKey = "revenue" | "profit" | "orders";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPERATIONAL_STATUSES = [
  ...PREPARATION_ORDER_STATUSES,
  ...SHIPPING_ORDER_STATUSES,
] as const;

function orderDate(row: OrderRow): string | null {
  return row.data_venda || row.data || null;
}

function parsePreset(value: string | null): DashboardPreset {
  if (value === "today" || value === "30d") return value;
  return "7d";
}

function dateIso(date: Date): string {
  return date.toISOString();
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function metricValue(row: OrderRow, metric: MetricKey): number {
  if (normalizeStatus(row.situacao) === "cancelado") return 0;
  if (metric === "orders") return 1;
  if (metric === "profit") {
    return row.operational_profit_pending || row.operational_lucro === null
      ? 0
      : Number(row.operational_lucro || 0);
  }
  return Number(row.operational_total || 0);
}

function buildTimeline(params: {
  preset: DashboardPreset;
  days: number;
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  currentRows: OrderRow[];
  previousRows: OrderRow[];
}) {
  const isToday = params.preset === "today";
  const bucketCount = isToday
    ? Math.max(1, (saoPauloHour(params.currentEnd) ?? 0) + 1)
    : params.days;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const currentDate = new Date(
      params.currentStart.getTime() + index * (isToday ? 60 * 60 * 1000 : DAY_MS),
    );
    return {
      label: isToday
        ? `${String(index).padStart(2, "0")}h`
        : saoPauloDayLabel(currentDate) || "—",
      current: { revenue: 0, profit: 0, orders: 0 },
      previous: { revenue: 0, profit: 0, orders: 0 },
    };
  });

  function accumulate(rows: OrderRow[], start: Date, side: "current" | "previous") {
    for (const row of rows) {
      const rawDate = orderDate(row);
      if (!rawDate) continue;
      const timestamp = new Date(rawDate).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const unit = isToday ? 60 * 60 * 1000 : DAY_MS;
      const index = Math.floor((timestamp - start.getTime()) / unit);
      if (index < 0 || index >= buckets.length) continue;
      for (const metric of ["revenue", "profit", "orders"] as const) {
        buckets[index][side][metric] += metricValue(row, metric);
      }
    }
  }

  accumulate(params.currentRows, params.currentStart, "current");
  accumulate(params.previousRows, params.previousStart, "previous");

  return buckets.map((bucket) => ({
    label: bucket.label,
    current: {
      revenue: round2(bucket.current.revenue),
      profit: round2(bucket.current.profit),
      orders: bucket.current.orders,
    },
    previous: {
      revenue: round2(bucket.previous.revenue),
      profit: round2(bucket.previous.profit),
      orders: bucket.previous.orders,
    },
  }));
}

async function loadOperationalRows(
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<{ data: OrderRow[]; error: { message?: string } | null }> {
  const rows: OrderRow[] = [];
  const pageSize = 500;
  const columns = [
    "id",
    "data",
    "data_venda",
    "situacao",
    "operational_pedido_ids",
    "dslite_id",
    "dslite_status",
    "dslite_etiqueta_enviada",
    "dslite_label_source",
    "envio_interno_at",
    "ml_fiscal_release_at",
    "ml_claim_id",
    "nota_fiscal_emitida",
    "nfe_status",
    "ml_label_storage_path",
    "ml_thermal_label_storage_path",
  ].join(",");

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await (serviceClient as any)
      .from("pedidos_operacionais")
      .select(columns)
      .in("situacao", [...OPERATIONAL_STATUSES])
      .order("data", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...((data || []) as OrderRow[]));
    if ((data || []).length < pageSize) return { data: rows, error: null };
  }
}

async function loadTopProducts(
  serviceClient: ReturnType<typeof createServiceClient>,
  currentRows: OrderRow[],
) {
  const rawOrderIds = Array.from(
    new Set(
      currentRows
        .filter((row) => normalizeStatus(row.situacao) !== "cancelado")
        .flatMap((row) => row.operational_pedido_ids || [row.id])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
  if (!rawOrderIds.length) return [];

  const items: Array<{
    ml_item_id?: string | null;
    seller_sku?: string | null;
    titulo?: string | null;
    quantidade?: number | null;
    valor_total_liquido?: number | null;
  }> = [];

  for (let index = 0; index < rawOrderIds.length; index += 100) {
    const { data, error } = await serviceClient
      .from("pedido_itens")
      .select("ml_item_id,seller_sku,titulo,quantidade,valor_total_liquido")
      .in("pedido_id", rawOrderIds.slice(index, index + 100));
    if (error) throw error;
    items.push(...(data || []));
  }

  const products = new Map<
    string,
    { name: string; sku: string | null; units: number; revenue: number }
  >();
  for (const item of items) {
    const sku = String(item.seller_sku || "").trim() || null;
    const name = String(item.titulo || "Produto sem título").trim();
    const key = String(item.ml_item_id || sku || name).trim();
    const current = products.get(key) || { name, sku, units: 0, revenue: 0 };
    current.units += Number(item.quantidade || 0);
    current.revenue += Number(item.valor_total_liquido || 0);
    products.set(key, current);
  }

  return Array.from(products.entries())
    .map(([id, product]) => ({
      id,
      name: product.name,
      sku: product.sku,
      units: product.units,
      revenue: round2(product.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    .slice(0, 6);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  const preset = parsePreset(new URL(request.url).searchParams.get("preset"));
  const now = new Date();
  const bounds = periodBounds(preset, now);
  const serviceClient = createServiceClient();

  const [currentResult, previousResult, operationalResult, operationConfiguration] = await Promise.all([
    loadRowsInRange(serviceClient, bounds.currentStart, bounds.currentEnd),
    loadRowsInRange(serviceClient, bounds.previousStart, bounds.previousEnd),
    loadOperationalRows(serviceClient),
    loadOperationRuntimeConfiguration(serviceClient),
  ]);

  const queryError =
    currentResult.error || previousResult.error || operationalResult.error;
  if (queryError) {
    return NextResponse.json(
      { erro: queryError.message || "Falha ao carregar o dashboard" },
      { status: 500 },
    );
  }

  const current = summarize(currentResult.data);
  const previous = summarize(previousResult.data);
  const enrichedOperational = await enrichOrdersWithWhatsappStatus(
    operationalResult.data,
    serviceClient,
  );

  let topProducts;
  try {
    topProducts = await loadTopProducts(serviceClient, currentResult.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao agregar produtos";
    return NextResponse.json({ erro: message }, { status: 500 });
  }

  const preparation = enrichedOperational.filter((row) =>
    matchesOrdersOperationalView(row, "preparation", operationConfiguration.delayedAfterMinutes),
  ).length;
  const shipping = enrichedOperational.filter((row) =>
    matchesOrdersOperationalView(row, "shipping", operationConfiguration.delayedAfterMinutes),
  ).length;
  const urgent = enrichedOperational.filter((row) =>
    matchesOrdersOperationalView(row, "urgent", operationConfiguration.delayedAfterMinutes),
  ).length;
  const delivered = currentResult.data.filter(
    (row) => normalizeStatus(row.situacao) === "entregue",
  ).length;

  const dailyProfitGoal = Number(process.env.TV_DAILY_PROFIT_GOAL || 1500);
  const target = round2(
    (Number.isFinite(dailyProfitGoal) && dailyProfitGoal > 0
      ? dailyProfitGoal
      : 1500) * bounds.days,
  );
  const remaining = round2(Math.max(0, target - current.profit));
  const estimatedOrdersRemaining =
    remaining > 0 && current.averageKnownProfit && current.averageKnownProfit > 0
      ? Math.ceil(remaining / current.averageKnownProfit)
      : null;

  const recentOrders = [...currentResult.data]
    .sort((a, b) => String(orderDate(b) || "").localeCompare(String(orderDate(a) || "")))
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      number: row.numero,
      customer: row.contato_nome || "Cliente não informado",
      total: round2(Number(row.operational_total || 0)),
      profit:
        row.operational_profit_pending || row.operational_lucro === null
          ? null
          : round2(Number(row.operational_lucro || 0)),
      status: normalizeStatus(row.situacao),
      date: orderDate(row),
    }));

  return NextResponse.json({
    generatedAt: now.toISOString(),
    period: {
      preset,
      days: bounds.days,
      currentFrom: dateIso(bounds.currentStart),
      currentTo: dateIso(bounds.currentEnd),
      previousFrom: dateIso(bounds.previousStart),
      previousTo: dateIso(bounds.previousEnd),
    },
    performance: {
      current,
      previous,
      deltas: {
        revenue: percentChange(current.revenue, previous.revenue),
        profit: percentChange(current.profit, previous.profit),
        orders: percentChange(current.orders, previous.orders),
        averageTicket: percentChange(current.averageTicket, previous.averageTicket),
        marginPoints: round2(current.margin - previous.margin),
      },
    },
    profitGoal: {
      target,
      actual: current.profit,
      percentage: target > 0 ? round2((current.profit / target) * 100) : 0,
      remaining,
      estimatedOrdersRemaining,
    },
    timeline: buildTimeline({
      preset,
      days: bounds.days,
      currentStart: bounds.currentStart,
      currentEnd: bounds.currentEnd,
      previousStart: bounds.previousStart,
      currentRows: currentResult.data,
      previousRows: previousResult.data,
    }),
    operation: { urgent, preparation, shipping, delivered },
    topProducts,
    recentOrders,
  });
}
