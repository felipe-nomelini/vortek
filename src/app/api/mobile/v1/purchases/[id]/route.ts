import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import { DSLITE_BKR1_PLACEHOLDER_LABEL_SOURCE } from "@/lib/dslite/placeholder-label";
import { mapMobilePurchase } from "@/lib/mobile-purchases";
import { createServiceClient } from "@/lib/supabase";
import { isBkr1Supplier } from "@/lib/supplier-balance";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function error(requestId: string, status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message }, meta: { requestId } }, {
    status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "purchases.read");
  if (!auth.ok) return auth.response;
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return error(requestId, 400, "INVALID_PURCHASE_ID", "Compra inválida");

  const client = createServiceClient();
  const { data: purchase, error: purchaseError } = await client
    .from("compras")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (purchaseError) return error(requestId, 500, "PURCHASE_LOOKUP_FAILED", "Falha ao consultar compra");
  if (!purchase) return error(requestId, 404, "PURCHASE_NOT_FOUND", "Compra não encontrada");

  const [supplierResult, orderResult] = await Promise.all([
    purchase.fornecedor_id
      ? client.from("fornecedores").select("supplier_pix_key").eq("dslite_id", String(purchase.fornecedor_id)).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    purchase.dsid
      ? client.from("pedidos")
        .select("id,numero,ml_order_id,ml_pack_id,situacao,ml_shipment_id,rastreio,ml_fiscal_release_at,dslite_label_source")
        .eq("dslite_id", String(purchase.dsid))
        .order("data", { ascending: false })
        .limit(1)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (supplierResult.error || orderResult.error) {
    return error(requestId, 500, "PURCHASE_ENRICHMENT_FAILED", "Falha ao carregar vínculo da compra");
  }
  const order = orderResult.data as any;
  const releaseAt = order?.ml_fiscal_release_at ? new Date(order.ml_fiscal_release_at) : null;
  const deferred = Boolean(
    isBkr1Supplier(purchase.fornecedor_id, purchase.fornecedor_nome)
    && purchase.supplier_payment_mode === "prepaid_pix"
    && purchase.supplier_payment_status !== "paid"
    && order?.dslite_label_source === DSLITE_BKR1_PLACEHOLDER_LABEL_SOURCE
    && releaseAt
    && !Number.isNaN(releaseAt.getTime())
    && releaseAt.getTime() > Date.now()
  );
  const mapped = mapMobilePurchase({
    ...purchase,
    pedido_vendas_numero: order?.numero ?? null,
    supplier_pix_key: (supplierResult.data as any)?.supplier_pix_key || null,
    bkr1_pix_deferred: deferred,
  });
  const mlReference = String(order?.ml_pack_id || order?.ml_order_id || order?.numero || "").trim();

  return NextResponse.json({
    data: {
      purchase: {
        ...mapped,
        saleStatus: order?.situacao || null,
        shipmentId: order?.ml_shipment_id || null,
        saleUrl: mlReference
          ? `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(mlReference)}/detalhe`
          : null,
        trackingUrl: mapped.tracking
          ? `https://www.linkcorreios.com.br/?id=${encodeURIComponent(mapped.tracking)}`
          : null,
      },
    },
    error: null,
    meta: { requestId },
  }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
