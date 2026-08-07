import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  mapMobileSaleDetail,
  mapMobileSaleHistoryEvent,
} from "@/lib/mobile-sales";
import {
  loadMobileOperationalSale,
  mobileSaleIdSchema,
} from "@/lib/mobile-sale-lookup";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const parsedId = mobileSaleIdSchema.safeParse(rawId);
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

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

  const lookup = await loadMobileOperationalSale(request, parsedId.data);
  if (!lookup.ok) return lookup.response;
  const row = lookup.row;

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
