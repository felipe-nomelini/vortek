import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { saoPauloDateParamToUtcIso } from "@/lib/timezone";
import {
  normalizeNfeTechnicalStatus,
  type NfeTechnicalStatus,
} from "@/lib/fiscal/nfe-status";
import { reconcileRowsBestEffort } from "@/lib/fiscal/nfe-live-sync";

type NFStatus = NfeTechnicalStatus;
type SortOrder = "asc" | "desc";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

const sortColumnMap: Record<string, string> = {
  pedido: "numero",
  numero: "nota_fiscal_numero",
  cliente: "contato_nome",
  data: "data_venda",
  valor: "total",
  status: "nfe_status",
};

function isMissingSaleDateColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

function getOrderDate(row: any): string | null {
  return row?.data_venda || row?.data || null;
}

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, " ").trim();
}

function mapStatus(row: { nfe_status: string | null }): NFStatus {
  return normalizeNfeTechnicalStatus(row.nfe_status);
}

function applyStatusFilter(query: any, status: NFStatus): any {
  if (status === "autorizada")
    return query.or("nfe_status.eq.authorized,nfe_status.eq.autorizada");
  if (status === "cancelada")
    return query.or(
      "nfe_status.eq.cancelada,nfe_status.eq.cancelled,nfe_status.eq.canceled",
    );
  if (status === "pendente")
    return query.or(
      "nfe_status.eq.pendente,nfe_status.eq.pending,nfe_status.is.null",
    );
  if (status === "interrompida")
    return query.or("nfe_status.eq.interrupted,nfe_status.eq.interrompida");
  if (status === "rejeitada")
    return query.or(
      "nfe_status.eq.rejected,nfe_status.eq.rejeitada,nfe_status.eq.denegada",
    );
  if (status === "processando")
    return query.or("nfe_status.eq.processing,nfe_status.eq.processando");
  return query;
}

function applyCommonFilters(
  query: any,
  params: {
    search: string;
    dateFrom: string;
    dateTo: string;
    valorMin: string | null;
    valorMax: string | null;
    useSaleDate: boolean;
  },
): any {
  const { search, dateFrom, dateTo, valorMin, valorMax, useSaleDate } = params;
  let next = query;
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
    next = next.or(filters.join(","));
  }

  const startDateIso = dateFrom
    ? saoPauloDateParamToUtcIso(dateFrom, "start")
    : null;
  const endDateIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, "end") : null;

  const dateColumn = useSaleDate ? "data_venda" : "data";

  if (startDateIso) {
    next = next.gte(dateColumn, startDateIso);
  }

  if (endDateIso) {
    next = next.lte(dateColumn, endDateIso);
  }

  if (valorMin) {
    const min = Number(valorMin);
    if (!Number.isNaN(min)) {
      next = next.gte("total", min);
    }
  }

  if (valorMax) {
    const max = Number(valorMax);
    if (!Number.isNaN(max)) {
      next = next.lte("total", max);
    }
  }

  return next;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }
  const serviceClient = createServiceClient();

  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSizeRaw = parseInt(
      searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT),
      10,
    );
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw));

    const search = normalizeSearch(searchParams.get("search") || "");
    const status = (searchParams.get("status") || "").trim() as NFStatus | "";
    const dateFrom = (searchParams.get("dateFrom") || "").trim();
    const dateTo = (searchParams.get("dateTo") || "").trim();
    const valorMin = searchParams.get("valorMin");
    const valorMax = searchParams.get("valorMax");

    const sortByParam = (searchParams.get("sortBy") || "data").trim();
    const sortBy = sortColumnMap[sortByParam] || "data_venda";
    const sortOrder: SortOrder =
      (searchParams.get("sortOrder") || "desc").toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    async function runQueries(useSaleDate: boolean) {
      const baseSelect = `id, numero, ml_order_id, ml_pack_id, contato_nome, contato_documento, data, ${useSaleDate ? "data_venda," : ""} nota_fiscal_numero, nota_fiscal_emitida, nfe_status, nfe_chave, nfe_protocolo, nfe_danfe_url, nfe_cfop, nfe_xml, nfe_last_sync_at, total`;
      const sortColumn =
        sortBy === "data_venda"
          ? useSaleDate
            ? "data_venda"
            : "data"
          : sortBy;

      let countQuery = serviceClient
        .from("pedidos")
        .select("id", { count: "exact", head: true });
      let dataQuery = serviceClient
        .from("pedidos")
        .select(baseSelect)
        .order(sortColumn, {
          ascending: sortOrder === "asc",
          nullsFirst: false,
        })
        .range(from, to);

      countQuery = applyCommonFilters(countQuery, {
        search,
        dateFrom,
        dateTo,
        valorMin,
        valorMax,
        useSaleDate,
      });
      dataQuery = applyCommonFilters(dataQuery, {
        search,
        dateFrom,
        dateTo,
        valorMin,
        valorMax,
        useSaleDate,
      });

      return { countQuery, dataQuery, baseSelect, sortColumn };
    }

    let { countQuery, dataQuery, baseSelect, sortColumn } =
      await runQueries(true);

    let data: any[] = [];
    let count = 0;

    if (status === "outro") {
      let fullQuery = applyCommonFilters(
        serviceClient
          .from("pedidos")
          .select(baseSelect)
          .order(sortColumn, {
            ascending: sortOrder === "asc",
            nullsFirst: false,
          }),
        { search, dateFrom, dateTo, valorMin, valorMax, useSaleDate: true },
      );
      let { data: rawRows, error } = await fullQuery;
      if (isMissingSaleDateColumnError(error)) {
        ({ baseSelect, sortColumn } = await runQueries(false));
        fullQuery = applyCommonFilters(
          serviceClient
            .from("pedidos")
            .select(baseSelect)
            .order(sortColumn, {
              ascending: sortOrder === "asc",
              nullsFirst: false,
            }),
          { search, dateFrom, dateTo, valorMin, valorMax, useSaleDate: false },
        );
        ({ data: rawRows, error } = await fullQuery);
      }
      if (error) {
        return NextResponse.json(
          { erro: error.message || "Erro ao buscar notas fiscais" },
          { status: 500 },
        );
      }
      const reconciledRows = await reconcileRowsBestEffort(
        serviceClient,
        rawRows || [],
      );
      const filtered = reconciledRows.filter(
        (row: any) => normalizeNfeTechnicalStatus(row.nfe_status) === "outro",
      );
      count = filtered.length;
      data = filtered.slice(from, to + 1);
    } else {
      if (status) {
        countQuery = applyStatusFilter(countQuery, status);
        dataQuery = applyStatusFilter(dataQuery, status);
      }

      let [
        { count: totalCount, error: countError },
        { data: rowsData, error: dataError },
      ] = await Promise.all([countQuery, dataQuery]);
      if (
        isMissingSaleDateColumnError(countError) ||
        isMissingSaleDateColumnError(dataError)
      ) {
        ({ countQuery, dataQuery } = await runQueries(false));
        if (status) {
          countQuery = applyStatusFilter(countQuery, status);
          dataQuery = applyStatusFilter(dataQuery, status);
        }
        [
          { count: totalCount, error: countError },
          { data: rowsData, error: dataError },
        ] = await Promise.all([countQuery, dataQuery]);
      }
      if (countError || dataError) {
        return NextResponse.json(
          {
            erro:
              countError?.message ||
              dataError?.message ||
              "Erro ao buscar notas fiscais",
          },
          { status: 500 },
        );
      }
      count = totalCount || 0;
      data = await reconcileRowsBestEffort(serviceClient, rowsData || []);
    }

    const rows = (data || []).map((row) => ({
      id: row.id,
      pedido: row.numero,
      cliente: row.contato_nome || "—",
      data: getOrderDate(row),
      numero: row.nota_fiscal_numero || "—",
      valor: Number(row.total || 0),
      status: mapStatus(row),
      ml_order_id: row.ml_order_id,
      ml_pack_id: (row as any).ml_pack_id || null,
      contato_documento: row.contato_documento || null,
      nfe_chave: row.nfe_chave || null,
      nfe_danfe_url: row.nfe_danfe_url || null,
      nfe_status: row.nfe_status || null,
      danfe_available: !!row.nfe_danfe_url,
    }));

    return NextResponse.json({
      data: rows,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json(
      { erro: error?.message || "Erro inesperado" },
      { status: 500 },
    );
  }
}
