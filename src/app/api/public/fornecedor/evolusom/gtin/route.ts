import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidGtin, normalizeGtin } from "@/lib/gtin";
import {
  EVOLUSOM_DSLITE_SUPPLIER_ID,
} from "@/lib/public-evolusom-gtin";
import { verifyPublicEvolusomGtinToken } from "@/lib/public-evolusom-gtin-links";
import { createServiceClient } from "@/lib/supabase";

const bodySchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^VTK\d+$/),
  gtin: z.string().trim().min(1).max(32),
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos. Confira SKU e GTIN." },
      { status: 422 },
    );
  }

  const { sku, token, expiresAt } = parsed.data;
  const gtin = normalizeGtin(parsed.data.gtin);

  if (!verifyPublicEvolusomGtinToken(token, expiresAt)) {
    return NextResponse.json(
      { error: "Link inválido ou expirado" },
      { status: 403 },
    );
  }
  if (!isValidGtin(gtin)) {
    return NextResponse.json(
      {
        error:
          "GTIN inválido. Informe 8, 12, 13 ou 14 dígitos, incluindo o dígito verificador.",
      },
      { status: 422 },
    );
  }

  const client = createServiceClient();
  const { data: product, error: productError } = await client
    .from("produtos")
    .select(
      "id,sku,gtin,ml_item_id,ml_status,oferta_preferencial_id,dslite_fornecedor_id,ativo,updated_at",
    )
    .eq("sku", sku)
    .maybeSingle();

  if (productError) {
    return NextResponse.json(
      { error: "Falha ao localizar produto" },
      { status: 500 },
    );
  }
  if (!product) {
    return NextResponse.json(
      { error: "Produto não encontrado" },
      { status: 404 },
    );
  }
  if (
    !product.ativo ||
    String(product.dslite_fornecedor_id || "") !==
      EVOLUSOM_DSLITE_SUPPLIER_ID ||
    String(product.ml_status || "") !== "sem_anuncio" ||
    String(product.ml_item_id || "").trim() ||
    String(product.gtin || "").trim()
  ) {
    return NextResponse.json(
      { error: "Produto não está mais elegível para cadastrar GTIN" },
      { status: 409 },
    );
  }

  const { data: offer, error: offerError } = await client
    .from("produto_fornecedor_ofertas")
    .select(
      "id,dslite_fornecedor_id,estoque,ativo,gtin,updated_at",
    )
    .eq("id", String(product.oferta_preferencial_id || ""))
    .eq("dslite_fornecedor_id", EVOLUSOM_DSLITE_SUPPLIER_ID)
    .maybeSingle();
  if (offerError) {
    return NextResponse.json(
      { error: "Falha ao validar oferta da Evolusom" },
      { status: 500 },
    );
  }
  if (!offer || !offer.ativo || Number(offer.estoque || 0) <= 0) {
    return NextResponse.json(
      { error: "Produto sem oferta Evolusom ativa e disponível" },
      { status: 409 },
    );
  }

  const [
    { data: linkedListing, error: listingError },
    { data: duplicateProduct, error: duplicateError },
  ] = await Promise.all([
    client
      .from("anuncios_ml")
      .select("id")
      .eq("produto_id", product.id)
      .not("ml_item_id", "is", null)
      .limit(1)
      .maybeSingle(),
    client
      .from("produtos")
      .select("id,sku")
      .eq("gtin", gtin)
      .neq("id", product.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (listingError || duplicateError) {
    return NextResponse.json(
      { error: "Falha ao validar GTIN" },
      { status: 500 },
    );
  }
  if (linkedListing) {
    return NextResponse.json(
      { error: "Produto já possui anúncio vinculado" },
      { status: 409 },
    );
  }
  if (duplicateProduct) {
    return NextResponse.json(
      {
        error: `GTIN já cadastrado no produto ${duplicateProduct.sku}`,
      },
      { status: 409 },
    );
  }

  const { data: updatedProduct, error: updateError } = await client
    .from("produtos")
    .update({ gtin })
    .eq("id", product.id)
    .eq("updated_at", product.updated_at)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { error: "Falha ao salvar GTIN" },
      { status: 500 },
    );
  }
  if (!updatedProduct) {
    return NextResponse.json(
      {
        error:
          "Produto foi alterado durante o cadastro. Atualize a página e tente novamente.",
      },
      { status: 409 },
    );
  }

  const { error: offerUpdateError } = await client
    .from("produto_fornecedor_ofertas")
    .update({ gtin })
    .eq("id", offer.id)
    .eq("updated_at", offer.updated_at);

  if (offerUpdateError) {
    console.error("[public.evolusom.gtin] offer mirror failed", {
      product_id: product.id,
      sku,
      offer_id: offer.id,
      error: offerUpdateError.message,
    });
  }

  console.info("[public.evolusom.gtin] saved", {
    product_id: product.id,
    sku,
    offer_id: offer.id,
  });

  return NextResponse.json({ success: true, sku, gtin });
}
