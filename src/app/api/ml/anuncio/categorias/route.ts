import { NextResponse } from "next/server";
import type { MLCategoryPrediction } from "@/services/mercadolibre";
import {
  getCategoryAttributes,
  predictCategory,
} from "@/services/mercadolibre";
import { createServiceClient } from "@/lib/supabase";
import {
  filterPetShopPredictions,
  assertAllowedMlCategoryForProduct,
  getPreferredHayamaxCategoryForProduct,
  getPreferredPetCategoryForTitle,
  isBlockedMlBrand,
  requiresPetShopCategory,
} from "@/lib/ml-category-guard";

function uniquePredictions(predictions: any[]) {
  const seen = new Set<string>();
  return predictions.filter((prediction) => {
    const categoryId = String(prediction?.category_id || "");
    if (!categoryId || seen.has(categoryId)) return false;
    seen.add(categoryId);
    return true;
  });
}

function normalizePredictionText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPredictionTitles(produto: {
  nome?: string | null;
  marca?: string | null;
}) {
  const rawName = normalizePredictionText(produto?.nome);
  const brand = normalizePredictionText(produto?.marca);
  const titles = new Set<string>();

  const add = (value: string) => {
    const text = normalizePredictionText(value);
    if (text) titles.add(text.slice(0, 60));
  };

  add(brand ? `${rawName} ${brand}` : rawName);

  const compactBattery = rawName
    .replace(/\b(\d+)\s*cr\s*(\d{3,4})\b/gi, "CR$2")
    .replace(/\b(\d+)\s*lr\s*(\d{2,4})\b/gi, "LR$2")
    .replace(/\b(\d+)\s*sr\s*(\d{2,4})\b/gi, "SR$2");
  add(brand ? `${compactBattery} ${brand}` : compactBattery);

  const cleanedName = rawName
    .replace(/\b(?:grl|std|s\.t\.d|picker)\b/gi, " ")
    .replace(/\b[a-z]{1,4}-?[a-z0-9]{3,}\b/gi, " ")
    .replace(/\br\d{4,}\b/gi, " ")
    .replace(/\b\d+\s*(?:un|und|unid|unidade|cart|cartela|kit)\b/gi, " ")
    .replace(/\(([^)]+)\)/g, " $1 ");
  add(brand ? `${cleanedName} ${brand}` : cleanedName);

  if (/\bpalheta\b/i.test(rawName)) {
    const palhetaTitle = cleanedName.replace(/\bpalheta\b/i, "Palheta para guitarra");
    add(brand ? `${palhetaTitle} ${brand}` : palhetaTitle);
  }

  if (/\b(?:cr|lr|sr)\d{2,4}\b/i.test(compactBattery) && !/\bbateria\b/i.test(compactBattery)) {
    add(`${compactBattery.replace(/\bpilha\b/i, "Bateria")}${brand ? ` ${brand}` : ""}`);
  }

  return Array.from(titles);
}

async function predictCategoryWithFallbacks(
  produto: { nome?: string | null; marca?: string | null },
  limit: number,
) {
  const predictions: MLCategoryPrediction[] = [];
  for (const title of buildPredictionTitles(produto)) {
    const current = await predictCategory(title, limit);
    if (Array.isArray(current) && current.length > 0) {
      predictions.push(...current);
    }
  }
  return uniquePredictions(predictions);
}

export async function POST(req: Request) {
  try {
    const { produtoId } = await req.json();
    if (!produtoId) {
      return NextResponse.json(
        { error: "produtoId é obrigatório" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from("produtos")
      .select("sku, nome, marca, categoria, fornecedor, dslite_fornecedor_id")
      .eq("id", produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 },
      );
    }

    if (isBlockedMlBrand(produto)) {
      return NextResponse.json(
        { error: "Marca Wahl bloqueada para anúncios Mercado Livre." },
        { status: 422 },
      );
    }

    const predictionTitles = buildPredictionTitles(produto);
    const titulo = predictionTitles[0] || produto.nome.substring(0, 60);

    const preferredPetCategory = requiresPetShopCategory(produto)
      ? getPreferredPetCategoryForTitle(titulo)
      : null;
    const preferredPetPrediction: MLCategoryPrediction[] = preferredPetCategory
      ? [
          {
            category_id: preferredPetCategory.id,
            category_name: preferredPetCategory.name,
            domain_id: "",
            domain_name: "Pet Shop",
            attributes: [],
          },
        ]
      : [];
    const preferredHayamaxCategory =
      getPreferredHayamaxCategoryForProduct(produto);
    const preferredHayamaxPrediction: MLCategoryPrediction[] =
      preferredHayamaxCategory
        ? [
            {
              category_id: preferredHayamaxCategory.id,
              category_name: preferredHayamaxCategory.name,
              domain_id: "",
              domain_name: "Hayamax category guard",
              attributes: [],
            },
          ]
        : [];
    const basePredictions = await predictCategoryWithFallbacks(produto, 8);
    const rawPredictions = requiresPetShopCategory(produto)
      ? await filterPetShopPredictions(
          uniquePredictions([
            ...preferredPetPrediction,
            ...(basePredictions || []),
            ...((await predictCategory(`${titulo} pet cachorro gato`, 8)) ||
              []),
          ]),
        )
      : uniquePredictions([
          ...preferredHayamaxPrediction,
          ...(basePredictions || []),
        ]);
    const predictions: MLCategoryPrediction[] = [];
    for (const prediction of rawPredictions || []) {
      try {
        await assertAllowedMlCategoryForProduct(
          produto,
          prediction.category_id,
        );
        predictions.push(prediction);
      } catch {
        // Categoria incompatível com guardrails locais; não expor para criação.
      }
    }

    if (!predictions || predictions.length === 0) {
      return NextResponse.json(
        { error: "Não foi possível prever a categoria" },
        { status: 502 },
      );
    }

    const categorias = await Promise.all(
      predictions.map(async (p) => {
        const attrs = await getCategoryAttributes(p.category_id);
        const requiredAttributes = (attrs || [])
          .filter(
            (a) =>
              (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed,
          )
          .map((a) => ({
            id: a.id,
            name: a.name,
            value_type: a.value_type,
            values: (a.values || [])
              .slice(0, 50)
              .map((v) => ({ id: v.id, name: v.name })),
          }));

        return {
          id: p.category_id,
          nome: p.category_name,
          dominio: p.domain_name,
          attributes: p.attributes,
          requiredAttributes,
        };
      }),
    );

    return NextResponse.json({
      produto: { id: produtoId, nome: produto.nome, sku: produto.sku },
      tituloSugerido: titulo,
      categorias,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
