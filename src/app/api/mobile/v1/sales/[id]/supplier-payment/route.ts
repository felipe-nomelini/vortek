import { NextResponse } from "next/server";
import { POST as confirmSupplierPayment } from "@/app/api/compras/[id]/confirmar-pagamento/route";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import { loadMobileOperationalSale, mobileSaleIdSchema } from "@/lib/mobile-sale-lookup";
import { isPostDispatchOrder } from "@/lib/orders/operational-view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function error(requestId: string, status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message }, meta: { requestId } }, {
    status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "purchases.payment.confirm");
  if (!auth.ok) return auth.response;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const { id } = await context.params;
  const parsedId = mobileSaleIdSchema.safeParse(id);
  if (!parsedId.success) return error(requestId, 400, "INVALID_SALE_ID", "Venda inválida");
  const lookup = await loadMobileOperationalSale(request, parsedId.data);
  if (!lookup.ok) return lookup.response;
  const row = lookup.row;
  const dsliteIds = Array.from(new Set((Array.isArray(row?.operational_dslite_ids)
    ? row.operational_dslite_ids : [row?.dslite_id])
    .map((value: unknown) => String(value || "").trim()).filter(Boolean)));
  if (
    row?.envio_interno_at || isPostDispatchOrder(row) || row?.has_split_fulfillment
    || dsliteIds.length !== 1 || !row?.compra_id
    || !["confirm_supplier_payment", "send_supplier_receipt", "resume_dslite_flow"]
      .includes(String(row?.dslite_next_action || ""))
  ) {
    return error(requestId, 409, "ACTION_NOT_ALLOWED", "Venda não está pronta para confirmar pagamento");
  }

  const incoming = await request.formData().catch(() => null);
  if (!incoming) return error(requestId, 400, "INVALID_FORM", "Dados do pagamento inválidos");
  const form = new FormData();
  form.set("pedido_id", String(row.id));
  form.set("ml_order_id", String(row.ml_order_id || row.numero || ""));
  form.set("resume_dslite_flow", "true");
  for (const key of ["resume_only", "supplier_payment_reference", "supplier_payment_notes", "idempotency_key"]) {
    const value = incoming.get(key);
    if (typeof value === "string" && value.trim()) form.set(key, value.trim());
  }
  const receipt = incoming.get("receipt");
  if (receipt instanceof File) form.set("receipt", receipt, receipt.name);

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  const response = await confirmSupplierPayment(new Request(
    new URL(`/api/compras/${row.compra_id}/confirmar-pagamento`, request.url),
    { method: "POST", headers, body: form },
  ), { params: { id: String(row.compra_id) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) {
    return error(requestId, response.status || 502, "PAYMENT_CONFIRMATION_FAILED", body?.error || "Falha ao confirmar PIX");
  }
  return NextResponse.json({ data: body, error: null, meta: { requestId } }, {
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
