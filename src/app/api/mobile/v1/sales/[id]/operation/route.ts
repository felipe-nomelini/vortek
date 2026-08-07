import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as completeLabel } from "@/app/api/dslite/etiqueta-auto/route";
import { POST as selectShipping } from "@/app/api/dslite/frete/route";
import { POST as unlinkDslite } from "@/app/api/dslite/desvincular-local/route";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import type { MobilePermission } from "@/lib/mobile-permissions";
import { loadMobileOperationalSale, mobileSaleIdSchema } from "@/lib/mobile-sale-lookup";
import { isPostDispatchOrder } from "@/lib/orders/operational-view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete_dslite_label"), duplicateAction: z.enum(["use_existing", "reissue"]).optional() }),
  z.object({ action: z.literal("process_internal_shipping"), duplicateAction: z.enum(["use_existing", "reissue"]).optional() }),
  z.object({ action: z.literal("select_dslite_shipping"), transportadoraId: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("unlink_dslite") }),
]);

const permissions: Record<z.infer<typeof schema>["action"], MobilePermission> = {
  complete_dslite_label: "sales.dslite.label.complete",
  process_internal_shipping: "sales.internal_shipping.process",
  select_dslite_shipping: "sales.dslite.shipping.select",
  unlink_dslite: "sales.dslite.unlink",
};

function mobileError(requestId: string, status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message }, meta: { requestId } }, {
    status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return mobileError(requestId, 400, "INVALID_OPERATION", "Operação inválida");
  const auth = await authorizeApiRequest(request, permissions[payload.data.action]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const parsedId = mobileSaleIdSchema.safeParse(id);
  if (!parsedId.success) return mobileError(requestId, 400, "INVALID_SALE_ID", "Venda inválida");
  const lookup = await loadMobileOperationalSale(request, parsedId.data);
  if (!lookup.ok) return lookup.response;
  const row = lookup.row;
  const dsliteIds = Array.from(new Set((Array.isArray(row?.operational_dslite_ids)
    ? row.operational_dslite_ids : [row?.dslite_id])
    .map((value: unknown) => String(value || "").trim()).filter(Boolean)));
  const baseBlocked = Boolean(row?.has_split_fulfillment || isPostDispatchOrder(row));
  let response: Response;

  if (payload.data.action === "complete_dslite_label") {
    if (baseBlocked || row?.envio_interno_at || dsliteIds.length !== 1 || row?.dslite_next_action !== "complete_dslite_label") {
      return mobileError(requestId, 409, "ACTION_NOT_ALLOWED", "Venda não está pronta para completar etiqueta DSLite");
    }
    response = await completeLabel(new Request(new URL("/api/dslite/etiqueta-auto", request.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: String(row.id), dsid: dsliteIds[0], nfeDuplicateAction: payload.data.duplicateAction }),
    }));
  } else if (payload.data.action === "process_internal_shipping") {
    if (baseBlocked || row?.envio_interno_at || dsliteIds.length || !row?.internal_stock_available || !row?.ml_shipment_id) {
      return mobileError(requestId, 409, "ACTION_NOT_ALLOWED", "Venda não está pronta para envio interno");
    }
    response = await completeLabel(new Request(new URL("/api/dslite/etiqueta-auto", request.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: String(row.id), directShipping: true, nfeDuplicateAction: payload.data.duplicateAction }),
    }));
  } else if (payload.data.action === "select_dslite_shipping") {
    if (baseBlocked || dsliteIds.length !== 1) return mobileError(requestId, 409, "ACTION_NOT_ALLOWED", "Pedido DSLite ambíguo");
    response = await selectShipping(new Request(new URL("/api/dslite/frete", request.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: String(row.id), dsid: dsliteIds[0], transportadoraId: payload.data.transportadoraId }),
    }));
  } else {
    if (dsliteIds.length !== 1 || !/rejeitad|rejected/i.test(String(row?.dslite_status || ""))) {
      return mobileError(requestId, 409, "ACTION_NOT_ALLOWED", "Somente compra DSLite rejeitada pode ser desvinculada");
    }
    response = await unlinkDslite(new Request(new URL("/api/dslite/desvincular-local", request.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: String(row.id), mlOrderId: String(row.ml_order_id || ""), motivo: "desvinculo_local_para_correcao_de_estado_mobile" }),
    }));
  }

  const body = await response.json().catch(() => ({}));
  const actionRequired = body?.actionRequired || body?.details?.actionRequired;
  if (!response.ok && ["choose_dslite_shipping", "choose_existing_or_reissue"].includes(String(actionRequired || ""))) {
    return NextResponse.json({ data: { ...body, actionRequired }, error: null, meta: { requestId } }, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
  if (!response.ok) return mobileError(requestId, response.status, "OPERATION_FAILED", body?.error || "Falha na operação");
  return NextResponse.json({ data: body?.data || body, error: null, meta: { requestId } }, {
    status: response.status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
