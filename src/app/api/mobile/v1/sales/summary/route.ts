import { randomUUID } from "node:crypto";
import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getOrdersSummary } from "@/app/api/pedidos/resumo/route";
import { GET as getOrders } from "@/app/api/pedidos/route";
import { mapMobileSalesSummary } from "@/lib/mobile-sales";
import { matchesOrdersOperationalView } from "@/lib/orders/operational-view";
import {
  buildMobileSalesFilteredSummary,
  hasMobileSalesAdvancedFilters,
  matchesMobileSalesAdvancedFilters,
  MOBILE_DSLITE_LABEL_FILTERS,
  MOBILE_WHATSAPP_LABEL_FILTERS,
} from "@/lib/mobile-sales-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
  supplier: z.string().trim().max(100).optional(),
  dsliteLabel: z.enum(MOBILE_DSLITE_LABEL_FILTERS).optional(),
  whatsappLabel: z.enum(MOBILE_WHATSAPP_LABEL_FILTERS).optional(),
});

export async function GET(request: Request) {
  noStore();
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search") || undefined,
    status: url.searchParams.get("status") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    priceMin: url.searchParams.get("priceMin") || undefined,
    priceMax: url.searchParams.get("priceMax") || undefined,
    supplier: url.searchParams.get("supplier") || undefined,
    dsliteLabel: url.searchParams.get("dsliteLabel") || undefined,
    whatsappLabel: url.searchParams.get("whatsappLabel") || undefined,
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
  const advancedFilters = {
    supplier: parsed.data.supplier,
    dsliteLabel: parsed.data.dsliteLabel,
    whatsappLabel: parsed.data.whatsappLabel,
  };
  let legacyResponse: Response;
  let body: any;

  if (hasMobileSalesAdvancedFilters(advancedFilters)) {
    const listUrl = new URL("/api/pedidos", request.url);
    listUrl.searchParams.set("operationalView", "all");
    listUrl.searchParams.set("pageSize", "100");
    for (const key of ["search", "status", "dateFrom", "dateTo", "priceMin", "priceMax"] as const) {
      const value = parsed.data[key];
      if (value != null && value !== "") listUrl.searchParams.set(key, String(value));
    }
    const rows: any[] = [];
    let sourcePage = 1;
    let sourceTotal = 0;
    do {
      listUrl.searchParams.set("page", String(sourcePage));
      legacyResponse = await getOrders(new Request(listUrl, {
        headers: request.headers,
      }));
      body = await legacyResponse.json();
      if (!legacyResponse.ok) break;
      const pageRows = Array.isArray(body?.data) ? body.data : [];
      rows.push(...pageRows);
      sourceTotal = Number(body?.total || 0);
      sourcePage += 1;
      if (!pageRows.length) break;
    } while (rows.length < sourceTotal);

    if (legacyResponse!.ok) {
      body = buildMobileSalesFilteredSummary(
        rows.filter((row) => matchesMobileSalesAdvancedFilters(row, advancedFilters)),
        (row) => matchesOrdersOperationalView(row, "urgent"),
      );
    }
  } else {
    legacyResponse = await getOrdersSummary(new Request(legacyUrl, {
      headers: request.headers,
    }));
    body = await legacyResponse.json();
  }

  if (!legacyResponse!.ok) {
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
        status: legacyResponse!.status,
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
