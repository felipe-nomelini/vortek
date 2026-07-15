import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { verifyPublicBkr1KitToken } from "@/lib/public-bkr1-kit-links";

function normalizeGtin(value: unknown) {
  return String(value || "").replace(/[\s-]/g, "");
}

function isValidGtin(gtin: string) {
  if (!/^(?:\d{8}|\d{10}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const checkDigit = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sku = String(body?.sku || "").trim().toUpperCase();
  const gtin = normalizeGtin(body?.gtin);
  const token = typeof body?.token === "string" ? body.token : null;
  const expiresAt = typeof body?.expiresAt === "string" ? body.expiresAt : null;

  if (!verifyPublicBkr1KitToken(token, expiresAt)) {
    return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 403 });
  }
  if (!/^VTK\d+$/.test(sku) || !isValidGtin(gtin)) {
    return NextResponse.json({ error: "Informe um GTIN válido (8, 10, 12, 13 ou 14 dígitos)." }, { status: 422 });
  }

  const client = createServiceClient();
  const { data: produto, error: produtoError } = await client
    .from("produtos")
    .select("id,sku,ml_item_id")
    .eq("sku", sku)
    .eq("fornecedor", "BKR1")
    .eq("ativo", true)
    .is("ml_item_id", null)
    .maybeSingle();
  if (produtoError) return NextResponse.json({ error: "Falha ao localizar produto" }, { status: 500 });
  if (!produto) return NextResponse.json({ error: "Kit pendente não encontrado" }, { status: 404 });

  const { data: kit, error: kitError } = await (client as any)
    .from("produto_kits")
    .select("produto_id")
    .eq("produto_id", produto.id)
    .eq("ativo", true)
    .maybeSingle();
  if (kitError) return NextResponse.json({ error: "Falha ao validar kit" }, { status: 500 });
  if (!kit) return NextResponse.json({ error: "Produto não é kit BKR1 elegível" }, { status: 422 });

  const { error: updateError } = await client.from("produtos").update({ gtin }).eq("id", produto.id);
  if (updateError) return NextResponse.json({ error: "Falha ao salvar GTIN" }, { status: 500 });

  return NextResponse.json({ success: true, sku, gtin });
}
