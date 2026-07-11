import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchML } from "@/services/integration";
import {
  getCategoryAttributes,
  predictCategory,
} from "@/services/mercadolibre";
import { calculateSuggestedPrice } from "@/services/pricing";
import {
  DEFAULT_ML_WARRANTY_TIME,
  DEFAULT_ML_WARRANTY_TYPE_ID,
  DEFAULT_ML_WARRANTY_TYPE_NAME,
} from "@/lib/ml-sale-terms";
import {
  applyProductFactsToMlAttribute,
  extractMlProductFacts,
} from "@/lib/ml-product-facts";
import {
  isMlCriticalAttributeId,
  resolveTrustedMlCriticalValue,
} from "@/lib/ml-critical-attributes";

function normalizeStr(v: unknown): string {
  return String(v ?? "").trim();
}

function isInvalidLiteralValue(v: unknown) {
  const txt = String(v ?? "")
    .trim()
    .toLowerCase();
  return (
    !txt ||
    txt === "null" ||
    txt === "undefined" ||
    txt === "n/a" ||
    txt === "na"
  );
}

function stripHtmlToText(input: unknown): string {
  return String(input ?? "")
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\s*\/p\s*>/gi, " ")
    .replace(/<\s*\/li\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescription(produto: any): string {
  const descricao = stripHtmlToText(produto?.descricao);
  if (descricao) return descricao;
  const title = stripHtmlToText(produto?.nome);
  const marca = normalizeStr(produto.marca);
  const gtin = normalizeStr(produto.gtin);
  return [
    `${title}${marca ? ` - ${marca}` : ""}`,
    "Produto original com envio rápido.",
    gtin ? `GTIN: ${gtin}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function supplierPartNumber(produto: any): string {
  const dsliteId = normalizeStr(produto.dslite_produto_id);
  const baseCode = dsliteId.match(/^(\d{5})\d{3}$/)?.[1];
  return baseCode || dsliteId || normalizeStr(produto.sku);
}

function pickAllowedValue(
  attr: any,
  valueName: string,
): { value_id?: string; value_name?: string } {
  const normalizeValue = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const hit = (attr.values || []).find(
    (v: any) => normalizeValue(v.name) === normalizeValue(valueName),
  );
  return hit
    ? { value_id: String(hit.id), value_name: String(hit.name) }
    : { value_name: valueName };
}

function initialAttributeValue(
  attr: any,
  produto: any,
): { value_id?: string; value_name?: string } {
  const attrId = String(attr.id || "").toUpperCase();
  if (attrId === "PART_NUMBER")
    return { value_name: supplierPartNumber(produto) };
  if (attrId === "BRAND" && normalizeStr(produto.marca))
    return { value_name: produto.marca };
  if (attrId === "MODEL" && normalizeStr(produto.nome))
    return { value_name: produto.nome.slice(0, 60) };
  if (attrId === "ITEM_CONDITION")
    return { value_id: "2230284", value_name: "Novo" };
  if (attrId === "GTIN" && normalizeStr(produto.gtin))
    return { value_name: produto.gtin };
  if (attrId === "SELLER_SKU" && normalizeStr(produto.sku))
    return { value_name: produto.sku };
  if (attrId === "SELLER_PACKAGE_HEIGHT" && produto.altura)
    return { value_name: `${produto.altura} cm` };
  if (attrId === "SELLER_PACKAGE_WIDTH" && produto.largura)
    return { value_name: `${produto.largura} cm` };
  if (attrId === "SELLER_PACKAGE_LENGTH" && produto.profundidade)
    return { value_name: `${produto.profundidade} cm` };
  if (attrId === "SELLER_PACKAGE_WEIGHT" && produto.peso_bruto)
    return { value_name: `${Math.round(Number(produto.peso_bruto) * 1000)} g` };
  return {};
}

function applyRuleBasedAttributeValue(
  attr: any,
  produto: any,
): { value_id?: string; value_name?: string } {
  const facts = extractMlProductFacts(produto);
  const factSuggestion = applyProductFactsToMlAttribute(attr, facts);
  if (factSuggestion?.value_name) {
    const normalizeValue = (v: unknown) =>
      String(v ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const values = Array.isArray(attr.values) ? attr.values : [];
    const hit = values.find(
      (v: any) =>
        normalizeValue(v.name) === normalizeValue(factSuggestion.value_name),
    );
    if (hit) return { value_id: String(hit.id), value_name: String(hit.name) };
    if (values.length > 0) return {};
    return factSuggestion;
  }

  const attrId = String(attr.id || "").toUpperCase();
  const haystack =
    `${produto?.nome || ""} ${produto?.descricao || ""} ${produto?.categoria || ""}`.toLowerCase();

  if (attrId === "VEHICLE_TYPE") {
    if (
      /\b(?:caminh|onibus|ônibus|scania|volvo|cargo|f-?4000|linha\s*pesada)\b/i.test(
        haystack,
      )
    )
      return pickAllowedValue(attr, "Linha Pesada");
    return pickAllowedValue(attr, "Carro/Caminhonete");
  }
  if (attrId === "WRENCH_TYPE") {
    if (/\bchave\b/i.test(haystack)) return pickAllowedValue(attr, "Flat");
  }

  if (
    String(produto?.fornecedor || "")
      .toLowerCase()
      .includes("aurium") ||
    String(produto?.dslite_fornecedor_id || "") === "100"
  ) {
    if (attrId === "PRODUCT_TYPE") {
      if (/condicionador/i.test(haystack))
        return { value_id: "6081794", value_name: "Condicionador" };
      if (/shampoo/i.test(haystack))
        return { value_id: "6081793", value_name: "Shampoo" };
    }
    if (attrId === "CARE_TYPES") {
      return { value_name: "Higiene e cuidado dos pelos" };
    }
    if (attrId === "IS_FLAMMABLE" && !/aerosol|spray/i.test(haystack)) {
      return { value_id: "242084", value_name: "Não" };
    }
  }

  if (attrId === "RECOMMENDED_INSTRUMENT" && haystack.includes("contrabaixo")) {
    return { value_name: "Contrabaixo" };
  }
  if (
    (attrId === "STRING_NUMBER" || attrId === "NUMBER_OF_STRINGS") &&
    /\b4\s*cordas?\b/i.test(haystack)
  ) {
    return { value_name: "4" };
  }
  if (attrId === "UNITS_PER_PACK") {
    return {};
  }
  if (
    attrId === "STRING_GAUGE" ||
    attrId === "GAUGE" ||
    attrId === "GAUGES" ||
    attrId === "CALIBER"
  ) {
    const range = haystack.match(/\.?0?\d{2,3}\s*(?:[-–/]|a)\s*\.?0?\d{2,3}/i);
    if (range?.[0]) {
      const numbers = range[0].match(/0?\d{2,3}/g) || [];
      const firstGauge = numbers[0] || "";
      const lastGauge = numbers[1] || "";
      return {
        value_name:
          numbers.length >= 2
            ? `.${firstGauge.replace(/^0+/, "").padStart(3, "0")} - .${lastGauge.replace(/^0+/, "").padStart(3, "0")}`
            : range[0].replace(/\s+/g, " "),
      };
    }
  }
  if (
    attrId === "MATERIALS" &&
    /(a[cç]o|niquel|níquel|metal)/i.test(haystack)
  ) {
    const metalValue = (attr.values || []).find(
      (v: any) => String(v.name || "").toLowerCase() === "metal",
    );
    return metalValue
      ? { value_id: String(metalValue.id), value_name: String(metalValue.name) }
      : { value_name: "Aço niquelado" };
  }
  if (attrId === "LINE") {
    if (/extra\s*(light|leve)/i.test(haystack))
      return { value_name: "Extra Light" };
    if (/super\s*(light|leve)/i.test(haystack))
      return { value_name: "Super Light" };
    if (/\b(light|leve)\b/i.test(haystack)) return { value_name: "Light" };
    if (/\b(medium|m[eé]dia)\b/i.test(haystack))
      return { value_name: "Medium" };
    if (/\b(heavy|pesada)\b/i.test(haystack)) return { value_name: "Heavy" };
  }
  if (attrId === "TENSION") {
    if (/extra\s*(light|leve)/i.test(haystack))
      return { value_name: "Extra Light" };
    if (/\b(light|leve)\b/i.test(haystack)) return { value_name: "Light" };
    if (/\b(medium|m[eé]dia)\b/i.test(haystack)) return { value_name: "Média" };
    if (/\b(high|alta)\b/i.test(haystack)) return { value_name: "Alta" };
  }

  return {};
}

async function predictionAttributes(
  categoriaId: string,
  produto: any,
): Promise<Map<string, { value_id?: string; value_name?: string }>> {
  const title = produto?.marca
    ? `${produto.nome} ${produto.marca}`
    : produto?.nome;
  const predictions = await predictCategory(String(title || ""), 5).catch(
    () => null,
  );
  const match = (predictions || []).find(
    (p) => String(p.category_id) === String(categoriaId),
  );
  const result = new Map<string, { value_id?: string; value_name?: string }>();
  for (const attr of match?.attributes || []) {
    result.set(String(attr.id).toUpperCase(), {
      value_id: attr.value_id ? String(attr.value_id) : undefined,
      value_name: attr.value_name ? String(attr.value_name) : undefined,
    });
  }
  return result;
}

function normalizeBase(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickWarrantyDefaultValueId(
  values: Array<{ id: string; name: string }>,
): string | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const by12 = values.find((v) => normalizeBase(v.name).includes("12"));
  if (by12) return String(by12.id);
  return String(values[0].id);
}

function extractMlFee(listingPrices: any): number | null {
  const fee = Number(
    listingPrices?.sale_fee_details?.percentage_fee ??
      listingPrices?.sale_fee_details?.meli_percentage_fee,
  );
  if (!Number.isFinite(fee) || fee <= 0) return null;
  return fee / 100;
}

export async function POST(req: Request) {
  try {
    const {
      produtoId,
      categoriaId,
      listingType = "gold_pro",
    } = await req.json();
    if (!produtoId || !categoriaId) {
      return NextResponse.json(
        { error: "produtoId e categoriaId são obrigatórios" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from("produtos")
      .select("*")
      .eq("id", produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 },
      );
    }

    const { data: supplierOffers } = await supabase
      .from("produto_fornecedor_ofertas")
      .select(
        "id,produto_id,nome,descricao,custo,estoque,prioridade,ativo,last_sync_at",
      )
      .eq("produto_id", produtoId);

    const attrs = (await getCategoryAttributes(categoriaId)) || [];
    const requiredAttributes = attrs.filter(
      (a: any) =>
        (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed,
    );
    const optionalAttributes = attrs.filter(
      (a: any) =>
        !(a.tags?.required || a.tags?.catalog_required) && !a.tags?.hidden,
    );

    const me = await fetchML<any>("/users/me");
    const categoryInfo = await fetchML<any>(`/categories/${categoriaId}`);
    const saleTermsRaw = (categoryInfo?.sale_terms || []) as any[];

    let suggestedPrice = 0;
    try {
      const cost = Number(produto.custo || 0);
      const shipping = Number(produto.ml_shipping || 0);
      let mlFee = Number(produto.ml_fee || 0.15);
      const provisional = calculateSuggestedPrice({
        cost,
        shipping,
        mlFee,
      });
      const listingPrices = await fetchML<any>(
        `/sites/MLB/listing_prices?price=${provisional.suggestedPrice}&category_id=${categoriaId}&listing_type_id=${listingType}`,
      );
      mlFee = extractMlFee(listingPrices) ?? mlFee;
      const pricing = calculateSuggestedPrice({ cost, shipping, mlFee });
      suggestedPrice = Number(produto.custom_price ?? pricing.suggestedPrice);
    } catch {
      suggestedPrice = Number(produto.custom_price ?? produto.custo ?? 0);
    }

    const predictionByAttr = await predictionAttributes(categoriaId, produto);

    const prefillAttributes = attrs.map((attr: any) => {
      const attrId = String(attr.id || "").toUpperCase();
      const trustedCriticalValue = isMlCriticalAttributeId(attrId)
        ? resolveTrustedMlCriticalValue(attrId, produto, supplierOffers || [])
        : null;
      const pre = isMlCriticalAttributeId(attrId)
        ? trustedCriticalValue
          ? pickAllowedValue(attr, trustedCriticalValue)
          : {}
        : {
            ...initialAttributeValue(attr, produto),
            ...applyRuleBasedAttributeValue(attr, produto),
            ...(predictionByAttr.get(attrId) || {}),
          };
      if (isInvalidLiteralValue(pre.value_name) && !pre.value_id) {
        delete pre.value_name;
      }
      return {
        id: attr.id,
        name: attr.name,
        value_type: attr.value_type,
        required: Boolean(attr.tags?.required || attr.tags?.catalog_required),
        values: (attr.values || [])
          .slice(0, 100)
          .map((v: any) => ({ id: v.id, name: v.name })),
        ...pre,
      };
    });

    const saleTerms = saleTermsRaw.map((term: any) => {
      const values = (term.values || [])
        .slice(0, 100)
        .map((v: any) => ({ id: v.id, name: v.name }));
      if (term.id === "WARRANTY_TIME") {
        const defaultId = pickWarrantyDefaultValueId(values);
        if (defaultId) {
          const selected = values.find(
            (v: { id: string; name: string }) => String(v.id) === defaultId,
          );
          return {
            id: term.id,
            name: term.name,
            value_type: term.value_type || "string",
            required: Boolean(term.tags?.required),
            values,
            value_id: defaultId,
            value_name: selected?.name || undefined,
          };
        }
        return {
          id: term.id,
          name: term.name,
          value_type: term.value_type || "string",
          required: Boolean(term.tags?.required),
          values,
          value_name: DEFAULT_ML_WARRANTY_TIME,
        };
      }
      return {
        id: term.id,
        name: term.name,
        value_type: term.value_type || "string",
        required: Boolean(term.tags?.required),
        values,
      };
    });

    const hasWarrantyType = saleTerms.some((t) => t.id === "WARRANTY_TYPE");
    if (!hasWarrantyType) {
      saleTerms.push({
        id: "WARRANTY_TYPE",
        name: "Tipo de garantia",
        value_type: "list",
        required: false,
        values: [
          {
            id: DEFAULT_ML_WARRANTY_TYPE_ID,
            name: DEFAULT_ML_WARRANTY_TYPE_NAME,
          },
        ],
        value_id: DEFAULT_ML_WARRANTY_TYPE_ID,
        value_name: DEFAULT_ML_WARRANTY_TYPE_NAME,
      });
    }

    const hasWarrantyTime = saleTerms.some((t) => t.id === "WARRANTY_TIME");
    if (!hasWarrantyTime) {
      saleTerms.push({
        id: "WARRANTY_TIME",
        name: "Tempo de garantia",
        value_type: "number_unit",
        required: false,
        values: [],
        value_name: DEFAULT_ML_WARRANTY_TIME,
      });
    }

    return NextResponse.json({
      success: true,
      schema: {
        required_attributes: prefillAttributes.filter((a) => a.required),
        optional_attributes: prefillAttributes.filter((a) => !a.required),
        sale_terms: saleTerms,
        fiscal_fields: {
          ncm: produto.ncm || "",
          cest: produto.cest || "",
          gtin: produto.gtin || "",
          origem_fiscal: produto.origem_fiscal || "0",
          csosn: produto.csosn || "",
        },
        prefill: {
          description: buildDescription(produto),
          base_price: Math.round(suggestedPrice * 100) / 100,
          listing_type: listingType,
          seller_id: me?.id || null,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Erro ao montar schema" },
      { status: 500 },
    );
  }
}
