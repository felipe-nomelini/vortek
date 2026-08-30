import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as confirmSupplierPayment } from "@/app/api/compras/[id]/confirmar-pagamento/route";
import { GET as getDsliteJobStatus } from "@/app/api/dslite/pedido/status/route";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import {
  loadMobileOperationalSale,
  mobileSaleIdSchema,
} from "@/lib/mobile-sale-lookup";
import { isPostDispatchOrder } from "@/lib/orders/operational-view";
import { createServiceClient } from "@/lib/supabase";
import {
  jobBelongsToPedido,
  normalizeIdempotencyKey,
} from "@/services/job-idempotency";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const jobIdSchema = z.string().uuid();

function responseHeaders(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

function mobileError(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return NextResponse.json(
    { data: null, error: { code, message }, meta: { requestId } },
    { status, headers: responseHeaders(requestId) },
  );
}

async function resolveSale(request: Request, rawId: string) {
  const parsedId = mobileSaleIdSchema.safeParse(rawId);
  if (!parsedId.success) return null;
  return loadMobileOperationalSale(request, parsedId.data);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, "sales.dslite.resume");
  if (!auth.ok) return auth.response;
  const { id: rawId } = await context.params;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const lookup = await resolveSale(request, rawId);
  if (!lookup) {
    return mobileError(requestId, 400, "INVALID_SALE_ID", "Identificador da venda inválido");
  }
  if (!lookup.ok) return lookup.response;

  const row = lookup.row;
  const dsliteIds = Array.from(new Set(
    (Array.isArray(row?.operational_dslite_ids)
      ? row.operational_dslite_ids
      : [row?.dslite_id])
      .map((value: unknown) => String(value || "").trim())
      .filter(Boolean),
  ));
  if (row?.envio_interno_at || isPostDispatchOrder(row)) {
    return mobileError(requestId, 409, "ACTION_NOT_ALLOWED", "Venda não exige mais ação com fornecedor");
  }
  if (row?.has_split_fulfillment || dsliteIds.length !== 1 || !row?.compra_id) {
    return mobileError(requestId, 409, "AMBIGUOUS_PURCHASE", "Venda possui fluxo dividido ou compra DSLite ambígua");
  }
  if (
    row?.dslite_next_action !== "resume_dslite_flow"
    || row?.supplier_payment_status !== "paid"
    || !row?.supplier_payment_receipt_path
  ) {
    return mobileError(requestId, 409, "DSLITE_RESUME_NOT_READY", "Fluxo DSLite não está pronto para retomada");
  }

  const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    return mobileError(requestId, 400, "IDEMPOTENCY_KEY_INVALID", "Chave de idempotência ausente ou inválida");
  }

  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Idempotency-Key", idempotencyKey);
  const legacyResponse = await confirmSupplierPayment(
    new Request(new URL(`/api/compras/${row.compra_id}/confirmar-pagamento`, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        resume_dslite_flow: true,
        resume_only: true,
        pedido_id: String(row.id),
        ml_order_id: String(row.ml_order_id || row.numero || ""),
        idempotency_key: idempotencyKey,
      }),
    }),
    { params: Promise.resolve({ id: String(row.compra_id) }) },
  );
  const body = await legacyResponse.json();
  if (!legacyResponse.ok || !body?.jobId || body?.resume?.error) {
    return mobileError(
      requestId,
      legacyResponse.ok ? 502 : legacyResponse.status,
      "DSLITE_RESUME_FAILED",
      body?.resume?.error || body?.error?.message || body?.error || "Falha ao retomar fluxo DSLite",
    );
  }

  return NextResponse.json(
    {
      data: {
        jobId: String(body.jobId),
        state: "running",
        steps: [],
        deduplicated: Boolean(body?.resume?.deduplicated),
      },
      error: null,
      meta: { requestId },
    },
    { status: 202, headers: responseHeaders(requestId) },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, "sales.dslite.resume");
  if (!auth.ok) return auth.response;
  const { id: rawId } = await context.params;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const lookup = await resolveSale(request, rawId);
  if (!lookup) {
    return mobileError(requestId, 400, "INVALID_SALE_ID", "Identificador da venda inválido");
  }
  if (!lookup.ok) return lookup.response;

  const parsedJobId = jobIdSchema.safeParse(new URL(request.url).searchParams.get("jobId"));
  if (!parsedJobId.success) {
    return mobileError(requestId, 400, "INVALID_JOB_ID", "Job inválido");
  }
  const client = createServiceClient();
  const { data: job, error } = await client
    .from("jobs")
    .select("id,tipo,log,dedupe_key")
    .eq("id", parsedJobId.data)
    .maybeSingle();
  if (
    error
    || !job
    || job.tipo !== "dslite_criar_pedido"
    || !jobBelongsToPedido(job.log, job.dedupe_key, String(lookup.row.id))
  ) {
    return mobileError(requestId, 404, "JOB_NOT_FOUND", "Job não encontrado para esta venda");
  }

  const statusUrl = new URL("/api/dslite/pedido/status", request.url);
  statusUrl.searchParams.set("jobId", parsedJobId.data);
  const legacyResponse = await getDsliteJobStatus(new Request(statusUrl, {
    headers: request.headers,
  }));
  const body = await legacyResponse.json();
  if (!legacyResponse.ok) {
    return mobileError(requestId, legacyResponse.status, "JOB_STATUS_FAILED", body?.error || "Falha ao consultar job");
  }

  return NextResponse.json(
    {
      data: {
        jobId: String(body.jobId),
        state: String(body.state || "running"),
        steps: Array.isArray(body.steps) ? body.steps : [],
        result: body.data || null,
        nextRetryAt: null,
        retryAttempt: 0,
      },
      error: null,
      meta: { requestId },
    },
    { headers: responseHeaders(requestId) },
  );
}
