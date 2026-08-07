import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getPurchasesSummary } from "@/app/api/compras/resumo/route";
import { mapMobilePurchasesSummary } from "@/lib/mobile-purchases";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  search: z.string().trim().max(120).default(""),
  status: z.string().trim().max(80).default(""),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { code: "INVALID_QUERY", message: "Filtros de compras inválidos" }, meta: { requestId } }, { status: 400 });
  }
  const legacyUrl = new URL("/api/compras/resumo", request.url);
  for (const key of ["search", "status", "dateFrom", "dateTo"] as const) {
    const value = parsed.data[key];
    if (value) legacyUrl.searchParams.set(key, value);
  }
  const response = await getPurchasesSummary(new Request(legacyUrl, { headers: request.headers }));
  const body = await response.json();
  if (!response.ok) {
    return NextResponse.json({ data: null, error: { code: "PURCHASES_SUMMARY_FAILED", message: body?.error || "Falha ao carregar resumo" }, meta: { requestId } }, { status: response.status });
  }
  return NextResponse.json({ data: mapMobilePurchasesSummary(body), error: null, meta: { requestId } }, {
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
