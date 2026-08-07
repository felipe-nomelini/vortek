import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getOrders } from "@/app/api/pedidos/route";
import {
  getMobileSaleSearchReference,
  isMobileSaleDatabaseId,
} from "@/lib/mobile-sale-id";
import { createServiceClient } from "@/lib/supabase";

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

async function resolveMobileSaleSearchReference(id: string): Promise<{
  reference: string;
  error: unknown | null;
}> {
  if (!isMobileSaleDatabaseId(id)) {
    return { reference: id, error: null };
  }

  const { data, error } = await (createServiceClient() as any)
    .from("pedidos_operacionais")
    .select("numero,ml_order_id,ml_pack_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return { reference: id, error };
  return {
    reference: getMobileSaleSearchReference(id, data),
    error: null,
  };
}

export async function loadMobileOperationalSale(request: Request, id: string) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const resolved = await resolveMobileSaleSearchReference(id);
  if (resolved.error) {
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
  const legacyUrl = new URL("/api/pedidos", request.url);
  legacyUrl.searchParams.set("operationalView", "all");
  legacyUrl.searchParams.set("search", resolved.reference);
  legacyUrl.searchParams.set("page", "1");
  legacyUrl.searchParams.set("pageSize", "25");
  const legacyResponse = await getOrders(new Request(legacyUrl, {
    headers: request.headers,
  }));
  const body = await legacyResponse.json();

  if (!legacyResponse.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          data: null,
          error: {
            code: body?.error?.code || "SALE_LOOKUP_FAILED",
            message: body?.error?.message || body?.erro || "Falha ao carregar venda",
          },
          meta: { requestId: body?.meta?.requestId || requestId },
        },
        {
          status: legacyResponse.status,
          headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
        },
      ),
    };
  }

  const row = (Array.isArray(body?.data) ? body.data : [])
    .find((candidate: any) => matchesMobileSale(candidate, id));
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
