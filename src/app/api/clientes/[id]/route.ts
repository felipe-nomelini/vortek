import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

function isMissingSaleDateColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = createServiceClient();

    // 1. Buscar cliente
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", params.id)
      .single();

    if (clienteError || !cliente) {
      return NextResponse.json(
        { error: clienteError?.message || "Cliente não encontrado" },
        { status: clienteError ? 500 : 404 },
      );
    }

    // 2. Buscar pedidos do cliente (match por nickname nos parênteses do contato_nome)
    const nickname = cliente.ml_nickname;
    let pedidos: any[] = [];
    if (nickname) {
      let pedidosQuery = supabase
        .from("pedidos")
        .select("*")
        .ilike("contato_nome", `%(${nickname})%`)
        .order("data_venda", { ascending: false, nullsFirst: false })
        .order("data", { ascending: false });

      let { data: pedidosData, error: pedidosError } = await pedidosQuery;

      if (isMissingSaleDateColumnError(pedidosError)) {
        ({ data: pedidosData, error: pedidosError } = await supabase
          .from("pedidos")
          .select("*")
          .ilike("contato_nome", `%(${nickname})%`)
          .order("data", { ascending: false }));
      }

      if (pedidosError) {
        return NextResponse.json(
          { error: pedidosError.message },
          { status: 500 },
        );
      }

      pedidos = (pedidosData || []).map((pedido: any) => ({
        ...pedido,
        data: pedido.data_venda || pedido.data || null,
      }));
    }

    return NextResponse.json({
      cliente,
      pedidos,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    const updateData: Record<string, any> = {};
    if ("email" in body) updateData.email = body.email;
    if ("telefone" in body) updateData.telefone = body.telefone;

    const { data, error } = await supabase
      .from("clientes")
      .update(updateData as any)
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
