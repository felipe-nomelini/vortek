import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getPurchases } from "@/app/api/compras/route";
import { mapMobilePurchase } from "@/lib/mobile-purchases";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(20),
  search: z.string().trim().max(120).default(""),
  status: z.string().trim().max(80).default(""),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum([
    "dsid", "pedido_vendas_numero", "data_criacao", "destinatario_nome",
    "produto_descricao", "quantidade", "valor_total", "status", "nf_numero",
  ]).default("data_criacao"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") || undefined,
    pageSize: url.searchParams.get("pageSize") || undefined,
    search: url.searchParams.get("search") || undefined,
    status: url.searchParams.get("status") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    sortBy: url.searchParams.get("sortBy") || undefined,
    sortOrder: url.searchParams.get("sortOrder") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { code: "INVALID_QUERY", message: "Filtros de compras inválidos" }, meta: { requestId } }, { status: 400 });
  }
  const legacyUrl = new URL("/api/compras", request.url);
  legacyUrl.searchParams.set("page", String(parsed.data.page));
  legacyUrl.searchParams.set("limit", String(parsed.data.pageSize));
  for (const key of ["search", "status", "dateFrom", "dateTo", "sortBy", "sortOrder"] as const) {
    const value = parsed.data[key];
    if (value) legacyUrl.searchParams.set(key, String(value));
  }
  const response = await getPurchases(new Request(legacyUrl, { headers: request.headers }));
  const body = await response.json();
  if (!response.ok) {
    return NextResponse.json({ data: null, error: { code: "PURCHASES_LIST_FAILED", message: body?.error || "Falha ao carregar compras" }, meta: { requestId } }, { status: response.status });
  }
  return NextResponse.json({
    data: (Array.isArray(body?.data) ? body.data : []).map(mapMobilePurchase),
    error: null,
    meta: {
      requestId,
      page: Number(body?.page || parsed.data.page),
      pageSize: Number(body?.pageSize || parsed.data.pageSize),
      total: Number(body?.total || 0),
    },
  }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
