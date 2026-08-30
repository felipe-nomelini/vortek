import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as sendWhatsappLabel } from "@/app/api/pedidos/[id]/enviar-etiqueta-whatsapp/route";
import { GET as getWhatsappLabelStatus } from "@/app/api/pedidos/[id]/enviar-etiqueta-whatsapp/status/route";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import {
  loadMobileOperationalSale,
  mobileSaleIdSchema,
} from "@/lib/mobile-sale-lookup";
import { isPostDispatchOrder } from "@/lib/orders/operational-view";
import { createServiceClient } from "@/lib/supabase";
import { normalizeIdempotencyKey } from "@/services/job-idempotency";
import { getWhatsappLabelJobRequest } from "@/services/whatsapp-label-job";

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
  const auth = await authorizeApiRequest(request, "sales.whatsapp_label.send");
  if (!auth.ok) return auth.response;
  const { id: rawId } = await context.params;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const lookup = await resolveSale(request, rawId);
  if (!lookup) {
    return mobileError(requestId, 400, "INVALID_SALE_ID", "Identificador da venda inválido");
  }
  if (!lookup.ok) return lookup.response;

  const row = lookup.row;
  const phoneNumber = String(row?.fornecedor_telefone || "").replace(/\D/g, "");
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
  if (row?.has_split_fulfillment || dsliteIds.length !== 1) {
    return mobileError(requestId, 409, "AMBIGUOUS_PURCHASE", "Venda possui fluxo dividido ou compra DSLite ambígua");
  }
  if (!phoneNumber) {
    return mobileError(requestId, 422, "SUPPLIER_PHONE_MISSING", "Fornecedor sem WhatsApp cadastrado");
  }

  const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    return mobileError(requestId, 400, "IDEMPOTENCY_KEY_INVALID", "Chave de idempotência ausente ou inválida");
  }

  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Idempotency-Key", idempotencyKey);
  const legacyResponse = await sendWhatsappLabel(
    new Request(new URL(`/api/pedidos/${row.id}/enviar-etiqueta-whatsapp`, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        phoneNumber,
        usePlaceholderLabel: false,
        idempotencyKey,
      }),
    }),
    { params: Promise.resolve({ id: String(row.id) }) },
  );
  const body = await legacyResponse.json();
  if (!legacyResponse.ok) {
    return mobileError(
      requestId,
      legacyResponse.status,
      "WHATSAPP_LABEL_START_FAILED",
      body?.error?.message || body?.error || "Falha ao iniciar envio da etiqueta",
    );
  }

  return NextResponse.json(
    {
      data: {
        jobId: String(body.jobId),
        state: "running",
        steps: Array.isArray(body.steps) ? body.steps : [],
        deduplicated: Boolean(body.deduplicated),
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
  const auth = await authorizeApiRequest(request, "sales.whatsapp_label.send");
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
    .select("id,tipo,log")
    .eq("id", parsedJobId.data)
    .maybeSingle();
  const payload = job ? getWhatsappLabelJobRequest(job.log) : null;
  if (error || !job || job.tipo !== "whatsapp_label_send" || payload?.pedidoId !== String(lookup.row.id)) {
    return mobileError(requestId, 404, "JOB_NOT_FOUND", "Job não encontrado para esta venda");
  }

  const statusUrl = new URL(`/api/pedidos/${lookup.row.id}/enviar-etiqueta-whatsapp/status`, request.url);
  statusUrl.searchParams.set("jobId", parsedJobId.data);
  const legacyResponse = await getWhatsappLabelStatus(
    new Request(statusUrl, { headers: request.headers }),
    { params: Promise.resolve({ id: String(lookup.row.id) }) },
  );
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
        nextRetryAt: body.nextRetryAt || null,
        retryAttempt: Number(body.retryAttempt || 0),
      },
      error: null,
      meta: { requestId },
    },
    { headers: responseHeaders(requestId) },
  );
}
