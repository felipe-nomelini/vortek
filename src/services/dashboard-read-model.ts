import 'server-only';
import type { createServiceClient } from '@/lib/supabase';
import { saoPauloDayBounds } from '@/lib/timezone';
const DAY_MS = 24 * 60 * 60 * 1000;
function dateIso(date: Date) { return date.toISOString(); }

export type DashboardPreset = "today" | "7d" | "30d";

export type OrderRow = {
  snapshot_source?: string | null;
  id?: string | null;
  numero?: number | null;
  contato_nome?: string | null;
  data?: string | null;
  data_venda?: string | null;
  situacao?: string | null;
  operational_total?: number | null;
  operational_lucro?: number | null;
  operational_profit_pending?: boolean | null;
  operational_pedido_ids?: string[] | null;
  dslite_id?: string | null;
  dslite_status?: string | null;
  dslite_etiqueta_enviada?: boolean | null;
  dslite_label_source?: string | null;
  envio_interno_at?: string | null;
  ml_fiscal_release_at?: string | null;
  ml_claim_id?: string | null;
  nota_fiscal_emitida?: boolean | null;
  nfe_status?: string | null;
  ml_label_storage_path?: string | null;
  ml_thermal_label_storage_path?: string | null;
};

export type Summary = {
  revenue: number;
  profit: number;
  orders: number;
  averageTicket: number;
  margin: number;
  profitPending: number;
  averageKnownProfit: number | null;
};


export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function normalizeStatus(value: unknown): string {
  return String(value || "aberto").trim().toLowerCase() || "aberto";
}


export function periodBounds(preset: DashboardPreset, now: Date) {
  const { start: todayStart } = saoPauloDayBounds(now);
  const days = preset === "today" ? 1 : preset === "30d" ? 30 : 7;
  const currentStart = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const currentEnd = now;
  const previousStart = new Date(currentStart.getTime() - days * DAY_MS);
  const previousEnd = new Date(currentEnd.getTime() - days * DAY_MS);

  return { days, currentStart, currentEnd, previousStart, previousEnd };
}

export function summarize(rows: OrderRow[]): Summary {
  let revenue = 0;
  let profit = 0;
  let orders = 0;
  let profitPending = 0;
  let knownProfitOrders = 0;

  for (const row of rows) {
    if (normalizeStatus(row.situacao) === "cancelado") continue;
    revenue += Number(row.operational_total || 0);
    orders += 1;
    if (row.operational_profit_pending || row.operational_lucro === null) {
      profitPending += 1;
      continue;
    }
    profit += Number(row.operational_lucro || 0);
    knownProfitOrders += 1;
  }

  return {
    revenue: round2(revenue),
    profit: round2(profit),
    orders,
    averageTicket: orders > 0 ? round2(revenue / orders) : 0,
    margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    profitPending,
    averageKnownProfit:
      knownProfitOrders > 0 ? round2(profit / knownProfitOrders) : null,
  };
}


export async function loadRowsInRange(
  serviceClient: ReturnType<typeof createServiceClient>,
  start: Date,
  end: Date,
): Promise<{ data: OrderRow[]; error: { message?: string } | null }> {
  const rows: OrderRow[] = [];
  const pageSize = 500;
  const columns = [
    "id",
    "numero",
    "contato_nome",
    "data",
    "data_venda",
    "situacao",
    "operational_total",
    "operational_lucro",
    "operational_profit_pending",
    "operational_pedido_ids",
    "snapshot_source",
  ].join(",");

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await (serviceClient as any)
      .from("pedidos_operacionais")
      .select(columns)
      .gte("data_venda", dateIso(start))
      .lte("data_venda", dateIso(end))
      .order("data_venda", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...((data || []) as OrderRow[]));
    if ((data || []).length < pageSize) return { data: rows, error: null };
  }
}
