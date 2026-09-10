import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMobileSaleDatabaseId } from "@/lib/mobile-sale-id";
import { createServiceClient } from "@/lib/supabase";
import {
  enrichPedidosWithCompras,
  reconcileNotaFiscalEmitidaRow,
} from "@/services/order-read-projection";
import { enrichOrdersWithWhatsappStatus } from "@/services/order-operational-status";

export const mobileSaleIdSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

export function matchesMobileSale(row: any, id: string): boolean {
  const candidates = [
    row?.id,
    row?.numero,
    row?.ml_order_id,
    row?.ml_pack_id,
    ...(Array.isArray(row?.operational_order_ids) ? row.operational_order_ids : []),
  ];
  return candidates.some((value) => String(value || "") === id);
}

async function loadExactOperationalCandidates(id: string): Promise<{
  rows: any[];
  error: unknown | null;
}> {
  const client = createServiceClient() as any;
  if (!isMobileSaleDatabaseId(id)) {
    const lookups = [
      client.from("pedidos_operacionais").select("*").eq("ml_order_id", id).limit(2),
      client.from("pedidos_operacionais").select("*").eq("ml_pack_id", id).limit(2),
      client.from("pedidos_operacionais").select("*").contains("operational_order_ids", [id]).limit(2),
      ...(/^\d+$/.test(id)
        ? [client.from("pedidos_operacionais").select("*").eq("numero", id).limit(2)]
        : []),
    ];
    const results = await Promise.all(lookups);
    const failed = results.find((result) => result.error);
    if (failed?.error) return { rows: [], error: failed.error };
    const rows = Array.from(new Map(
      results
        .flatMap((result) => result.data || [])
        .map((row: any) => [String(row.id), row]),
    ).values());
    return { rows, error: null };
  }

  const { data, error } = await client
    .from("pedidos_operacionais")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return { rows: data ? [data] : [], error };
}

export async function loadMobileOperationalSale(request: Request, id: string) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const lookup = await loadExactOperationalCandidates(id);
  if (lookup.error) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          data: null,
          error: { code: "SALE_LOOKUP_FAILED", message: "Falha ao localizar venda" },
          meta: { requestId },
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
        },
      ),
    };
  }
  const client = createServiceClient();
  let rows: any[];
  try {
    const reconciled = lookup.rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);
    const withPurchases = await enrichPedidosWithCompras(reconciled, client);
    rows = await enrichOrdersWithWhatsappStatus(withPurchases, client);
  } catch (error) {
    console.error("[mobile-sale-lookup] Falha ao enriquecer venda", {
      requestId,
      saleId: id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          data: null,
          error: {
            code: "SALE_LOOKUP_FAILED",
            message: "Falha ao carregar venda",
          },
          meta: { requestId },
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
        },
      ),
    };
  }

  const row = rows.find((candidate: any) => matchesMobileSale(candidate, id));
  if (!row) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          data: null,
          error: { code: "SALE_NOT_FOUND", message: "Venda não encontrada" },
          meta: { requestId },
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
        },
      ),
    };
  }

  return { ok: true as const, row, requestId };
}

export const loadOperationalSale = loadMobileOperationalSale;
