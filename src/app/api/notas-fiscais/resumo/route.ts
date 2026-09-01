import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { authorizeApiRequest } from "@/lib/api-request-auth";
import { saoPauloDateParamToUtcIso } from "@/lib/timezone";
import {
  normalizeNfeTechnicalStatus,
  type NfeTechnicalStatus,
} from "@/lib/fiscal/nfe-status";
import { reconcileRowsBestEffort } from "@/lib/fiscal/nfe-live-sync";
import { loadPricingTaxProjection } from "@/services/pricing-tax-context";

type NFStatus = NfeTechnicalStatus;

function isMissingSaleDateColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, " ").trim();
}

function mapStatus(row: { nfe_status: string | null }): NFStatus {
  return normalizeNfeTechnicalStatus(row.nfe_status);
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "fiscal.read");
  if (!auth.ok) return auth.response;
  const serviceClient = createServiceClient();

  try {
    const { searchParams } = new URL(request.url);

    const search = normalizeSearch(searchParams.get("search") || "");
    const status = (searchParams.get("status") || "").trim() as NFStatus | "";
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();
    const valorMin = searchParams.get("valorMin");
    const valorMax = searchParams.get("valorMax");

    async function buildResumoQuery(useSaleDate: boolean) {
      let query = serviceClient
        .from("pedidos")
        .select(
          `id, nota_fiscal_numero, nota_fiscal_emitida, nfe_status, nfe_chave, nfe_protocolo, nfe_cfop, nfe_xml, total, data, ${useSaleDate ? "data_venda," : ""} contato_nome, ml_order_id, ml_pack_id, numero`,
        );

      if (search) {
        const filters = [
          `contato_nome.ilike.%${search}%`,
          `nota_fiscal_numero.ilike.%${search}%`,
          `ml_order_id.ilike.%${search}%`,
          `ml_pack_id.ilike.%${search}%`,
        ];

        if (/^\d+$/.test(search)) {
          filters.push(`numero.eq.${search}`);
        }
        query = query.or(filters.join(","));
      }

      const startDateIso = dateFrom
        ? saoPauloDateParamToUtcIso(dateFrom, "start")
        : null;
      const endDateIso = dateTo
        ? saoPauloDateParamToUtcIso(dateTo, "end")
        : null;
      const dateColumn = useSaleDate ? "data_venda" : "data";

      if (startDateIso) {
        query = query.gte(dateColumn, startDateIso);
      }

      if (endDateIso) {
        query = query.lte(dateColumn, endDateIso);
      }

      if (valorMin) {
        const min = Number(valorMin);
        if (!Number.isNaN(min)) query = query.gte("total", min);
      }

      if (valorMax) {
        const max = Number(valorMax);
        if (!Number.isNaN(max)) query = query.lte("total", max);
      }

      return query;
    }

    let query = await buildResumoQuery(true);

    let { data, error } = await query;
    if (isMissingSaleDateColumnError(error)) {
      query = await buildResumoQuery(false);
      ({ data, error } = await query);
    }
    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }

    let rows = await reconcileRowsBestEffort(serviceClient, data || []);
    if (status) {
      rows = rows.filter((row) => mapStatus(row) === status);
    }
    let emitidas = 0;
    let pendentes = 0;
    let comErro = 0;
    let valorAutorizado = 0;

    for (const row of rows) {
      const mapped = mapStatus(row);
      if (mapped === "autorizada") {
        emitidas++;
        valorAutorizado += Number(row.total || 0);
      }
      if (mapped === "pendente" || mapped === "processando") pendentes++;
      if (mapped === "interrompida" || mapped === "rejeitada" || mapped === "outro") comErro++;
    }

    let impostoEstimadoMes: Awaited<ReturnType<typeof loadPricingTaxProjection>> | null = null;
    try {
      impostoEstimadoMes = await loadPricingTaxProjection(serviceClient);
    } catch (error) {
      console.error('[fiscal-summary] Projeção tributária indisponível', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }

    return NextResponse.json({
      total: rows.length,
      emitidas,
      pendentes,
      com_erro: comErro,
      valor_autorizado: valorAutorizado,
      imposto_estimado_mes: impostoEstimadoMes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { erro: error?.message || "Erro inesperado" },
      { status: 500 },
    );
  }
}
