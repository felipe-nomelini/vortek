import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as createDsliteOrder } from "@/app/api/dslite/pedido/route";
import { GET as getDsliteJobStatus } from "@/app/api/dslite/pedido/status/route";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import { loadMobileOperationalSale, mobileSaleIdSchema } from "@/lib/mobile-sale-lookup";
import { isPostDispatchOrder } from "@/lib/orders/operational-view";
import { createServiceClient } from "@/lib/supabase";
import { getJobPedidoId, normalizeIdempotencyKey } from "@/services/job-idempotency";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const jobIdSchema = z.string().uuid();

function error(requestId: string, status: number, code: string, message: string) {
  return NextResponse.json(
    { data: null, error: { code, message }, meta: { requestId } },
    { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "sales.dslite.create");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const parsedId = mobileSaleIdSchema.safeParse(id);
  if (!parsedId.success) return error(requestId, 400, "INVALID_SALE_ID", "Venda inválida");
  const lookup = await loadMobileOperationalSale(request, parsedId.data);
  if (!lookup.ok) return lookup.response;
  const row = lookup.row;
  const hasDslite = (Array.isArray(row?.operational_dslite_ids)
    ? row.operational_dslite_ids
    : [row?.dslite_id]).some((value: unknown) => String(value || "").trim());
  if (
    row?.envio_interno_at
    || isPostDispatchOrder(row)
    || row?.has_split_fulfillment
    || hasDslite
    || row?.internal_stock_available
    || ["cancelado", "entregue", "devolvido", "recusado"].includes(String(row?.situacao || ""))
  ) {
    return error(requestId, 409, "ACTION_NOT_ALLOWED", "Esta venda não permite criar pedido DSLite");
  }
  const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) return error(requestId, 400, "IDEMPOTENCY_KEY_INVALID", "Chave de idempotência inválida");

  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Idempotency-Key", idempotencyKey);
  const response = await createDsliteOrder(new Request(new URL("/api/dslite/pedido", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoId: String(row.id),
      mlOrderId: String(row.ml_order_id || row.numero || ""),
      nfeProvider: "brasilnfe",
      idempotencyKey,
    }),
  }));
  const body = await response.json();
  if (!response.ok || !body?.jobId) {
    return error(requestId, response.status || 502, "DSLITE_CREATE_FAILED", body?.error || "Falha ao criar pedido DSLite");
  }
  return NextResponse.json({
    data: { jobId: String(body.jobId), state: body.state || "running", steps: body.steps || [], deduplicated: Boolean(body.deduplicated) },
    error: null,
    meta: { requestId },
  }, { status: 202, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "sales.dslite.create");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const parsedId = mobileSaleIdSchema.safeParse(id);
  const parsedJob = jobIdSchema.safeParse(new URL(request.url).searchParams.get("jobId"));
  if (!parsedId.success || !parsedJob.success) return error(requestId, 400, "INVALID_REQUEST", "Venda ou job inválido");
  const lookup = await loadMobileOperationalSale(request, parsedId.data);
  if (!lookup.ok) return lookup.response;
  const client = createServiceClient();
  const { data: job } = await client.from("jobs").select("id,tipo,log").eq("id", parsedJob.data).maybeSingle();
  if (!job || job.tipo !== "dslite_criar_pedido" || getJobPedidoId(job.log) !== String(lookup.row.id)) {
    return error(requestId, 404, "JOB_NOT_FOUND", "Job não encontrado para esta venda");
  }
  const url = new URL("/api/dslite/pedido/status", request.url);
  url.searchParams.set("jobId", parsedJob.data);
  const response = await getDsliteJobStatus(new Request(url, { headers: request.headers }));
  const body = await response.json();
  if (!response.ok) return error(requestId, response.status, "JOB_STATUS_FAILED", body?.error || "Falha ao consultar job");
  return NextResponse.json({
    data: {
      jobId: String(body.jobId), state: String(body.state || "running"), steps: body.steps || [],
      result: body.data || null, nextRetryAt: null, retryAttempt: 0,
    }, error: null, meta: { requestId },
  }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
