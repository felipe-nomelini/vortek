import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getOrdersSummary } from "@/app/api/pedidos/resumo/route";
import { mapMobileSalesSummary } from "@/lib/mobile-sales";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  search: z.string().trim().max(120).default(""),
  status: z.enum([
    "aberto", "pendente", "preparando", "pronto_envio", "etiqueta_impressa",
    "faturado", "coletado", "em_transito", "saiu_entrega", "dest_ausente",
    "atendido", "entregue", "recusado", "devolvido", "cancelado",
  ]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priceMin: z.coerce.number().finite().min(0).optional(),
  priceMax: z.coerce.number().finite().min(0).optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search") || undefined,
    status: url.searchParams.get("status") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    priceMin: url.searchParams.get("priceMin") || undefined,
    priceMax: url.searchParams.get("priceMax") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "INVALID_QUERY", message: "Busca de vendas inválida" },
        meta: { requestId },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const legacyUrl = new URL("/api/pedidos/resumo", request.url);
  if (parsed.data.search) legacyUrl.searchParams.set("search", parsed.data.search);
  if (parsed.data.status) legacyUrl.searchParams.set("status", parsed.data.status);
  if (parsed.data.dateFrom) legacyUrl.searchParams.set("dateFrom", parsed.data.dateFrom);
  if (parsed.data.dateTo) legacyUrl.searchParams.set("dateTo", parsed.data.dateTo);
  if (parsed.data.priceMin != null) legacyUrl.searchParams.set("priceMin", String(parsed.data.priceMin));
  if (parsed.data.priceMax != null) legacyUrl.searchParams.set("priceMax", String(parsed.data.priceMax));
  const legacyResponse = await getOrdersSummary(new Request(legacyUrl, {
    headers: request.headers,
  }));
  const body = await legacyResponse.json();

  if (!legacyResponse.ok) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: body?.error?.code || "SALES_SUMMARY_FAILED",
          message: body?.error?.message || body?.erro || "Falha ao resumir vendas",
        },
        meta: { requestId: body?.meta?.requestId || requestId },
      },
      {
        status: legacyResponse.status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  }

  return NextResponse.json(
    {
      data: mapMobileSalesSummary(body),
      error: null,
      meta: { requestId },
    },
    {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}
