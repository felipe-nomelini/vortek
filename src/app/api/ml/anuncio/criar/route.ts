import { NextResponse } from "next/server";

export const maxDuration = 300;

import {
  createListing,
  getCategoryAttributes,
  searchItemBySellerSku,
  setItemQuantityPricing,
  updateListingFiscalData,
  upsertListingDescription,
} from "@/services/mercadolibre";
import { fetchML, fetchMLResult } from "@/services/integration";
import { calculateSuggestedPrice } from "@/services/pricing";
import { createServiceClient } from "@/lib/supabase";
import {
  fiscalStrictSchema,
  mapOriginType,
  normalizeNcm,
} from "@/lib/fiscal-strict";
import {
  DEFAULT_ML_WARRANTY_TIME,
  normalizeMlSaleTerms,
  normalizeMlWarrantyTime,
} from "@/lib/ml-sale-terms";
import { enqueueMlPublishOutbox } from "@/lib/sync/ml-publish-outbox";
import { assertAllowedMlCategoryForProduct } from "@/lib/ml-category-guard";
import {
  isMlCriticalAttributeId,
  normalizeCriticalAttributeValue,
  resolveTrustedMlCriticalValue,
} from "@/lib/ml-critical-attributes";
import { persistSingleAnuncioBySku } from "@/lib/ml/persist-single-anuncio";
import { resolveGtinForMlListing } from "@/lib/produto-kits";

type StepResult = { ok: boolean; error?: string };
type AttrInput = { id: string; value_name?: string; value_id?: string };
type SaleTermInput = { id: string; value_name?: string; value_id?: string };
type MappedAttr = { id: string; value_name?: string; value_id?: string };

const NOT_APPLICABLE_ID = "-1";
const NO_IDS = new Set(["242084"]);

function normalizeText(input: unknown) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAttrText(input: unknown) {
  return normalizeText(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripVariantFragments(input: unknown) {
  return normalizeText(input)
    .replace(
      /\b(?:cor|color)\s*:\s*[^;,|]+(?:\s*[;,|]\s*(?:(?:tamanho|tam|size)\s*:)?[^;,|]+)?/gi,
      " ",
    )
    .replace(/\b(?:tamanho|tam|size)\s*:\s*[^;,|]+/gi, " ")
    .replace(/[;,|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendTitlePart(parts: string[], value: unknown) {
  const text = normalizeText(value);
  if (!text) return;
  const normalized = normalizeAttrText(text);
  if (!normalized || normalized === "u") return;
  if (parts.some((part) => normalizeAttrText(part) === normalized)) return;
  parts.push(text);
}

function stripWordFragment(input: string, fragment: unknown) {
  const text = normalizeText(fragment);
  if (!text) return input;
  return input
    .replace(
      new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stripTextPattern(input: string, pattern: RegExp) {
  return input.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

function stripColorVariants(input: string, color: unknown) {
  const normalized = normalizeAttrText(color);
  let next = input;
  if (normalized === "preto") next = stripTextPattern(next, /\bpret[ao]s?\b/gi);
  if (normalized === "branco")
    next = stripTextPattern(next, /\bbranc[ao]s?\b/gi);
  if (normalized === "vermelho")
    next = stripTextPattern(next, /\bvermelh[ao]s?\b/gi);
  if (normalized === "cinza") next = stripTextPattern(next, /\bcinzas?\b/gi);
  if (normalized === "grafite")
    next = stripTextPattern(next, /\bgrafites?\b/gi);
  return next;
}

function stripPositionVariants(input: string, position: unknown) {
  const normalized = normalizeAttrText(position);
  let next = input;
  if (normalized.includes("dianteira") && normalized.includes("traseira")) {
    next = stripTextPattern(
      next,
      /\b(?:diant(?:eira)?|dian)\s*[\\/-]?\s*(?:tras(?:eira)?|traseira)\b/gi,
    );
    next = stripTextPattern(
      next,
      /\b(?:dianteira|traseira)\s*[\\/-]\s*(?:dianteira|traseira)\b/gi,
    );
  } else if (normalized === "dianteira") {
    next = stripTextPattern(next, /\b(?:diant(?:eira)?|dian)\b/gi);
  } else if (normalized === "traseira") {
    next = stripTextPattern(next, /\b(?:tras(?:eira)?|traseira)\b/gi);
  }
  return next;
}

function stripAutoAppendedAttributeFragments(
  input: string,
  attributesMap: Map<string, MappedAttr>,
) {
  let next = input;
  for (const attrId of ["POSITION", "COLOR", "SIZE"]) {
    next = stripWordFragment(next, attributesMap.get(attrId)?.value_name);
  }
  next = stripColorVariants(next, attributesMap.get("COLOR")?.value_name);
  next = stripPositionVariants(next, attributesMap.get("POSITION")?.value_name);
  return next || input;
}

function truncateListingName(input: string, maxLength = 60) {
  let text = normalizeText(input);
  if (text.length <= maxLength) return text;
  text = text
    .slice(0, maxLength)
    .replace(/\s+\S*$/, "")
    .trim();
  text = text
    .replace(/\b(?:compat[ií]vel|para|com|de|do|da|dos|das|e|ou)$/i, "")
    .replace(/[-/,;:]+$/g, "")
    .trim();
  return text || normalizeText(input).slice(0, maxLength).trim();
}

function buildListingNames(params: {
  productName: unknown;
  brand: unknown;
  attributesMap: Map<string, MappedAttr>;
}) {
  const baseName =
    stripVariantFragments(params.productName) ||
    normalizeText(params.productName);
  const brand = normalizeText(params.brand);
  const familyName = truncateListingName(
    stripAutoAppendedAttributeFragments(baseName, params.attributesMap),
  );

  const titleParts = [baseName];
  appendTitlePart(titleParts, params.attributesMap.get("COLOR")?.value_name);
  appendTitlePart(titleParts, params.attributesMap.get("SIZE")?.value_name);
  if (
    brand &&
    !titleParts.some((part) =>
      normalizeAttrText(part).includes(normalizeAttrText(brand)),
    )
  ) {
    titleParts.push(brand);
  }

  return {
    title: titleParts.join(" ").substring(0, 60).trim(),
    familyName,
  };
}

function isInvalidLiteralValue(input: unknown) {
  const txt = normalizeAttrText(input);
  return (
    !txt ||
    txt === "null" ||
    txt === "undefined" ||
    txt === "n/a" ||
    txt === "na"
  );
}

function normalizeAttr(attr: AttrInput) {
  return {
    id: String(attr.id),
    value_id: isInvalidLiteralValue(attr.value_id)
      ? undefined
      : String(attr.value_id),
    value_name: isInvalidLiteralValue(attr.value_name)
      ? undefined
      : String(attr.value_name),
  };
}

function hasValue(attr: { value_name?: string; value_id?: string }) {
  return Boolean(
    (attr.value_id && String(attr.value_id).trim()) ||
    (attr.value_name && String(attr.value_name).trim()),
  );
}

function normalizeChartDomain(domainId: unknown) {
  return String(domainId || "")
    .replace(/^MLB-/, "")
    .trim();
}

async function findFashionSizeGrid(params: {
  categoryInfo: any;
  attributesMap: Map<string, MappedAttr>;
}): Promise<{ gridId: string; rowId: string | null } | null> {
  const domainId = normalizeChartDomain(
    params.categoryInfo?.settings?.catalog_domain,
  );
  const brand = params.attributesMap.get("BRAND");
  const gender = params.attributesMap.get("GENDER");
  const brandName = normalizeText(brand?.value_name);
  const genderValue = {
    ...(gender?.value_id ? { id: String(gender.value_id) } : {}),
    ...(gender?.value_name ? { name: String(gender.value_name) } : {}),
  };

  if (!domainId || !brandName || (!genderValue.id && !genderValue.name))
    return null;

  const me = await fetchML<any>("/users/me?attributes=id");
  const sellerId = Number(me?.id);
  if (!Number.isFinite(sellerId) || sellerId <= 0) return null;

  const result = await fetchMLResult<any>("/catalog/charts/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-caller-id": String(sellerId),
    },
    body: JSON.stringify({
      seller_id: sellerId,
      site_id: "MLB",
      domain_id: domainId,
      attributes: [
        { id: "GENDER", values: [genderValue] },
        { id: "BRAND", values: [{ name: brandName }] },
      ],
    }),
  });

  if (!result.ok) {
    console.warn(
      JSON.stringify({
        event: "ml_size_grid_search_failed",
        domain_id: domainId,
        brand: brandName,
        status: result.status,
        error: result.error?.message || null,
      }),
    );
    return null;
  }

  const chart = Array.isArray(result.data?.charts)
    ? result.data.charts[0]
    : null;
  if (!chart?.id) return null;

  let rowId: string | null = null;
  const chartDetails = await fetchMLResult<any>(
    `/catalog/charts/${encodeURIComponent(String(chart.id))}`,
    {
      headers: { "x-caller-id": String(sellerId) },
    },
  );
  if (chartDetails.ok && Array.isArray(chartDetails.data?.rows)) {
    const size = normalizeAttrText(
      params.attributesMap.get("SIZE")?.value_name,
    );
    const row = chartDetails.data.rows.find((candidate: any) => {
      const attrs = Array.isArray(candidate?.attributes)
        ? candidate.attributes
        : [];
      const rowSize = attrs.find((attr: any) => String(attr?.id) === "SIZE");
      const value =
        rowSize?.values?.[0]?.name || rowSize?.values?.[0]?.id || "";
      return !size || normalizeAttrText(value) === size;
    });
    if (row?.id) rowId = String(row.id);
  }

  if (!rowId) return null;

  return { gridId: String(chart.id), rowId };
}

function isNotApplicableLabel(input: unknown) {
  const txt = normalizeAttrText(input);
  return (
    txt.includes("nao se aplica") ||
    txt.includes("nao aplicavel") ||
    txt === "n/a"
  );
}

function isGoldPlatedText(input: unknown) {
  const txt = normalizeAttrText(input);
  return (
    txt.includes("ouro") &&
    (txt.includes("banhado") ||
      txt.includes("banhada") ||
      txt.includes("folheado") ||
      txt.includes("folheada") ||
      txt.includes("banho de ouro"))
  );
}

function findOfficialNotApplicableValue(
  attr: any,
): { id: string; name: string } | null {
  const values = Array.isArray(attr?.values) ? attr.values : [];
  const hit = values.find((value: any) => isNotApplicableLabel(value?.name));
  return hit ? { id: String(hit.id), name: String(hit.name) } : null;
}

function pickEmptyGtinReasonValue(attr: any, productName: unknown) {
  const values = Array.isArray(attr?.values) ? attr.values : [];
  if (values.length === 0) return null;

  const text = normalizeAttrText(productName);
  const wantKit = /(\bkit\b|\bkits\b|\bcartela\b|\bcombo\b|\bpack\b|\b10un\b|\b12un\b|\b24un\b)/i.test(text);
  const preferredPatterns = wantKit
    ? [/^kit$/i, /^otro$/i, /^outro$/i, /nao registrado|no registrado/i, /^artesanal$/i]
    : [/^otro$/i, /^outro$/i, /nao registrado|no registrado/i, /^kit$/i, /^artesanal$/i];

  for (const pattern of preferredPatterns) {
    const hit = values.find((value: any) => pattern.test(String(value?.name || '').trim()));
    if (hit) {
      return { id: String(hit.id), name: String(hit.name) };
    }
  }

  const first = values[0];
  return first ? { id: String(first.id), name: String(first.name) } : null;
}

function stripHtmlToText(input: unknown): string {
  return normalizeText(
    String(input ?? "")
      .replace(/<\s*br\s*\/?>/gi, " ")
      .replace(/<\s*\/p\s*>/gi, " ")
      .replace(/<\s*\/li\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function buildDescription(produto: any, input?: string) {
  const manual = stripHtmlToText(input);
  if (manual) return manual.slice(0, 5000);

  const descricao = stripHtmlToText(produto?.descricao);
  if (descricao) return descricao.slice(0, 5000);

  const caracteristicas = stripHtmlToText(produto?.caracteristicas);
  if (caracteristicas) return caracteristicas.slice(0, 5000);

  const informacoes = stripHtmlToText(produto?.informacoes);
  if (informacoes) return informacoes.slice(0, 5000);

  return [normalizeText(produto?.nome), normalizeText(produto?.marca)]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 5000);
}

function isNegative(value?: MappedAttr) {
  if (!value) return false;
  const id = String(value.value_id || "");
  const name = normalizeText(value.value_name).toLowerCase();
  return NO_IDS.has(id) || name === "não" || name === "nao" || name === "false";
}

function sanitizeAttributesByDependencies(
  attributesMap: Map<string, MappedAttr>,
  categoryAttrsById: Map<string, any>,
  warnings: string[],
) {
  const apply = (parentId: string, childIds: string[]) => {
    const parent = attributesMap.get(parentId);
    if (!isNegative(parent)) return;

    for (const childId of childIds) {
      if (!attributesMap.has(childId)) continue;
      const notApplicable = findOfficialNotApplicableValue(
        categoryAttrsById.get(childId),
      );
      if (notApplicable) {
        attributesMap.set(childId, {
          id: childId,
          value_id: notApplicable.id,
          value_name: undefined,
        });
        console.warn(
          JSON.stringify({
            event: "ml_attr_sanitized",
            attr_id: childId,
            parent_attr_id: parentId,
            action: "set_official_na",
          }),
        );
      } else {
        attributesMap.delete(childId);
        console.warn(
          JSON.stringify({
            event: "ml_attr_sanitized",
            attr_id: childId,
            parent_attr_id: parentId,
            action: "omit_na_unavailable_in_api",
          }),
        );
      }
      if (parentId !== "WITH_GEMSTONE") {
        warnings.push(
          `Atributo ${childId} ajustado por consistência com ${parentId}.`,
        );
      }
    }
  };

  apply("WITH_CLOSING", ["CLASP_TYPE"]);
  apply("WITH_GEMSTONE", ["GEMSTONE_TYPE", "GEMSTONE_COLOR"]);
}

function pickWarrantyValueId(values: Array<{ id: string; name: string }>) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const hit12 = values.find((v) =>
    normalizeText(v.name).toLowerCase().includes("12"),
  );
  return String((hit12 || values[0]).id);
}

function formatPackageWeightFromKg(weightKg: unknown) {
  const grams = Math.round(Number(weightKg || 0) * 1000);
  return grams > 0 ? `${grams} g` : "";
}

function extractMlFee(listingPrices: any): number | null {
  const fee = Number(
    listingPrices?.sale_fee_details?.percentage_fee ??
      listingPrices?.sale_fee_details?.meli_percentage_fee,
  );
  if (!Number.isFinite(fee) || fee <= 0) return null;
  return fee / 100;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function calculateSafeListingPrice(params: {
  produto: any;
  categoriaId: string;
  listingType: string;
  requestedPrice?: number;
}) {
  const cost = Number(params.produto.custo || 0);
  const shipping = Number(params.produto.ml_shipping || 0);
  let mlFee = Number(params.produto.ml_fee || 0.15);
  const provisional = calculateSuggestedPrice({ cost, shipping, mlFee });
  const listingPrices = await fetchML<any>(
    `/sites/MLB/listing_prices?price=${provisional.suggestedPrice}&category_id=${params.categoriaId}&listing_type_id=${params.listingType}`,
  );
  mlFee = extractMlFee(listingPrices) ?? mlFee;
  const pricing = calculateSuggestedPrice({ cost, shipping, mlFee });
  const suggestedPrice = Math.round(pricing.suggestedPrice * 100) / 100;
  const requestedPrice = Number(params.requestedPrice || 0);
  const hasRequestedPrice =
    Number.isFinite(requestedPrice) && requestedPrice > 0;
  const roundedRequested = hasRequestedPrice
    ? Math.round(requestedPrice * 100) / 100
    : 0;
  const price = hasRequestedPrice
    ? Math.max(roundedRequested, suggestedPrice)
    : suggestedPrice;
  return {
    price,
    mlFee,
    suggestedPrice,
    adjusted: hasRequestedPrice && roundedRequested < suggestedPrice,
  };
}

async function pauseCreatedListing(itemId: string) {
  const result = await fetchMLResult<any>(
    `/items/${encodeURIComponent(itemId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    },
  );
  return { ok: result.ok, error: result.error?.message };
}

async function updateCreatedListingPrice(itemId: string, price: number) {
  const result = await fetchMLResult<any>(
    `/items/${encodeURIComponent(itemId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price }),
    },
  );
  return {
    ok: result.ok,
    error: result.error?.message,
    status: result.status,
  };
}

async function getListingSnapshot(itemId: string) {
  return fetchML<any>(`/items/${encodeURIComponent(itemId)}`);
}

type MlShippingResolution = {
  mlShipping: number;
  warning?: string;
  status?: number | null;
};

function getItemShippingMode(item: any) {
  return String(item?.shipping?.mode || "")
    .trim()
    .toLowerCase();
}

function requiresMercadoEnviosPause(item: any) {
  return (
    String(item?.status || "").toLowerCase() === "active" &&
    getItemShippingMode(item) !== "me2"
  );
}

async function resolveMlShippingCost(
  itemId: string,
): Promise<MlShippingResolution> {
  const meResult = await fetchMLResult<any>("/users/me?attributes=address");
  if (!meResult.ok) {
    return {
      mlShipping: 0,
      warning: `Não foi possível consultar CEP do vendedor para frete ML: ${meResult.error?.message || `HTTP ${meResult.status}`}`,
      status: meResult.status,
    };
  }

  const sellerZip = String(meResult.data?.address?.zip_code || "").trim();
  if (!sellerZip) {
    return {
      mlShipping: 0,
      warning:
        "CEP do vendedor ausente no Mercado Livre; frete ML não calculado.",
    };
  }

  const shippingResult = await fetchMLResult<any>(
    `/items/${encodeURIComponent(itemId)}/shipping_options?zip_code=${encodeURIComponent(sellerZip)}`,
  );
  if (!shippingResult.ok) {
    return {
      mlShipping: 0,
      warning: `Frete ML não retornado para ${itemId}: ${shippingResult.error?.message || `HTTP ${shippingResult.status}`}`,
      status: shippingResult.status,
    };
  }

  const options = Array.isArray(shippingResult.data?.options)
    ? shippingResult.data.options
    : [];
  const freeOption = options.find(
    (option: any) =>
      Number(option?.cost) === 0 && Number(option?.list_cost) > 0,
  );
  const pricedOption = options.find(
    (option: any) => Number(option?.list_cost) > 0,
  );
  const mlShipping = Number(
    freeOption?.list_cost ?? pricedOption?.list_cost ?? 0,
  );

  if (!Number.isFinite(mlShipping) || mlShipping <= 0) {
    return {
      mlShipping: 0,
      warning: `Frete ML sem list_cost válido para ${itemId}.`,
    };
  }

  return { mlShipping: roundMoney(mlShipping), status: shippingResult.status };
}

function mapMlItemStatus(item: any): "ativo" | "pausado" {
  return String(item?.status || "").toLowerCase() === "active"
    ? "ativo"
    : "pausado";
}

function getMlSubStatuses(item: any): string[] {
  return Array.isArray(item?.sub_status)
    ? item.sub_status.map((s: any) => String(s))
    : [];
}

function addListingStatusWarnings(item: any, warnings: string[]) {
  const status = String(item?.status || "").toLowerCase();
  const subStatuses = getMlSubStatuses(item);
  const message =
    "ML está processando imagens; isso costuma liberar automaticamente.";
  if (
    status === "paused" &&
    subStatuses.includes("picture_download_pending") &&
    !warnings.includes(message)
  ) {
    warnings.push(message);
  }
}

function applyKnownCorrectedPrice(
  item: any,
  pricingCorrection: { status?: string; final_price?: number | null },
) {
  if (
    pricingCorrection.status !== "corrected" ||
    typeof pricingCorrection.final_price !== "number"
  )
    return item;
  return { ...item, price: pricingCorrection.final_price };
}

async function persistListingLink(params: {
  supabase: ReturnType<typeof createServiceClient>;
  produto: any;
  produtoId: string;
  item: any;
  mlFee: number;
  mlShipping: number;
  mlStatus: "ativo" | "pausado";
}) {
  const { supabase, produto, produtoId, item, mlFee, mlShipping, mlStatus } =
    params;
  await supabase
    .from("produtos")
    .update({
      ml_item_id: item.id,
      ml_status: mlStatus,
      ml_fee: mlFee,
      ml_shipping: mlShipping,
    })
    .eq("id", produtoId);

  const persistResult = await persistSingleAnuncioBySku(supabase, {
    ml_item_id: item.id,
    sku: produto.sku,
    produto_id: produto.id,
    titulo: item.title,
    preco_ml: item.price,
    vendidos: 0,
    status: mlStatus,
    thumbnail: item.thumbnail || null,
    permalink: item.permalink,
  });

  if (!persistResult.ok) {
    throw new Error(`Falha ao persistir anúncio ML único por SKU: ${persistResult.error}`);
  }
}

export async function POST(req: Request) {
  try {
    const {
      produtoId,
      categoriaId,
      listingType,
      basePrice,
      fiscal,
      description,
      attributes: editedAttributes,
      sale_terms: editedSaleTerms,
      allowOutOfStockListing = false,
    } = await req.json();

    if (!produtoId) {
      return NextResponse.json(
        { error: "produtoId é obrigatório" },
        { status: 400 },
      );
    }
    if (!categoriaId) {
      return NextResponse.json(
        { error: "categoriaId é obrigatório" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data: produto } = await supabase
      .from("produtos")
      .select("*")
      .eq("id", produtoId)
      .single();

    if (!produto) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 },
      );
    }

    const gtinForMl = await resolveGtinForMlListing(
      supabase,
      String(produto.sku || ""),
      produto.gtin,
    );

    const { data: supplierOffers } = await supabase
      .from("produto_fornecedor_ofertas")
      .select(
        "id,produto_id,nome,descricao,custo,estoque,prioridade,ativo,last_sync_at",
      )
      .eq("produto_id", produtoId);

    if (!produto.sku?.trim()) {
      return NextResponse.json(
        { error: "Produto sem SKU. Preencha o SKU antes de criar anúncio." },
        { status: 422 },
      );
    }
    if (!produto.nome?.trim()) {
      return NextResponse.json(
        { error: "Produto sem nome. Preencha o nome antes de criar anúncio." },
        { status: 422 },
      );
    }
    if (!Number.isFinite(Number(produto.custo)) || Number(produto.custo) <= 0) {
      return NextResponse.json(
        {
          error:
            "Produto com custo inválido. Ajuste o custo antes de criar anúncio.",
        },
        { status: 422 },
      );
    }
    if (
      !Number.isFinite(Number(produto.estoque)) ||
      (Number(produto.estoque) <= 0 && !allowOutOfStockListing)
    ) {
      return NextResponse.json(
        {
          error:
            "Produto sem estoque. Sincronize estoque ou aguarde disponibilidade antes de anunciar.",
        },
        { status: 422 },
      );
    }
    if (String(produto.ml_item_id || "").trim()) {
      return NextResponse.json(
        { error: "Produto já possui anúncio vinculado no Mercado Livre." },
        { status: 409 },
      );
    }
    try {
      await assertAllowedMlCategoryForProduct(produto, categoriaId);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }

    const steps: Record<
      | "categoria"
      | "atributos"
      | "anuncio"
      | "descricao"
      | "atacado"
      | "fiscal",
      StepResult
    > = {
      categoria: { ok: false },
      atributos: { ok: false },
      anuncio: { ok: false },
      descricao: { ok: false },
      atacado: { ok: false },
      fiscal: { ok: false },
    };

    const warnings: string[] = [];
    if (Number(produto.estoque) <= 0 && allowOutOfStockListing) {
      warnings.push(
        "Anúncio será criado pausado por estoque zero e reativado pela sincronização quando houver disponibilidade.",
      );
    }
    const missingRequiredAttributes: Array<{ id: string; name: string }> = [];

    const safePrice = await calculateSafeListingPrice({
      produto,
      categoriaId,
      listingType: listingType || "gold_pro",
      requestedPrice:
        typeof basePrice === "number" &&
        Number.isFinite(basePrice) &&
        basePrice > 0
          ? basePrice
          : typeof produto.custom_price === "number"
            ? produto.custom_price
            : undefined,
    });
    const displayPrice = safePrice.price;
    const initialPrice = roundMoney(displayPrice);
    if (safePrice.adjusted) {
      warnings.push(
        `Preço ajustado automaticamente para R$ ${safePrice.suggestedPrice.toFixed(2)} para evitar frete/taxa desatualizados.`,
      );
    }

    const attrs = await getCategoryAttributes(categoriaId);
    if (!attrs || attrs.length === 0) {
      return NextResponse.json(
        { error: "Não foi possível carregar atributos da categoria" },
        { status: 422 },
      );
    }
    steps.categoria.ok = true;
    const categoryAttrsById = new Map(
      (attrs || []).map((attr: any) => [String(attr.id), attr]),
    );

    const attributesMap = new Map<
      string,
      { id: string; value_name?: string; value_id?: string }
    >();
    if (Array.isArray(editedAttributes)) {
      for (const attr of editedAttributes as AttrInput[]) {
        if (attr?.id) attributesMap.set(String(attr.id), normalizeAttr(attr));
      }
    }
    if (gtinForMl && !hasValue(attributesMap.get("GTIN") || { id: "GTIN" })) {
      attributesMap.set("GTIN", { id: "GTIN", value_name: gtinForMl });
      if (!String(produto.gtin || "").trim()) {
        warnings.push("GTIN unitário do componente usado para este kit de itens idênticos.");
      }
    }

    // Validate list values if value_id is provided
    for (const attr of attrs) {
      let current = attributesMap.get(attr.id);
      if (!current) continue;
      if (String(attr.id).toUpperCase() === "COLOR" && current.value_name) {
        const colorText = normalizeAttrText(current.value_name);
        const normalizedColor =
          colorText === "vermelha" || colorText === "vermelhas"
            ? "Vermelho"
            : colorText === "azul" || colorText === "azuis"
              ? "Azul"
              : colorText === "preta" || colorText === "pretas"
                ? "Preto"
                : colorText === "branca" || colorText === "brancas"
                  ? "Branco"
                  : "";
        if (normalizedColor && Array.isArray(attr.values)) {
          const official = attr.values.find(
            (v: any) =>
              normalizeAttrText(v.name) === normalizeAttrText(normalizedColor),
          );
          if (official) {
            current = {
              id: attr.id,
              value_id: String(official.id),
              value_name: String(official.name),
            };
            attributesMap.set(attr.id, current);
          }
        }
      }
      if (
        String(current.value_id || "") === NOT_APPLICABLE_ID ||
        isNotApplicableLabel(current.value_name)
      ) {
        const notApplicable = findOfficialNotApplicableValue(attr);
        if (notApplicable) {
          attributesMap.set(attr.id, {
            id: attr.id,
            value_id: notApplicable.id,
            value_name: undefined,
          });
        } else {
          attributesMap.delete(attr.id);
          warnings.push(
            `Atributo ${attr.name} omitido: "Não se aplica" não existe na API oficial da categoria.`,
          );
        }
        continue;
      }
      if (
        current.value_id &&
        Array.isArray(attr.values) &&
        attr.values.length > 0
      ) {
        const valid = attr.values.some(
          (v: any) => String(v.id) === String(current.value_id),
        );
        if (!valid && attr.value_type === "string" && current.value_name) {
          attributesMap.set(attr.id, {
            id: attr.id,
            value_name: current.value_name,
          });
          continue;
        }
        if (!valid) {
          return NextResponse.json(
            {
              success: false,
              steps: {
                ...steps,
                atributos: {
                  ok: false,
                  error: `Valor inválido para atributo ${attr.name}`,
                },
              },
              warnings,
              missing_required_attributes: missingRequiredAttributes,
              error: `Valor inválido para atributo ${attr.name}`,
            },
            { status: 422 },
          );
        }
      }
    }

    for (const attr of attrs) {
      const attrId = String(attr.id || "").toUpperCase();
      if (!isMlCriticalAttributeId(attrId)) continue;
      const trustedValue = resolveTrustedMlCriticalValue(
        attrId,
        produto,
        supplierOffers || [],
      );
      const current = attributesMap.get(attr.id);
      if (!trustedValue) {
        if (current && hasValue(current)) {
          attributesMap.delete(attr.id);
          warnings.push(
            `${attr.name}: valor removido porque não há evidência local/DSLite confiável para atributo crítico.`,
          );
        }
        continue;
      }
      const currentNormalized = normalizeCriticalAttributeValue(
        attrId,
        current?.value_name || current?.value_id,
      );
      if (currentNormalized && currentNormalized !== trustedValue) {
        warnings.push(
          `${attr.name}: valor informado divergente do cadastro local; ajustado para ${trustedValue}.`,
        );
      }
      attributesMap.set(attr.id, {
        id: attr.id,
        value_id: undefined,
        value_name: trustedValue,
      });
    }

    sanitizeAttributesByDependencies(
      attributesMap,
      categoryAttrsById,
      warnings,
    );

    const productTextForCorrections = normalizeAttrText(
      `${produto.nome || ""} ${produto.descricao || ""} ${produto.categoria || ""}`,
    );
    const cutawayAttr = attributesMap.get("WITH_CUTAWAY");
    if (cutawayAttr) {
      const cutawayValue = normalizeAttrText(
        cutawayAttr.value_name || cutawayAttr.value_id,
      );
      const isInstrument =
        productTextForCorrections.includes("violao") ||
        productTextForCorrections.includes("guitarra");
      if (isInstrument && cutawayValue !== "sim" && cutawayValue !== "nao") {
        attributesMap.set("WITH_CUTAWAY", {
          id: "WITH_CUTAWAY",
          value_id: undefined,
          value_name: "Não",
        });
        warnings.push("Cutaway corrigido: valor inválido substituído por Não.");
      }
    }

    for (const id of ["STRINGS_NUMBER", "STRING_NUMBER", "NUMBER_OF_STRINGS"]) {
      const attr = attributesMap.get(id);
      if (!attr) continue;
      const numeric = String(attr.value_name || attr.value_id || "").match(
        /\d+/,
      )?.[0];
      if (numeric) {
        attributesMap.set(id, { id, value_id: undefined, value_name: numeric });
      }
    }

    const materialAttr = attributesMap.get("MATERIAL");
    if (
      normalizeAttrText(materialAttr?.value_name) === "ouro" &&
      isGoldPlatedText(`${produto.nome || ""} ${produto.descricao || ""}`)
    ) {
      attributesMap.set("MATERIAL", {
        id: "MATERIAL",
        value_id: undefined,
        value_name: "Banhado em ouro 18k",
      });
      warnings.push("Material corrigido: produto banhado não é ouro maciço.");
    }

    const categoryInfo = await fetchML<any>(`/categories/${categoriaId}`);
    const gtinAttr = categoryAttrsById.get("GTIN");
    const emptyGtinReasonAttr = categoryAttrsById.get("EMPTY_GTIN_REASON");
    const hasGtinValue = hasValue(attributesMap.get("GTIN") || { id: "GTIN" });
    if (!hasGtinValue && emptyGtinReasonAttr) {
      const reason = pickEmptyGtinReasonValue(emptyGtinReasonAttr, produto.nome);
      if (reason) {
        attributesMap.set("EMPTY_GTIN_REASON", {
          id: "EMPTY_GTIN_REASON",
          value_id: reason.id,
          value_name: undefined,
        });
        warnings.push(`GTIN ausente. Motivo enviado ao ML: ${reason.name}.`);
      }
    }
    const hasSizeGridAttribute = categoryAttrsById.has("SIZE_GRID_ID");
    if (
      hasSizeGridAttribute &&
      !hasValue(attributesMap.get("SIZE_GRID_ID") || { id: "SIZE_GRID_ID" })
    ) {
      const sizeGrid = await findFashionSizeGrid({
        categoryInfo,
        attributesMap,
      });
      if (sizeGrid) {
        attributesMap.set("SIZE_GRID_ID", {
          id: "SIZE_GRID_ID",
          value_name: sizeGrid.gridId,
        });
        if (sizeGrid.rowId) {
          attributesMap.set("SIZE_GRID_ROW_ID", {
            id: "SIZE_GRID_ROW_ID",
            value_name: sizeGrid.rowId,
          });
        }
        warnings.push(
          `Guia de tamanhos ML vinculado automaticamente: ${sizeGrid.gridId}${sizeGrid.rowId ? ` / ${sizeGrid.rowId}` : ""}.`,
        );
      } else {
        return NextResponse.json(
          {
            success: false,
            steps: {
              ...steps,
              atributos: {
                ok: false,
                error:
                  "Categoria de moda exige guia de tamanhos, mas nenhum guia compatível foi encontrado para marca/gênero/domínio.",
              },
            },
            warnings,
            missing_required_attributes: missingRequiredAttributes,
            error:
              "Guia de tamanhos ML não encontrado. Cadastre uma guia de tamanhos compatível no Mercado Livre ou vincule SIZE_GRID_ID antes de criar o anúncio.",
          },
          { status: 422 },
        );
      }
    }

    const required = attrs.filter(
      (a: any) =>
        (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed,
    );
    for (const attr of required) {
      const existing = attributesMap.get(attr.id);
      if (!existing || !hasValue(existing)) {
        missingRequiredAttributes.push({ id: attr.id, name: attr.name });
      }
    }

    if (missingRequiredAttributes.length > 0) {
      steps.atributos = {
        ok: false,
        error: "Existem atributos obrigatórios sem preenchimento.",
      };
      return NextResponse.json(
        {
          success: false,
          steps,
          warnings,
          missing_required_attributes: missingRequiredAttributes,
          error:
            "Atributos obrigatórios pendentes. Revise antes de criar o anúncio.",
        },
        { status: 422 },
      );
    }

    const ncmFinal = fiscal?.ncm ?? produto.ncm;
    const gtinFinal = fiscal?.gtin ?? gtinForMl;
    const cestFinal = fiscal?.cest ?? produto.cest;
    const csosnFinal = fiscal?.csosn ?? produto.csosn;
    const origemFinal = fiscal?.origem_fiscal ?? produto.origem_fiscal;
    const fiscalParsed = fiscalStrictSchema.safeParse({
      ncm: ncmFinal,
      origem_fiscal: origemFinal,
      csosn: csosnFinal,
      sku: produto.sku,
      title: produto.nome,
    });
    const canSyncFiscal = fiscalParsed.success;

    if (!canSyncFiscal) {
      steps.fiscal = {
        ok: false,
        error: fiscalParsed.error.issues.map((i) => i.message).join(" | "),
      };
      warnings.push(
        `Fiscal não enviado na criação: ${steps.fiscal.error}`,
      );
    }

    const existingItemId = await searchItemBySellerSku(String(produto.sku));
    if (existingItemId) {
      const existingItem = await getListingSnapshot(existingItemId);
      if (!existingItem?.id) {
        return NextResponse.json(
          {
            error:
              "Anúncio existente encontrado por SKU, mas não foi possível carregar detalhes no Mercado Livre.",
          },
          { status: 502 },
        );
      }
      if (
        existingItem.category_id &&
        String(existingItem.category_id) !== String(categoriaId)
      ) {
        return NextResponse.json(
          {
            success: false,
            steps,
            warnings,
            missing_required_attributes: missingRequiredAttributes,
            error:
              "Anúncio existente com mesmo SKU está em categoria ML diferente. Pausa/desvincule ou altere o SKU do anúncio antigo antes de recriar.",
            existing_item: {
              id: existingItem.id,
              category_id: existingItem.category_id,
              status: existingItem.status,
              permalink: existingItem.permalink,
            },
          },
          { status: 409 },
        );
      }
      const existingShipping = await resolveMlShippingCost(existingItem.id);
      if (existingShipping.warning) warnings.push(existingShipping.warning);
      let existingItemForPersist = existingItem;
      if (requiresMercadoEnviosPause(existingItem)) {
        const pauseResult = await pauseCreatedListing(existingItem.id);
        if (pauseResult.ok) {
          existingItemForPersist = (await getListingSnapshot(
            existingItem.id,
          )) || { ...existingItem, status: "paused" };
          warnings.push(
            "Anúncio existente pausado: não possui entrega Mercado Livre (ME2).",
          );
        } else {
          warnings.push(
            `Anúncio existente sem ME2 e não foi possível pausar: ${pauseResult.error || "erro desconhecido"}`,
          );
        }
      }
      await persistListingLink({
        supabase,
        produto,
        produtoId,
        item: existingItemForPersist,
        mlFee: produto.ml_fee || 0.15,
        mlShipping: existingShipping.mlShipping || produto.ml_shipping || 0,
        mlStatus: mapMlItemStatus(existingItemForPersist),
      });
      steps.anuncio.ok = true;
      steps.descricao = {
        ok: false,
        error:
          "Anúncio existente vinculado; descrição não reenviada nesta etapa.",
      };
      steps.fiscal.ok = true;
      return NextResponse.json({
        success: true,
        linked_existing: true,
        steps,
        warnings: [
          "Anúncio já existia no Mercado Livre para este SKU e foi vinculado ao produto.",
        ],
        missing_required_attributes: missingRequiredAttributes,
        categoria: { id: categoriaId, descoberta: false },
        anuncio: {
          id: existingItem.id,
          title: existingItem.title,
          price: existingItem.price,
          permalink: existingItem.permalink,
          status: existingItem.status,
        },
        quantity_pricing: false,
        fiscal: "ok",
      });
    }

    // Enforce SKU + package defaults
    attributesMap.set("SELLER_SKU", {
      id: "SELLER_SKU",
      value_id: undefined,
      value_name: produto.sku,
    });
    if (produto.altura)
      attributesMap.set("SELLER_PACKAGE_HEIGHT", {
        id: "SELLER_PACKAGE_HEIGHT",
        value_id: undefined,
        value_name: `${produto.altura} cm`,
      });
    if (produto.largura)
      attributesMap.set("SELLER_PACKAGE_WIDTH", {
        id: "SELLER_PACKAGE_WIDTH",
        value_id: undefined,
        value_name: `${produto.largura} cm`,
      });
    if (produto.profundidade)
      attributesMap.set("SELLER_PACKAGE_LENGTH", {
        id: "SELLER_PACKAGE_LENGTH",
        value_id: undefined,
        value_name: `${produto.profundidade} cm`,
      });
    if (produto.peso_bruto)
      attributesMap.set("SELLER_PACKAGE_WEIGHT", {
        id: "SELLER_PACKAGE_WEIGHT",
        value_id: undefined,
        value_name: formatPackageWeightFromKg(produto.peso_bruto),
      });
    steps.atributos.ok = true;

    const categorySaleTerms = Array.isArray(categoryInfo?.sale_terms)
      ? categoryInfo.sale_terms
      : [];
    const warrantySchema = categorySaleTerms.find(
      (t: any) => String(t.id) === "WARRANTY_TIME",
    );
    const warrantyValues = Array.isArray(warrantySchema?.values)
      ? warrantySchema.values.map((v: any) => ({
          id: String(v.id),
          name: String(v.name),
        }))
      : [];

    const saleTermsInput = Array.isArray(editedSaleTerms)
      ? (editedSaleTerms as SaleTermInput[])
          .filter((term) => term?.id)
          .map((term) => {
            const id = String(term.id);
            if (id === "WARRANTY_TIME" && warrantyValues.length > 0) {
              const valueId = term.value_id ? String(term.value_id) : "";
              const valid = warrantyValues.some(
                (v: { id: string; name: string }) => String(v.id) === valueId,
              );
              if (valid)
                return { id, value_id: valueId, value_name: undefined };
              const fallbackId = pickWarrantyValueId(warrantyValues);
              return { id, value_id: fallbackId, value_name: undefined };
            }
            return {
              id,
              value_id: term.value_id ? String(term.value_id) : undefined,
              value_name: term.value_name
                ? id === "WARRANTY_TIME"
                  ? normalizeMlWarrantyTime(term.value_name)
                  : String(term.value_name)
                : undefined,
            };
          })
      : [];

    if (!saleTermsInput.find((t) => t.id === "WARRANTY_TIME")) {
      if (warrantyValues.length > 0) {
        saleTermsInput.push({
          id: "WARRANTY_TIME",
          value_id: pickWarrantyValueId(warrantyValues),
          value_name: undefined,
        });
      } else {
        saleTermsInput.push({
          id: "WARRANTY_TIME",
          value_id: undefined,
          value_name: DEFAULT_ML_WARRANTY_TIME,
        });
      }
    }
    const saleTerms = normalizeMlSaleTerms(saleTermsInput);

    const imagens = produto.imagens || [];
    const picturesSource =
      imagens.length > 0 ? imagens : ["https://via.placeholder.com/400"];
    const pictures = picturesSource.slice(0, 12);
    if (imagens.length === 0)
      warnings.push(
        "Produto sem imagens locais. Será usada imagem placeholder.",
      );
    if (picturesSource.length > pictures.length)
      warnings.push(
        `Imagens limitadas a ${pictures.length} para respeitar o limite do Mercado Livre.`,
      );

    const listingNames = buildListingNames({
      productName: produto.nome,
      brand: produto.marca,
      attributesMap,
    });

    let useFamilyName = false;
    try {
      const me = await fetchML<any>("/users/me?attributes=tags");
      useFamilyName = me?.tags?.includes("user_product_seller") ?? false;
    } catch {}

    const listingDescription = buildDescription(produto, description);

    let listingPayload: Parameters<typeof createListing>[0] = {
      title: useFamilyName ? undefined : listingNames.title,
      familyName: useFamilyName ? listingNames.familyName : undefined,
      categoryId: categoriaId,
      price: displayPrice,
      availableQuantity: Number(produto.estoque || 0),
      condition: "new",
      listingTypeId: listingType || "gold_pro",
      description: listingDescription,
      pictures,
      attributes: Array.from(attributesMap.values()),
      saleTerms,
      sellerCustomField: produto.sku,
      fiscalData: {
        gtin: fiscal?.gtin || gtinForMl || undefined,
      },
    };

    let result;
    try {
      result = await createListing(listingPayload);
    } catch (err: any) {
      const message = err?.message || "Falha ao criar anúncio no ML";
      const mlStatus = Number(err?.status || 0);
      const missingConditionalGtin =
        /item\.attribute\.missing_conditional_required/i.test(message) &&
        /\bGTIN\b/i.test(message);
      steps.anuncio = { ok: false, error: message };
      if (missingConditionalGtin && gtinAttr?.tags?.conditional_required) {
        warnings.push(
          emptyGtinReasonAttr
            ? "GTIN ausente; categoria aceita motivo de GTIN vazio e payload foi ajustado quando disponível."
            : "GTIN ausente; esta categoria não expõe EMPTY_GTIN_REASON. Cadastre GTIN real para publicar.",
        );
      }
      return NextResponse.json(
        {
          success: false,
          steps,
          warnings,
          missing_required_attributes: missingRequiredAttributes,
          error: message,
        },
        { status: mlStatus === 409 ? 409 : mlStatus >= 400 && mlStatus < 500 ? 422 : 502 },
      );
    }

    if (!result) {
      steps.anuncio = { ok: false, error: "Falha ao criar anúncio no ML" };
      return NextResponse.json(
        {
          success: false,
          steps,
          warnings,
          missing_required_attributes: missingRequiredAttributes,
          error: "Falha ao criar anúncio no ML",
        },
        { status: 502 },
      );
    }
    steps.anuncio.ok = true;

    const descriptionResult = await upsertListingDescription(
      result.id,
      listingDescription,
    );
    if (descriptionResult.ok) {
      steps.descricao = { ok: true };
    } else {
      steps.descricao = {
        ok: false,
        error: [
          descriptionResult.statusHttp
            ? `HTTP ${descriptionResult.statusHttp}`
            : "",
          descriptionResult.error,
        ]
          .filter(Boolean)
          .join(": "),
      };
      warnings.push(`Descrição pendente no ML: ${steps.descricao.error}`);
    }

    let latestItem = (await getListingSnapshot(result.id)) || result;
    addListingStatusWarnings(latestItem, warnings);

    let mlFee = safePrice.mlFee || produto.ml_fee || 0.15;
    let mlShipping = produto.ml_shipping || 0;
    let finalSuggestedPrice = initialPrice;
    const pricingCorrection: {
      initial_price: number;
      final_price: number | null;
      ml_shipping: number | null;
      ml_fee: number | null;
      status: "not_needed" | "corrected" | "pending";
      error?: string;
      outbox_id?: string;
    } = {
      initial_price: initialPrice,
      final_price: null,
      ml_shipping: null,
      ml_fee: null,
      status: "not_needed",
    };

    try {
      const listingPrices = await fetchML<any>(
        `/sites/MLB/listing_prices?price=${displayPrice}&category_id=${categoriaId}&listing_type_id=${listingType || "gold_pro"}`,
      );
      if (listingPrices?.sale_fee_details?.percentage_fee)
        mlFee = listingPrices.sale_fee_details.percentage_fee / 100;
      else if (listingPrices?.sale_fee_details?.meli_percentage_fee)
        mlFee = listingPrices.sale_fee_details.meli_percentage_fee / 100;
    } catch {}

    const shippingResolution = await resolveMlShippingCost(result.id);
    if (shippingResolution.mlShipping > 0) {
      mlShipping = shippingResolution.mlShipping;
    }
    if (shippingResolution.warning) {
      warnings.push(shippingResolution.warning);
      await supabase
        .from("produtos")
        .update({ ml_shipping_warning: shippingResolution.warning } as any)
        .eq("id", produto.id);
    }

    if (requiresMercadoEnviosPause(latestItem)) {
      const pauseResult = await pauseCreatedListing(result.id);
      if (pauseResult.ok) {
        latestItem = (await getListingSnapshot(result.id)) || {
          ...latestItem,
          status: "paused",
        };
        warnings.push(
          "Anúncio pausado: não possui entrega Mercado Livre (ME2).",
        );
      } else {
        warnings.push(
          `Anúncio sem ME2 e não foi possível pausar automaticamente: ${pauseResult.error || "erro desconhecido"}`,
        );
      }
    }

    pricingCorrection.ml_shipping = roundMoney(Number(mlShipping || 0));
    pricingCorrection.ml_fee = roundMoney(Number(mlFee || 0));

    if (Number.isFinite(Number(mlShipping)) && Number(mlShipping) > 0) {
      try {
        const finalPricing = calculateSuggestedPrice({
          cost: Number(produto.custo || 0),
          shipping: Number(mlShipping || 0),
          mlFee: Number(mlFee || 0.15),
        });
        finalSuggestedPrice = roundMoney(finalPricing.suggestedPrice);
        pricingCorrection.final_price = finalSuggestedPrice;

        if (Math.abs(finalSuggestedPrice - initialPrice) >= 0.01) {
          const priceUpdate = await updateCreatedListingPrice(
            result.id,
            finalSuggestedPrice,
          );
          if (priceUpdate.ok) {
            pricingCorrection.status = "corrected";
            warnings.push(
              `Preço corrigido automaticamente após frete real: R$ ${initialPrice.toFixed(2)} → R$ ${finalSuggestedPrice.toFixed(2)}.`,
            );
            latestItem = {
              ...((await getListingSnapshot(result.id)) || latestItem),
              price: finalSuggestedPrice,
            };
          } else {
            const outbox = await enqueueMlPublishOutbox(supabase, {
              produtoId: String(produto.id),
              mlItemId: String(result.id),
              desiredStatus: null,
              desiredPrice: finalSuggestedPrice,
              desiredQuantity: null,
              source: "ml_listing_create_price_correction",
              dedupePending: true,
              payload: {
                apply_status: false,
                apply_price: true,
                apply_quantity: false,
                apply_quantity_pricing: true,
                update_quantity_pricing: true,
                initial_price: initialPrice,
                final_price: finalSuggestedPrice,
                ml_shipping: mlShipping,
                ml_fee: mlFee,
                error: priceUpdate.error || null,
              },
            });
            pricingCorrection.status = "pending";
            pricingCorrection.error =
              priceUpdate.error ||
              `HTTP ${priceUpdate.status || ""}`.trim() ||
              "Falha ao atualizar preço no ML";
            if (outbox.ok) pricingCorrection.outbox_id = outbox.outboxId;
            warnings.push(
              `Preço final calculado, mas atualização ficou pendente: ${pricingCorrection.error}`,
            );
          }
        }
      } catch (err: any) {
        pricingCorrection.status = "pending";
        pricingCorrection.error =
          err?.message || "Falha ao recalcular preço final";
        warnings.push(
          `Não foi possível recalcular preço final após frete real: ${pricingCorrection.error}`,
        );
      }
    } else {
      pricingCorrection.status = "pending";
      pricingCorrection.error = "Frete ML real não retornado após criação";
      warnings.push(
        "Anúncio criado, mas frete ML real ainda não foi retornado. Preço final ficou pendente.",
      );
    }

    const quantityPricingBasePrice =
      pricingCorrection.final_price || finalSuggestedPrice || displayPrice;
    const quantityPricingResult = await setItemQuantityPricing(
      result.id,
      quantityPricingBasePrice,
    );
    if (quantityPricingResult.ok) steps.atacado.ok = true;
    else {
      const errorMessage =
        quantityPricingResult.error || "Falha ao atualizar preços de atacado";
      steps.atacado = { ok: false, error: errorMessage };
      warnings.push(
        `Não foi possível configurar os preços de atacado neste momento. Motivo: ${errorMessage}`,
      );
    }

    await persistListingLink({
      supabase,
      produto,
      produtoId,
      item: latestItem,
      mlFee,
      mlShipping,
      mlStatus: mapMlItemStatus(latestItem),
    });

    await supabase
      .from("produtos")
      .update({
        custom_price: pricingCorrection.final_price || finalSuggestedPrice,
      } as any)
      .eq("id", produto.id);

    const fiscalErrors: string[] = [];
    const fiscalErrorDetails: any[] = [];

    if (canSyncFiscal) {
      const originType = mapOriginType(fiscalParsed.data.origem_fiscal);

      const fiscalResult = await updateListingFiscalData({
        itemId: result.id,
        sku: fiscalParsed.data.sku,
        title: fiscalParsed.data.title,
        ncm: normalizeNcm(fiscalParsed.data.ncm),
        origin_type: originType,
        origin_detail: fiscalParsed.data.origem_fiscal,
        gtin: gtinFinal || undefined,
        cest: cestFinal || undefined,
        csosn: fiscalParsed.data.csosn,
        net_weight: produto.peso_liq || undefined,
        gross_weight: produto.peso_bruto || undefined,
        measurement_unit: "UN",
        cost: produto.custo,
      });

      if (!fiscalResult.success) {
        const fiscalMessage = [
          fiscalResult.step,
          fiscalResult.statusHttp ? `HTTP ${fiscalResult.statusHttp}` : "",
          fiscalResult.error,
        ]
          .filter(Boolean)
          .join(": ");
        fiscalErrors.push(fiscalMessage);
        fiscalErrorDetails.push({
          step: fiscalResult.step,
          statusHttp: fiscalResult.statusHttp ?? null,
          endpoint: fiscalResult.endpoint ?? null,
          error: fiscalResult.error,
          fields: fiscalResult.fields ?? null,
          rawBody: fiscalResult.rawBody ?? null,
        });
      }
    }

    if (canSyncFiscal && fiscalErrors.length === 0) {
      steps.fiscal.ok = true;
    } else if (canSyncFiscal && fiscalErrors.length > 0) {
      steps.fiscal = { ok: false, error: fiscalErrors.join(" | ") };
      warnings.push(`Fiscal não vinculado no ML: ${steps.fiscal.error}`);

      latestItem = (await getListingSnapshot(result.id)) || latestItem;
      addListingStatusWarnings(latestItem, warnings);

      if (latestItem?.id) {
        latestItem = applyKnownCorrectedPrice(latestItem, pricingCorrection);
        await persistListingLink({
          supabase,
          produto,
          produtoId,
          item: latestItem,
          mlFee,
          mlShipping,
          mlStatus: mapMlItemStatus(latestItem),
        });
      }
    }

    latestItem = (await getListingSnapshot(result.id)) || latestItem || result;
    latestItem = applyKnownCorrectedPrice(latestItem, pricingCorrection);
    addListingStatusWarnings(latestItem, warnings);
    if (latestItem?.id) {
      await persistListingLink({
        supabase,
        produto,
        produtoId,
        item: latestItem,
        mlFee,
        mlShipping,
        mlStatus: mapMlItemStatus(latestItem),
      });
    }

    return NextResponse.json({
      success: steps.anuncio.ok,
      steps,
      warnings,
      missing_required_attributes: missingRequiredAttributes,
      categoria: { id: categoriaId, descoberta: false },
      anuncio: {
        id: result.id,
        title: latestItem?.title || result.title,
        price: latestItem?.price || result.price,
        permalink: latestItem?.permalink || result.permalink,
        status: latestItem?.status || result.status,
        sub_status: getMlSubStatuses(latestItem),
      },
      quantity_pricing: quantityPricingResult.ok,
      pricing_correction: pricingCorrection,
      fiscal: fiscalErrors.length === 0 ? "ok" : fiscalErrors,
      fiscal_details: fiscalErrorDetails,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
