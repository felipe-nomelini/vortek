import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { saoPauloDateParamToUtcIso, saoPauloDayLabel } from "@/lib/timezone";

function normalizeStatus(value: unknown): string {
  return String(value || "aberto").trim() || "aberto";
}

function isCancelledStatus(value: unknown): boolean {
  return normalizeStatus(value) === "cancelado";
}

function isMissingSaleDateColumnError(
  error:
    | {
        code?: string;
        message?: string;
      }
    | null
    | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

function getOrderDate(row: any): string | null {
  return row?.data_venda || row?.data || null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  function applyDateFilter(query: any, useSaleDate: boolean) {
    const dateColumn = useSaleDate ? "data_venda" : "data";
    const startIso = dateFrom
      ? saoPauloDateParamToUtcIso(dateFrom, "start")
      : null;
    const endIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, "end") : null;
    if (startIso) query = query.gte(dateColumn, startIso);
    if (endIso) query = query.lte(dateColumn, endIso);
    return query;
  }

  async function runDashboardQueries(useSaleDate: boolean) {
    const fullDateSelect = useSaleDate ? "data_venda,data" : "data";

    let countQuery = serviceClient
      .from("pedidos")
      .select("*", { count: "exact", head: false })
      .range(0, 0);
    countQuery = applyDateFilter(countQuery, useSaleDate);

    let sumQuery = serviceClient
      .from("pedidos")
      .select("total, lucro, situacao");
    sumQuery = applyDateFilter(sumQuery, useSaleDate);

    let dailyQuery = serviceClient
      .from("pedidos")
      .select(`${fullDateSelect}, total, situacao`);
    dailyQuery = applyDateFilter(dailyQuery, useSaleDate);

    let statusQuery = serviceClient.from("pedidos").select("situacao");
    statusQuery = applyDateFilter(statusQuery, useSaleDate);

    let recentQuery = serviceClient.from("pedidos").select("*");
    recentQuery = applyDateFilter(recentQuery, useSaleDate);

    const [countResult, sumResult, dailyResult, statusResult, recentResult] =
      await Promise.all([
        countQuery,
        sumQuery,
        dailyQuery,
        statusQuery,
        recentQuery
          .order(useSaleDate ? "data_venda" : "data", {
            ascending: false,
          })
          .limit(5),
      ]);

    return { countResult, sumResult, dailyResult, statusResult, recentResult };
  }

  let {
    countResult: { count: totalPedidos, error: countError },
    sumResult: { data: sumData, error: sumError },
    dailyResult: { data: dailyData, error: dailyError },
    statusResult: { data: statusData, error: statusError },
    recentResult: { data: recentData, error: recentError },
  } = await runDashboardQueries(true);

  const missingSaleDateColumn = [
    countError,
    sumError,
    dailyError,
    statusError,
    recentError,
  ].some((error) => isMissingSaleDateColumnError(error));

  if (missingSaleDateColumn) {
    ({
      countResult: { count: totalPedidos, error: countError },
      sumResult: { data: sumData, error: sumError },
      dailyResult: { data: dailyData, error: dailyError },
      statusResult: { data: statusData, error: statusError },
      recentResult: { data: recentData, error: recentError },
    } = await runDashboardQueries(false));
  }

  if (countError || sumError || dailyError || statusError || recentError) {
    const error =
      countError || sumError || dailyError || statusError || recentError;
    return NextResponse.json(
      { erro: error?.message || "Falha ao carregar resumo do dashboard" },
      { status: 500 },
    );
  }

  let faturamento = 0;
  let lucro = 0;
  let salesCount = 0;
  for (const row of sumData || []) {
    if (isCancelledStatus(row.situacao)) continue;
    faturamento += row.total || 0;
    lucro += row.lucro || 0;
    salesCount += 1;
  }

  // 3. Vendas diárias
  const vendasDiariasMap: Record<string, number> = {};
  for (const row of dailyData || []) {
    if (isCancelledStatus(row.situacao)) continue;
    const key = saoPauloDayLabel(getOrderDate(row));
    if (!key) continue;
    vendasDiariasMap[key] = (vendasDiariasMap[key] || 0) + (row.total || 0);
  }
  const vendasDiarias = Object.entries(vendasDiariasMap)
    .sort((a, b) => {
      const [da, ma] = a[0].split("/").map(Number);
      const [db, mb] = b[0].split("/").map(Number);
      return ma === mb ? da - db : ma - mb;
    })
    .map(([dia, receita]) => ({
      dia,
      receita: Math.round(receita * 100) / 100,
    }));

  // 4. Status dos pedidos no período
  const statusCounts: Record<string, number> = {};
  for (const row of statusData || []) {
    const s = row.situacao || "aberto";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // 5. Pedidos recentes (últimos 5)
  const pedidosRecentes = (recentData || []).map((p: any) => ({
    numero: p.numero,
    cliente: p.contato_nome,
    total: p.total,
    situacao: p.situacao,
    data: getOrderDate(p),
  }));

  // 6. Top produtos: usa anuncios_ml.vendidos agregado por produto
  const { data: anunciosData } = await serviceClient
    .from("anuncios_ml")
    .select("titulo, vendidos, preco_ml")
    .order("vendidos", { ascending: false })
    .limit(5);

  const topProdutos = (anunciosData || [])
    .filter((a: any) => a.vendidos > 0)
    .map((a: any) => ({
      nome: a.titulo,
      vendas: a.vendidos,
      receita: Math.round(a.vendidos * a.preco_ml * 100) / 100,
    }))
    .slice(0, 5);

  // 7. Produtos ativos (independente de período)
  const { count: produtosAtivos } = await serviceClient
    .from("produtos")
    .select("*", { count: "exact", head: false })
    .range(0, 0)
    .eq("ml_status", "ativo");

  const { count: totalProdutos } = await serviceClient
    .from("produtos")
    .select("*", { count: "exact", head: false })
    .range(0, 0);

  const ticketMedio = salesCount > 0 ? faturamento / salesCount : 0;

  return NextResponse.json({
    faturamento: Math.round(faturamento * 100) / 100,
    lucro: Math.round(lucro * 100) / 100,
    totalPedidos: totalPedidos || 0,
    ticketMedio: Math.round(ticketMedio * 100) / 100,
    vendasDiarias,
    statusCounts,
    pedidosRecentes,
    topProdutos,
    produtosAtivos: produtosAtivos || 0,
    totalProdutos: totalProdutos || 0,
  });
}
