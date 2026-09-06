import { obterProdutoEspecifico } from '@/services/dslite';
import { validateCatalogExpansionContext, catalogExpansionKey, assertCatalogExpansionCanAdvance, catalogExpansionReadbackIssues, catalogExpansionPayloadValidated, type CatalogExpansionContext } from '@/lib/ml/catalog-expansion';
import { resolveMlPricingGroup } from '@/services/ml-pricing-group';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { requireAdminUser } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase';
import { assessIdentity } from '@/lib/ml/opportunity-conflicts';
import { identityFacts, supplierIdentityFacts } from '@/lib/ml/opportunity-identity';
import { verifyPricingApproval } from '@/services/pricing-approval';
import { NextResponse } from "next/server";

export const maxDuration = 300;

import {
  createListing,
  buildMlCreatePayload,
  getCategoryAttributes,
  searchItemBySellerSku,
  updateListingFiscalData,
  upsertListingDescription,
} from "@/services/mercadolibre";
import { fetchML, fetchMLResult } from "@/services/integration";
import { evaluateProductPricing, persistPricingEvaluation, recordPricingEvent, pricingFingerprint, resolveNewListingQuoteContext } from '@/services/pricing-context';
import { createServiceClient } from "@/lib/supabase";
import {
  fiscalStrictSchema,
  mapOriginType,
  normalizeNcm,
} from "@/lib/fiscal-strict";
import { normalizeMlSaleTerms, warrantySaleTerms, warrantyDescription, WARRANTY_POLICY_VERSION } from '@/lib/ml-sale-terms';
import { loadProductWarranty } from '@/services/product-warranty';
import { enqueueMlPublishOutbox } from "@/lib/sync/ml-publish-outbox";
import { assertAllowedMlCategoryForProduct } from "@/lib/ml-category-guard";
import {
  assessMlProductIdentity,
  isMlCriticalAttributeId,
  normalizeCriticalAttributeValue,
  resolveTrustedMlCriticalValue,
} from "@/lib/ml-critical-attributes";
import { persistSingleAnuncioBySku } from "@/lib/ml/persist-single-anuncio";
import { mapCreatedListingDesiredStatus } from "@/lib/ml/status";
import { resolveGtinForMlListing } from "@/lib/produto-kits";
import { buildEvidenceBasedMlDescription } from "@/lib/ml-listing-description";
import { getConfiguredMlShippingCost } from "@/lib/ml/shipping-cost";
import { clearAutomaticMlIdentityBlock } from "@/lib/ml/identity-block";

type StepResult = { ok: boolean; error?: string };
type AttrInput = { id: string; value_name?: string; value_id?: string };
type SaleTermInput = { id: string; value_name?: string; value_id?: string };
type MappedAttr = { id: string; value_name?: string; value_id?: string };

async function reconcileResolvedMlIdentity(params: {
  client: ReturnType<typeof createServiceClient>;
  produtoId: string;
  itemId: string;
  canonicalBrand: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (params.canonicalBrand) {
    const { error } = await params.client
      .from("produtos")
      .update({ marca: params.canonicalBrand })
      .eq("id", params.produtoId);
    if (error) return { ok: false, error: error.message };
  }

  return clearAutomaticMlIdentityBlock(params.client, params.itemId);
}

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
    ? [/\bkit\b|\bpack\b/i, /^otro$/i, /^outro$/i, /nao registrado|no registrado|codigo cadastrado/i, /^artesanal$/i]
    : [/nao registrado|no registrado|codigo cadastrado/i, /^otro$/i, /^outro$/i, /\bkit\b|\bpack\b/i, /^artesanal$/i];

  for (const pattern of preferredPatterns) {
    const hit = values.find((value: any) => pattern.test(normalizeAttrText(value?.name)));
    if (hit) {
      return { id: String(hit.id), name: String(hit.name) };
    }
  }

  const first = values[0];
  return first ? { id: String(first.id), name: String(first.name) } : null;
}

function buildDescription(produto: any, input?: string) {
  return buildEvidenceBasedMlDescription(produto, input);
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

function extractMlFixedFee(listingPrices: any): number {
  const fixedFee = Number(
    listingPrices?.sale_fee_details?.fixed_fee
      ?? listingPrices?.sale_fee_details?.meli_fixed_fee,
  );
  return Number.isFinite(fixedFee) && fixedFee > 0 ? fixedFee : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function calculateSafeListingPrice(params: {
  produto: any; categoriaId: string; listingType: string; requestedPrice?: number;
  pricingMode?: string; targetNetProfit?: number;
}) {
  if (params.pricingMode && params.pricingMode !== 'canonical') throw new Error('MODO_PRICING_APOSENTADO: use a política canônica');
  const client = createServiceClient();
  const context = await resolveNewListingQuoteContext(params.produto, params.categoriaId, params.listingType);
  if (!context) throw new Error('INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  const evaluation = await evaluateProductPricing(client, { productId: params.produto.id, context, objective: 'target', requireLive: true });
  if (!evaluation.memory) throw new Error(evaluation.failure ?? 'ECONOMIA_INCONCLUSIVA');
  const m = evaluation.memory;
  return { price: m.price, suggestedPrice: m.price, adjusted: false, mlFee: m.fee.amount! / m.price,
    shipping: m.shipping.amount!, shippingSource: m.shipping.source, margin: m.margin, memory: m, evaluation };
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
  const shippingMode = getItemShippingMode(item);
  return (
    String(item?.status || "").toLowerCase() === "active" &&
    shippingMode !== "me2" &&
    shippingMode !== "not_specified"
  );
}

async function resolveMlShippingCost(
  itemId: string,
  shippingMode?: unknown,
): Promise<MlShippingResolution> {
  const configuredShipping = getConfiguredMlShippingCost(shippingMode);
  if (configuredShipping !== null) {
    return { mlShipping: configuredShipping };
  }

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
  desiredMlStatus?: "ativo" | "pausado";
}) {
  const {
    supabase,
    produto,
    produtoId,
    item,
    mlFee,
    mlShipping,
    mlStatus,
    desiredMlStatus = mlStatus,
  } = params;
  await supabase
    .from("produtos")
    .update({
      ml_item_id: item.id,
      ml_status: desiredMlStatus,
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
  const auth = await requireAdminUser(await createClient());
  if (!auth.ok) return auth.response;
  let publicationLock: {domain:string;ownerToken:string}|null=null;
  let batchLock: {domain:string;ownerToken:string}|null=null;
  let batch: CatalogExpansionContext | null = null;
  let preparation: any = null;
  let batchAttempted = false, batchValidated = false, batchCritical = false;
  let batchRemoteId: string | null = null, batchProductId: string | null = null;
  let batchReason = 'PUBLICACAO_INCONCLUSIVA';
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
      pricingMode,
      familyName: requestedFamilyName,
      targetNetProfit,
      pricingApprovalId,
      catalogExpansion,
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

    const domain = `publication:${produtoId}`;
    const lock = await acquireDomainLock({domain,ownerTask:'manual_publication',ttlSeconds:300});
    if (!lock.acquired) return NextResponse.json({error:'PUBLICACAO_EM_ANDAMENTO'}, {status:409});
    publicationLock={domain,ownerToken:lock.ownerToken};
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

    if (catalogExpansion) {
      batch = validateCatalogExpansionContext(catalogExpansion, produto.sku);
      batchProductId = produto.id;
      const domain = `catalog_expansion:${batch.batchId}`;
      const lock = await acquireDomainLock({domain,ownerTask:'catalog_expansion',ttlSeconds:300});
      if (!lock.acquired) return NextResponse.json({error:'LOTE_EM_EXECUCAO'},{status:409});
      batchLock = {domain,ownerToken:lock.ownerToken};
      const events = await (supabase as any).from('pricing_events').select('event_type,produto_id,payload').contains('payload',{batchId:batch.batchId});
      if (events.error) throw Error('AUDITORIA_LOTE_INDISPONIVEL');
      assertCatalogExpansionCanAdvance(events.data ?? []);
      const prepared = await (supabase as any).from('pricing_events').select('payload').eq('id',batch.preparationId).eq('produto_id',produto.id).eq('event_type','CATALOG_EXPANSION_PREPARED').maybeSingle();
      if (prepared.error || !prepared.data) throw Error('PREPARACAO_LOTE_INDISPONIVEL');
      preparation = prepared.data.payload as any;
      const draft = {categoriaId,listingType,description,attributes:editedAttributes,familyName:requestedFamilyName};
      if (preparation.batchId !== batch.batchId || preparation.draftHash !== pricingFingerprint(draft) || preparation.warrantyPolicyVersion !== WARRANTY_POLICY_VERSION) throw Error('PREPARACAO_LOTE_DIVERGENTE');
      if (preparation.identity !== 'IDENTIDADE_COHERENTE' || preparation.conflict !== 'SEM_CONFLITO' || preparation.logistics !== 'CONFIRMED' || preparation.duplicateCoverage?.complete !== true) throw Error('GATES_LOTE_PENDENTES');
      if (!produto.ativo || allowOutOfStockListing || !(Number(produto.estoque)>0)) throw Error('PRODUTO_INATIVO_OU_SEM_ESTOQUE');
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
      pricingMode,
      targetNetProfit,
      requestedPrice:
        typeof basePrice === "number" &&
        Number.isFinite(basePrice) &&
        basePrice > 0
          ? basePrice
          : typeof produto.custom_price === "number"
            ? produto.custom_price
            : undefined,
    });
    await verifyPricingApproval(supabase, { approvalId: String(pricingApprovalId || ''), productId: produto.id, price: safePrice.price, context: safePrice.evaluation.context! });
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
    const hasExplicitEmptyGtinReason = hasValue(
      attributesMap.get("EMPTY_GTIN_REASON") || { id: "EMPTY_GTIN_REASON" },
    );
    if (
      gtinForMl &&
      !hasExplicitEmptyGtinReason &&
      !hasValue(attributesMap.get("GTIN") || { id: "GTIN" })
    ) {
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
      if (batch) continue; // Atributos vinculados ao dossiê revisado; não substituir por inferência do texto local.
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
    if (!hasGtinValue && emptyGtinReasonAttr && !hasExplicitEmptyGtinReason) {
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
    const gtinFinal = hasExplicitEmptyGtinReason
      ? null
      : fiscal?.gtin ?? gtinForMl;
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
    if (existingItemId && batch) return NextResponse.json({error:'ANUNCIO_EXISTENTE_REQUER_FLUXO_PROPRIO',ml_item_id:existingItemId},{status:409});
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
      const identityAssessment = assessMlProductIdentity(
        existingItem,
        { ...produto, gtin: gtinForMl || produto.gtin },
        supplierOffers || [],
      );
      const identityConflicts = identityAssessment.blockingConflicts;
      if (identityConflicts.length > 0) {
        return NextResponse.json(
          {
            success: false,
            steps,
            warnings,
            error:
              "Anúncio existente com o mesmo SKU diverge da identidade comprovada do produto. O vínculo automático foi bloqueado.",
            identity_conflicts: identityConflicts,
            existing_item: {
              id: existingItem.id,
              category_id: existingItem.category_id,
              catalog_product_id: existingItem.catalog_product_id || null,
              status: existingItem.status,
              permalink: existingItem.permalink,
            },
          },
          { status: 409 },
        );
      }
      const identityReconciliation = await reconcileResolvedMlIdentity({
        client: supabase,
        produtoId: String(produto.id),
        itemId: String(existingItem.id),
        canonicalBrand: identityAssessment.canonicalBrand,
      });
      if (!identityReconciliation.ok) {
        return NextResponse.json(
          {
            success: false,
            steps,
            warnings,
            error: `Falha ao consolidar a identidade validada do anúncio: ${identityReconciliation.error}`,
          },
          { status: 500 },
        );
      }
      if (identityAssessment.canonicalBrand) {
        produto.marca = identityAssessment.canonicalBrand;
        warnings.push(
          `Marca local corrigida para ${identityAssessment.canonicalBrand} após confirmação por SKU e GTIN.`,
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
      const existingShipping = await resolveMlShippingCost(
        existingItem.id,
        getItemShippingMode(existingItem),
      );
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
        desiredMlStatus: mapCreatedListingDesiredStatus(existingItemForPersist),
      });
      await supabase
        .from("produtos")
        .update({
          ml_shipping_warning: existingShipping.warning || null,
        } as any)
        .eq("id", produto.id);
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

    const warranty = await loadProductWarranty(supabase, safePrice.evaluation.product, safePrice.evaluation.offer);
    if (warranty.resolution.status !== 'resolved') return NextResponse.json({error:warranty.resolution.reason,code:'PENDENCIA_VALIDACAO',warranty},{status:422});
    const saleTermsResponse = await fetchMLResult<any[]>(`/categories/${categoriaId}/sale_terms`);
    if (!saleTermsResponse.ok) return NextResponse.json({error:'GARANTIA_CONTRATO_ML_INDISPONIVEL'},{status:422});
    let warrantyTerms;
    try { warrantyTerms = warrantySaleTerms(warranty.resolution, saleTermsResponse.data ?? []); }
    catch (error: any) { return NextResponse.json({error:error.message},{status:422}); }
    const saleTerms = normalizeMlSaleTerms([
      ...(Array.isArray(editedSaleTerms) ? editedSaleTerms.filter((t: any) => !['WARRANTY_TYPE','WARRANTY_TIME'].includes(t.id)) : []),
      ...warrantyTerms,
    ]);

    const imagens = batch ? preparation.images : produto.imagens || [];
    if (!imagens.length) return NextResponse.json({error:'IMAGENS_REAIS_OBRIGATORIAS'}, {status:422});
    const pictures = imagens.slice(0,12);
    if (imagens.length > pictures.length)
      warnings.push(
        `Imagens limitadas a ${pictures.length} para respeitar o limite do Mercado Livre.`,
      );

    const listingNames = buildListingNames({
      productName: produto.nome,
      brand: produto.marca,
      attributesMap,
    });
    const effectiveFamilyName =
      (batch || ["profitable_shelf_2", "target_net_profit"].includes(String(pricingMode || "")))
      && requestedFamilyName
        ? truncateListingName(
            String(requestedFamilyName)
              .replace(/[-|/]+/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          )
        : listingNames.familyName;

    let useFamilyName = false;
    try {
      const me = await fetchML<any>("/users/me?attributes=tags");
      useFamilyName = me?.tags?.includes("user_product_seller") ?? false;
    } catch {}

    const listingDescription = `${buildDescription(produto, description)}\n\n${warrantyDescription(warranty.resolution)}`;

    let listingPayload: Parameters<typeof createListing>[0] = {
      title: useFamilyName ? undefined : effectiveFamilyName,
      familyName: useFamilyName ? effectiveFamilyName : undefined,
      categoryId: categoriaId,
      catalogProductId: batch ? preparation.catalogProductId || undefined : undefined,
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
        gtin: hasExplicitEmptyGtinReason
          ? undefined
          : fiscal?.gtin || gtinForMl || undefined,
      },
    };

    const identitySupplementRow = await (supabase as any).from('radar_oportunidades').select('evidence').eq('candidate_key', `product:${produto.id}`).maybeSingle();
    if (identitySupplementRow.error) throw new Error('EVIDENCIA_IDENTIDADE_INDISPONIVEL');
    const identitySupplement = (identitySupplementRow.data?.evidence as any)?.identitySupplement;
    const finalIdentity = assessIdentity({local:supplierIdentityFacts(safePrice.evaluation.offer ?? safePrice.evaluation.product,identityFacts(Array.from(attributesMap.values()), { title: effectiveFamilyName, description: listingDescription, source: 'publication_payload' }), identitySupplement),remote:identityFacts(Array.from(attributesMap.values()), { title: effectiveFamilyName, description: listingDescription, source: 'publication_payload' }),source:'formulario_publicacao_validado'});
    if (finalIdentity.identity==='IDENTIDADE_DIVERGENTE') return NextResponse.json({error:'CONFLITO_IDENTIDADE_PUBLICACAO',identity:finalIdentity},{status:422});
    if (finalIdentity.identity==='IDENTIDADE_INCONCLUSIVA') return NextResponse.json({error:'PENDENCIA_VALIDACAO_IDENTIDADE',identity:finalIdentity},{status:422});
    if (batch) {
      const currentOffer = safePrice.evaluation.offer;
      if (!currentOffer?.ativo || currentOffer.id !== preparation.offerId || Number(currentOffer.custo) !== Number(preparation.cost) || Number(currentOffer.estoque) !== Number(preparation.stock)) throw Error('OFERTA_LOTE_ALTERADA');
      if (Number(produto.estoque) !== Number(currentOffer.estoque)) throw Error('ESTOQUE_LOCAL_DIVERGE_OFERTA');
      if (safePrice.memory.result === null || safePrice.memory.margin! < safePrice.memory.band!.floor) throw Error('ECONOMIA_ABAIXO_DO_PISO');
      const liveOffer = await obterProdutoEspecifico(currentOffer.dslite_fornecedor_id,currentOffer.dslite_produto_id);
      if (!liveOffer || liveOffer.status_empresa !== 'A' || liveOffer.status_fornecedor !== 'A') throw Error('OFERTA_VIVA_INDISPONIVEL');
      const liveCost = Number(liveOffer.preco_promocional)>0 ? Number(liveOffer.preco_promocional) : Number(liveOffer.preco_crossdocking);
      if (liveCost !== Number(currentOffer.custo) || Number(liveOffer.estoque) !== Number(currentOffer.estoque) || String(liveOffer.ean11) !== String(produto.gtin)) throw Error('OFERTA_VIVA_ALTERADA');
      const livePackage = liveOffer as any;
      if (['altura','largura','profundidade'].some(key=>Number(livePackage[`${key}_embalagem`])!==Number((produto as any)[key])) || Number(livePackage.peso_embalagem)!==Number(produto.peso_bruto)) throw Error('EMBALAGEM_VIVA_ALTERADA');
      if (warranty.resolution.warranty_source==='supplier' && warranty.resolution.unit==='dias' && warranty.resolution.duration!==Number(liveOffer.tempo_garantia)) throw Error('GARANTIA_FORNECEDOR_ALTERADA');
      if (preparation.catalogProductId) {
        const catalog = await fetchMLResult<any>(`/products/${preparation.catalogProductId}`);
        if (!catalog.ok || catalog.data?.status !== 'active') throw Error('CATALOGO_INDISPONIVEL');
        if (preparation.catalogFingerprint !== pricingFingerprint({name:catalog.data.name,attributes:catalog.data.attributes,description:catalog.data.short_description})) throw Error('CATALOGO_ALTERADO_APOS_REVISAO');
        const identity = assessIdentity({local:identityFacts(listingPayload.attributes,{title:effectiveFamilyName}),remote:identityFacts(catalog.data.attributes,{title:catalog.data.name}),source:'catalog_live_before_post'});
        if (identity.identity !== 'IDENTIDADE_COHERENTE') throw Error('CATALOGO_IDENTIDADE_NAO_COHERENTE');
      }
      const payload = buildMlCreatePayload(listingPayload);
      const validation = await fetchMLResult<any>('/items/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (!catalogExpansionPayloadValidated(validation,payload)) throw Error(`PAYLOAD_ML_REPROVADO: ${validation.error?.message ?? validation.status}`);
      const renewed = await (supabase as any).rpc('acquire_sync_domain_lock',{p_domain:batchLock!.domain,p_owner_task:'catalog_expansion',p_owner_token:batchLock!.ownerToken,p_owner_job_id:null,p_ttl_seconds:300,p_metadata:{batchId:batch.batchId}});
      if (renewed.error || !renewed.data) throw Error('LOTE_LOCK_PERDIDO');
      const pending = await (supabase as any).from('pricing_events').select('event_type,produto_id').contains('payload',{batchId:batch.batchId});
      if (pending.error) throw Error('AUDITORIA_LOTE_INDISPONIVEL');
      assertCatalogExpansionCanAdvance(pending.data ?? []);
      await recordPricingEvent(supabase,{event_type:'CATALOG_EXPANSION_PAYLOAD_VALIDATED',produto_id:produto.id,pricing_source:'radar_launch',actor:auth.user.id,reason:'Payload validado pelo ML antes da criação',rule_id:safePrice.memory.policyVersion,payload:{batchId:batch.batchId,preparationId:batch.preparationId,approvalId:pricingApprovalId,payload,validation,warranty,memory:safePrice.memory}});
    }
    const creationClaim = await (supabase as any).from('pricing_events').insert({event_type:'CREATE_REQUESTED',produto_id:produto.id,pricing_source:batch?'radar_launch':'publication',actor:auth.user.id,reason:'Criação no alvo aprovada após revisão de identidade',new_price:initialPrice,rule_id:safePrice.memory.policyVersion,payload:{approvalId:pricingApprovalId,identity:finalIdentity,warranty,...(batch ? {batchId:batch.batchId,preparationId:batch.preparationId} : {})},dedupe_key:batch ? catalogExpansionKey(produto.id) : `create:${pricingApprovalId}`});
    if (creationClaim.error) {
      if (creationClaim.error.code === '23505') return NextResponse.json({success:false,error:'PUBLICACAO_JA_SOLICITADA_RECONCILIAR_ESTADO_REMOTO'},{status:409});
      throw new Error('AUDITORIA_PRICING_INDISPONIVEL');
    }
    batchAttempted = !!batch;
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
    batchRemoteId = result.id;

    await recordPricingEvent(supabase, {event_type:'CREATED_REMOTE', produto_id:produto.id, ml_item_id:result.id, pricing_source:batch?'radar_launch':'publication', actor:auth.user.id, reason:'POST aceito; confirmação remota pendente', rule_id:safePrice.memory.policyVersion, payload:{approvalId:pricingApprovalId,warranty,...(batch ? {batchId:batch.batchId} : {})}, dedupe_key:`created:${pricingApprovalId}`});
    let latestItem = await getListingSnapshot(result.id);
    if (!latestItem) {
      return NextResponse.json({success:false,error:'PUBLICACAO_READBACK_INCONCLUSIVO',ml_item_id:result.id},{status:409});
    }
    const warrantyConfirmed = warrantyTerms.every(expected => (latestItem?.sale_terms ?? []).some((actual:any) => actual.id === expected.id && (expected.value_id ? String(actual.value_id) === expected.value_id : String(actual.value_name) === expected.value_name)));
    if (!warrantyConfirmed) {
      batchCritical = true; batchReason = 'GARANTIA_POS_PUBLICACAO_DIVERGENTE';
      const pause = await pauseCreatedListing(result.id);
      await recordPricingEvent(supabase,{event_type:'CREATED_WARRANTY_MISMATCH',produto_id:produto.id,ml_item_id:result.id,pricing_source:batch?'radar_launch':'publication',actor:auth.user.id,reason:'Garantia remota difere da evidência aprovada',rule_id:safePrice.memory.policyVersion,payload:{warranty,expected:warrantyTerms,observed:latestItem?.sale_terms,pauseConfirmed:pause.ok,approvalId:pricingApprovalId}});
      return NextResponse.json({success:false,error:'GARANTIA_POS_PUBLICACAO_DIVERGENTE',ml_item_id:result.id,paused:pause.ok},{status:409});
    }

    const identityAssessment = assessMlProductIdentity(
      latestItem,
      { ...produto, gtin: gtinForMl || produto.gtin },
      supplierOffers || [],
    );
    const payloadReadbackIdentity = assessIdentity({
      local: identityFacts(Array.from(attributesMap.values()), { title: effectiveFamilyName, description: listingDescription, source: 'approved_payload' }),
      remote: identityFacts(latestItem.attributes ?? [], { title: latestItem.title ?? latestItem.family_name, source: `/items/${result.id}` }),
      source: 'approved_payload_vs_ml_readback',
    });
    const identityConflicts = identityAssessment.blockingConflicts;
    if (identityConflicts.length > 0 || payloadReadbackIdentity.identity === 'IDENTIDADE_DIVERGENTE') {
      batchCritical = true; batchReason = 'IDENTIDADE_POS_PUBLICACAO_DIVERGENTE';
      const pauseResult = await pauseCreatedListing(result.id);
      steps.anuncio = {
        ok: false,
        error:
          "Item criado, mas pausado antes da persistência por divergência material de identidade.",
      };
      return NextResponse.json(
        {
          success: false,
          steps,
          warnings,
          error: steps.anuncio.error,
          item_id: result.id,
          identity_conflicts: identityConflicts,
          payload_readback_identity: payloadReadbackIdentity,
          safety_pause: pauseResult,
        },
        { status: 409 },
      );
    }
    const identityReconciliation = await reconcileResolvedMlIdentity({
      client: supabase,
      produtoId: String(produto.id),
      itemId: String(result.id),
      canonicalBrand: identityAssessment.canonicalBrand,
    });
    if (!identityReconciliation.ok) {
      const pauseResult = await pauseCreatedListing(result.id);
      steps.anuncio = {
        ok: false,
        error: `Item criado, mas pausado porque a identidade validada não pôde ser consolidada: ${identityReconciliation.error}`,
      };
      return NextResponse.json(
        {
          success: false,
          steps,
          warnings,
          error: steps.anuncio.error,
          item_id: result.id,
          safety_pause: pauseResult,
        },
        { status: 500 },
      );
    }
    if (identityAssessment.canonicalBrand) {
      produto.marca = identityAssessment.canonicalBrand;
      warnings.push(
        `Marca local corrigida para ${identityAssessment.canonicalBrand} após confirmação por SKU e GTIN.`,
      );
    }

    const descriptionResult = latestItem.catalog_listing ? {ok:true as const} : await upsertListingDescription(
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

    latestItem = (await getListingSnapshot(result.id)) || latestItem;
    addListingStatusWarnings(latestItem, warnings);

    let mlFee = safePrice.mlFee || produto.ml_fee || 0.15;
    let mlShipping =
      ["profitable_shelf_2", "target_net_profit"].includes(String(pricingMode || ""))
        ? Number(safePrice.shipping || 0)
        : produto.ml_shipping || 0;
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

    const shippingResolution = await resolveMlShippingCost(
      result.id,
      getItemShippingMode(latestItem),
    );
    if (pricingMode !== "profitable_shelf_2" && shippingResolution.mlShipping > 0) {
      mlShipping = shippingResolution.mlShipping;
    }
    if (shippingResolution.warning) {
      warnings.push(shippingResolution.warning);
    }
    await supabase
      .from("produtos")
      .update({
        ml_shipping_warning: shippingResolution.warning || null,
      } as any)
      .eq("id", produto.id);

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

    const finalEvaluation = await evaluateProductPricing(supabase, { productId: produto.id, itemId: result.id, price: Number(latestItem.price), requireLive: true });
    if (finalEvaluation.memory) {
      const evaluationId = await persistPricingEvaluation(supabase, { ...finalEvaluation, memory: finalEvaluation.memory, scenario: 'current', itemId: result.id });
      await recordPricingEvent(supabase, { event_type: 'CREATED_READBACK', produto_id: produto.id, ml_item_id: result.id,
        evaluation_id: evaluationId, pricing_source: batch?'radar_launch':'publication', actor: auth.user.id, reason: 'Conferência após criação no alvo canônico',
        previous_price: null, new_price: initialPrice, rule_id: finalEvaluation.runtime.policy.version,
        payload: { approvalId:pricingApprovalId, warranty, memory_status: finalEvaluation.memory.status, diagnostics: finalEvaluation.memory.diagnostics } });
      pricingCorrection.final_price = initialPrice;
      if (finalEvaluation.memory.result === null || finalEvaluation.memory.diagnostics.length) {
        pricingCorrection.status = 'pending';
        pricingCorrection.error = 'REVISAR_ECONOMIA_POS_PUBLICACAO';
        warnings.push('Economia após criação exige revisão; nenhuma correção cega de preço foi aplicada.');
      }
    } else {
      pricingCorrection.status = 'pending';
      pricingCorrection.error = finalEvaluation.failure ?? 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL';
    }

    if (batch) {
      const issues = catalogExpansionReadbackIssues({price:initialPrice,quantity:listingPayload.availableQuantity,categoryId:categoriaId,catalogProductId:listingPayload.catalogProductId},latestItem,finalEvaluation.memory);
      if (payloadReadbackIdentity.identity !== 'IDENTIDADE_COHERENTE') issues.push('IDENTIDADE_INCONCLUSIVA');
      if (!descriptionResult.ok) issues.push('DESCRICAO_NAO_CONFIRMADA');
      if (issues.length) {
        batchReason = issues.join('|');
        batchCritical = issues.some(i => !['ECONOMIA_INCONCLUSIVA','STATUS_NAO_VALIDADO','IDENTIDADE_INCONCLUSIVA','DESCRICAO_NAO_CONFIRMADA'].includes(i));
        return NextResponse.json({success:false,error:batchReason,ml_item_id:result.id},{status:409});
      }
    }
    const quantityPricingResult = { ok: false };
    steps.atacado = { ok: false, error: 'Desconto por quantidade removido pela política comercial.' };
    await persistListingLink({
      supabase,
      produto,
      produtoId,
      item: latestItem,
      mlFee,
      mlShipping,
      mlStatus: mapMlItemStatus(latestItem),
      desiredMlStatus: mapCreatedListingDesiredStatus(latestItem),
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

    if (batch) {
      const readback = await getListingSnapshot(result.id);
      const post = readback ? await evaluateProductPricing(supabase,{productId:produto.id,itemId:result.id,price:Number(readback.price),requireLive:true}) : null;
      const issues = catalogExpansionReadbackIssues({price:initialPrice,quantity:listingPayload.availableQuantity,categoryId:categoriaId,catalogProductId:listingPayload.catalogProductId},readback,post?.memory);
      if (readback) {
        const identity = assessIdentity({local:identityFacts(listingPayload.attributes,{title:effectiveFamilyName,description:listingDescription}),remote:identityFacts(readback.attributes,{title:readback.title || readback.family_name}),source:'final_readback'});
        if (identity.identity !== 'IDENTIDADE_COHERENTE') issues.push('IDENTIDADE_NAO_CONFIRMADA');
        if (!warrantyTerms.every(expected=>(readback.sale_terms??[]).some((actual:any)=>actual.id===expected.id && (expected.value_id?String(actual.value_id)===expected.value_id:String(actual.value_name)===expected.value_name)))) issues.push('GARANTIA_DIVERGENTE');
        if (!readback.pictures?.length) issues.push('IMAGENS_AUSENTES');
      }
      if (issues.length) { batchReason=issues.join('|');batchCritical=issues.some(i=>!['READBACK_INDISPONIVEL','ECONOMIA_INCONCLUSIVA','STATUS_NAO_VALIDADO'].includes(i));return NextResponse.json({success:false,error:batchReason,ml_item_id:result.id},{status:409}); }
      const group = await resolveMlPricingGroup(supabase,readback);
      if (!group.complete || group.itemIds.some(id=>id!==result.id)) {batchCritical=true;batchReason='VINCULO_INESPERADO_POS_PUBLICACAO';return NextResponse.json({success:false,error:batchReason,ml_item_id:result.id},{status:409});}
      const evaluationId = await persistPricingEvaluation(supabase,{...post!,memory:post!.memory!,scenario:'current',itemId:result.id,groupId:group.groupId});
      await recordPricingEvent(supabase,{event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:produto.id,ml_item_id:result.id,pricing_group_id:group.groupId,evaluation_id:evaluationId,pricing_source:'radar_launch',actor:auth.user.id,reason:'PUBLICADO_VALIDADO',new_price:readback.price,rule_id:post!.memory!.policyVersion,dedupe_key:`validated:${catalogExpansionKey(produto.id)}`,payload:{batchId:batch.batchId,cohort:batch.batchId,preparationId:batch.preparationId,approvalId:pricingApprovalId,warranty,memory:post!.memory,baseline:{startAt:new Date().toISOString(),price:readback.price,margin:post!.memory!.margin,stock:readback.available_quantity,sales:readback.sold_quantity,visits:null},readback}});
      batchValidated = true;
    }
    const radarUpdate = await (supabase as any).from('radar_oportunidades').update({stage:'PUBLICADO_EXPERIMENTO',queue:'JA_ANUNCIADOS',processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('produto_id',produto.id);
    if(radarUpdate.error)warnings.push('Publicação confirmada; atualização da etapa do Radar pendente.');
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
      warranty,
      pricing_policy: { mode: 'canonical', memory: safePrice.memory, autonomy: 'REQUIRES_CONFIRMATION' },
      fiscal: fiscalErrors.length === 0 ? "ok" : fiscalErrors,
      fiscal_details: fiscalErrorDetails,
    });
  } catch (err: any) {
    batchReason = err.message;
    return NextResponse.json({ error: err.message, ...(batchRemoteId ? {ml_item_id:batchRemoteId} : {}) }, { status: 500 });
  } finally {
    try {
      if (batch && batchAttempted && !batchValidated) {
        const client = createServiceClient();
        let pauseConfirmed = false;
        if (batchCritical && batchRemoteId) {
          const block = await (client as any).from('ml_manual_blocklist').insert({ml_item_id:batchRemoteId,sku:null,ativo:true,motivo:`${batch.batchId}_SAFETY_STOP: ${batchReason}`,created_by:'catalog_expansion_safety_stop'});
          if (block.error) batchReason += '|BLOQUEIO_PERSISTENTE_FALHOU';
          await pauseCreatedListing(batchRemoteId);
          const state = await getListingSnapshot(batchRemoteId);
          pauseConfirmed = state?.status === 'paused';
        }
        await recordPricingEvent(client,{event_type:batchCritical?'CATALOG_EXPANSION_SAFETY_STOP':'CATALOG_EXPANSION_INCONCLUSIVE',produto_id:batchProductId,ml_item_id:batchRemoteId,pricing_source:'radar_launch',actor:auth.user.id,reason:batchReason,rule_id:batch.batchId,payload:{batchId:batch.batchId,preparationId:batch.preparationId,pauseConfirmed},dedupe_key:`stop:${catalogExpansionKey(batchProductId!)}`});
      }
    } finally {
      if (batchLock) await releaseDomainLock(batchLock);
      if (publicationLock) await releaseDomainLock(publicationLock);
    }
  }
}
