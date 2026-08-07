import { randomUUID } from "node:crypto";
import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getOrders } from "@/app/api/pedidos/route";
import { mapMobileSalesOrder } from "@/lib/mobile-sales";
import {
  hasMobileSalesAdvancedFilters,
  matchesMobileSalesAdvancedFilters,
  MOBILE_DSLITE_LABEL_FILTERS,
  MOBILE_WHATSAPP_LABEL_FILTERS,
} from "@/lib/mobile-sales-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const querySchema = z.object({
  view: z.enum(["urgent", "preparation", "shipping", "delivered", "all"])
    .default("urgent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(20),
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
  sortBy: z.enum(["numero", "data", "cliente", "total", "situacao", "nota_fiscal_numero", "pedido_compra", "lucro"]).default("data"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

function requestIdFrom(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || randomUUID();
}

export async function GET(request: Request) {
  noStore();
  const requestId = requestIdFrom(request);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    view: url.searchParams.get("view") || undefined,
    page: url.searchParams.get("page") || undefined,
    pageSize: url.searchParams.get("pageSize") || undefined,
    search: url.searchParams.get("search") || undefined,
    status: url.searchParams.get("status") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    priceMin: url.searchParams.get("priceMin") || undefined,
    priceMax: url.searchParams.get("priceMax") || undefined,
    supplier: url.searchParams.get("supplier") || undefined,
    dsliteLabel: url.searchParams.get("dsliteLabel") || undefined,
    whatsappLabel: url.searchParams.get("whatsappLabel") || undefined,
    sortBy: url.searchParams.get("sortBy") || undefined,
    sortOrder: url.searchParams.get("sortOrder") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "INVALID_QUERY", message: "Filtros de vendas inválidos" },
        meta: { requestId },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const legacyUrl = new URL("/api/pedidos", request.url);
  legacyUrl.searchParams.set("operationalView", parsed.data.view);
  legacyUrl.searchParams.set("page", String(parsed.data.page));
  legacyUrl.searchParams.set("pageSize", String(parsed.data.pageSize));
  if (parsed.data.search) legacyUrl.searchParams.set("search", parsed.data.search);
  if (parsed.data.status) legacyUrl.searchParams.set("status", parsed.data.status);
  if (parsed.data.dateFrom) legacyUrl.searchParams.set("dateFrom", parsed.data.dateFrom);
  if (parsed.data.dateTo) legacyUrl.searchParams.set("dateTo", parsed.data.dateTo);
  if (parsed.data.priceMin != null) legacyUrl.searchParams.set("priceMin", String(parsed.data.priceMin));
  if (parsed.data.priceMax != null) legacyUrl.searchParams.set("priceMax", String(parsed.data.priceMax));
  legacyUrl.searchParams.set("sortBy", parsed.data.sortBy);
  legacyUrl.searchParams.set("sortOrder", parsed.data.sortOrder);

  const advancedFilters = {
    supplier: parsed.data.supplier,
    dsliteLabel: parsed.data.dsliteLabel,
    whatsappLabel: parsed.data.whatsappLabel,
  };
  let body: any;
  let legacyResponse: Response;

  if (hasMobileSalesAdvancedFilters(advancedFilters)) {
    const rows: any[] = [];
    let sourcePage = 1;
    let sourceTotal = 0;
    do {
      legacyUrl.searchParams.set("page", String(sourcePage));
      legacyUrl.searchParams.set("pageSize", "100");
      legacyResponse = await getOrders(new Request(legacyUrl, {
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
      const filtered = rows.filter((row) => (
        matchesMobileSalesAdvancedFilters(row, advancedFilters)
      ));
      const from = (parsed.data.page - 1) * parsed.data.pageSize;
      body = {
        data: filtered.slice(from, from + parsed.data.pageSize),
        total: filtered.length,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      };
    }
  } else {
    legacyResponse = await getOrders(new Request(legacyUrl, {
      headers: request.headers,
    }));
    body = await legacyResponse.json();
  }

  if (!legacyResponse!.ok) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: body?.error?.code || "SALES_LIST_FAILED",
          message: body?.error?.message || body?.erro || "Falha ao carregar vendas",
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
      data: (Array.isArray(body?.data) ? body.data : []).map(mapMobileSalesOrder),
      error: null,
      meta: {
        requestId,
        page: Number(body?.page || parsed.data.page),
        pageSize: Number(body?.pageSize || parsed.data.pageSize),
        total: Number(body?.total || 0),
      },
    },
    {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}
