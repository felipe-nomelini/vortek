import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getOrders } from "@/app/api/pedidos/route";
import { createServiceClient } from "@/lib/supabase";
import {
  mapMobileSaleDetail,
  mapMobileSaleHistoryEvent,
} from "@/lib/mobile-sales";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);

function matchesSale(row: any, id: string): boolean {
  const candidates = [
    row?.id,
    row?.numero,
    row?.ml_order_id,
    row?.ml_pack_id,
    ...(Array.isArray(row?.operational_order_ids) ? row.operational_order_ids : []),
  ];
  return candidates.some((value) => String(value || "") === id);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const { id: rawId } = await context.params;
  const parsedId = idSchema.safeParse(rawId);

  if (!parsedId.success) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "INVALID_SALE_ID", message: "Identificador da venda inválido" },
        meta: { requestId },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const legacyUrl = new URL("/api/pedidos", request.url);
  legacyUrl.searchParams.set("operationalView", "all");
  legacyUrl.searchParams.set("search", parsedId.data);
  legacyUrl.searchParams.set("page", "1");
  legacyUrl.searchParams.set("pageSize", "25");
  const legacyResponse = await getOrders(new Request(legacyUrl, {
    headers: request.headers,
  }));
  const body = await legacyResponse.json();

  if (!legacyResponse.ok) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: body?.error?.code || "SALE_DETAIL_FAILED",
          message: body?.error?.message || body?.erro || "Falha ao carregar venda",
        },
        meta: { requestId: body?.meta?.requestId || requestId },
      },
      {
        status: legacyResponse.status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  }

  const row = (Array.isArray(body?.data) ? body.data : [])
    .find((candidate: any) => matchesSale(candidate, parsedId.data));
  if (!row) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "SALE_NOT_FOUND", message: "Venda não encontrada" },
        meta: { requestId },
      },
      { status: 404, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
    );
  }

  const pedidoIds = (Array.isArray(row?.operational_pedido_ids)
    ? row.operational_pedido_ids
    : [row?.id])
    .map((value: unknown) => String(value || "").trim())
    .filter(Boolean);
  const serviceClient = createServiceClient();
  const { data: auditRows, error: auditError } = pedidoIds.length
    ? await serviceClient
      .from("nf_auditoria_eventos")
      .select("id,evento,status_resultante,created_at")
      .in("pedido_id", pedidoIds)
      .order("created_at", { ascending: false })
      .limit(60)
    : { data: [], error: null };

  if (auditError) {
    console.error("[mobile-sales-detail] Falha ao carregar histórico", {
      requestId,
      saleId: parsedId.data,
      code: auditError.code,
    });
    return NextResponse.json(
      {
        data: null,
        error: { code: "SALE_HISTORY_FAILED", message: "Falha ao carregar histórico da venda" },
        meta: { requestId },
      },
      { status: 500, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
    );
  }

  return NextResponse.json(
    {
      data: {
        sale: mapMobileSaleDetail(row),
        history: (auditRows || []).map(mapMobileSaleHistoryEvent),
      },
      error: null,
      meta: { requestId },
    },
    { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}
