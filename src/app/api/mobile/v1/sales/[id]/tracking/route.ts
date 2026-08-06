import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GET as getTracking } from "@/app/api/pedidos/[id]/tracking/route";

export const dynamic = "force-dynamic";

const trackingEventSchema = z.object({
  status: z.string(),
  substatus: z.string(),
  date: z.string(),
  description: z.string(),
});

const trackingResponseSchema = z.object({
  currentStatus: z.string(),
  currentSubstatus: z.string().nullable(),
  carrier: z.object({
    name: z.string(),
    trackingUrl: z.string().nullable(),
  }).nullable(),
  history: z.array(trackingEventSchema),
  returnHistory: z.array(trackingEventSchema.extend({ shipmentId: z.string() })),
  returnShipments: z.array(z.object({
    shipmentId: z.string(),
    status: z.string(),
    trackingNumber: z.string().nullable(),
    type: z.string(),
    destination: z.string(),
  })),
  claim: z.object({
    id: z.string(),
    status: z.string(),
    type: z.string(),
    stage: z.string(),
    reason: z.string(),
  }).nullable(),
  rastreio: z.string().nullable(),
});

function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "INVALID_SALE_ID", message: "Identificador da venda inválido" },
        meta: { requestId },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const response = await getTracking(request, { params: Promise.resolve({ id }) });
  const body = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: body?.error?.code || "SALE_TRACKING_FAILED",
          message: body?.error?.message || body?.erro || "Falha ao carregar rastreio",
        },
        meta: { requestId: body?.meta?.requestId || requestId },
      },
      {
        status: response.status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  }

  const parsed = trackingResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[mobile-sales-tracking] Contrato de rastreio inválido", {
      requestId,
      saleId: id,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
    return NextResponse.json(
      {
        data: null,
        error: { code: "TRACKING_CONTRACT_INVALID", message: "Resposta de rastreio inválida" },
        meta: { requestId },
      },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
    );
  }

  return NextResponse.json(
    {
      data: {
        ...parsed.data,
        carrier: parsed.data.carrier
          ? { ...parsed.data.carrier, trackingUrl: safeWebUrl(parsed.data.carrier.trackingUrl) }
          : null,
      },
      error: null,
      meta: { requestId },
    },
    { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}
