import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { reconcileBrasilNfeExistingInvoice } from "@/lib/fiscal/ensure-brasilnfe-invoice";

function isMissingSaleDateColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

function isAuthorizedRequest(request: Request): boolean {
  const apiKey = request.headers.get("x-api-key") || "";
  return Boolean(apiKey && apiKey === process.env.API_SECRET_KEY);
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mlOrderIds = Array.isArray(body?.mlOrderIds)
    ? body.mlOrderIds
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const pedidoIds = Array.isArray(body?.pedidoIds)
    ? body.pedidoIds
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const limit = Math.max(1, Math.min(50, Number(body?.limit || 10)));

  const client = createServiceClient();

  function buildQuery(useSaleDate: boolean) {
    let query = client
      .from("pedidos")
      .select(
        "id,numero,ml_order_id,nfe_status,nota_fiscal_numero,nota_fiscal_emitida,situacao",
      )
      .limit(limit);

    query = useSaleDate
      ? query
          .order("data_venda", { ascending: false, nullsFirst: false })
          .order("data", { ascending: false })
      : query.order("data", { ascending: false });

    if (mlOrderIds.length > 0) {
      query = query.in("ml_order_id", mlOrderIds);
    } else if (pedidoIds.length > 0) {
      query = query.in("id", pedidoIds);
    } else {
      query = query
        .in("situacao", [
          "etiqueta_impressa",
          "coletado",
          "em_transito",
          "entregue",
        ])
        .or(
          "nfe_status.is.null,nfe_status.eq.pendente,nota_fiscal_numero.is.null",
        );
    }

    return query;
  }

  let { data: pedidos, error } = await buildQuery(true);
  if (isMissingSaleDateColumnError(error)) {
    ({ data: pedidos, error } = await buildQuery(false));
  }
  if (error) {
    return NextResponse.json(
      { error: "Falha ao carregar pedidos para reconciliação Brasil NFe" },
      { status: 500 },
    );
  }

  const results = [];
  for (const pedido of pedidos || []) {
    const result = await reconcileBrasilNfeExistingInvoice({
      pedidoId: String(pedido.id),
    });
    results.push({
      pedidoId: pedido.id,
      pedidoNumero: pedido.numero,
      mlOrderId: pedido.ml_order_id,
      ok: result.ok,
      status: result.status || null,
      chave: result.chave || null,
      numero: result.numero || null,
      danfeUrl: result.danfeUrl || null,
      error: result.error || null,
    });
  }

  return NextResponse.json({
    success: true,
    total: results.length,
    reconciled: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
