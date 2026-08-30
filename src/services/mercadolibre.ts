import {
  fetchML,
  fetchMLResult,
  getValidMLToken,
} from "./integration";
import { normalizeMlSaleTerms } from "@/lib/ml-sale-terms";
import {
  applyItemQuantityPricing,
  previewItemQuantityPricing as resolveItemQuantityPricingPreview,
  type QuantityPricingApplyResult,
  type QuantityPricingPreviewResult,
} from "@/lib/ml/quantity-pricing";

export type {
  QuantityPricingApplyResult,
  QuantityPricingTier,
} from "@/lib/ml/quantity-pricing";

export interface MLCategoryPrediction {
  domain_id: string;
  domain_name: string;
  category_id: string;
  category_name: string;
  attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
}

export interface MLAttribute {
  id: string;
  name: string;
  tags: {
    required?: boolean;
    catalog_required?: boolean;
    fixed?: boolean;
    hidden?: boolean;
  };
  value_type: "list" | "number" | "string" | "boolean" | "number_unit";
  values?: Array<{ id: string; name: string }>;
  allowed_units?: Array<{ id: string; name: string }>;
  default_unit?: string;
  hierarchy?: string;
}

export interface MLCreateItemInput {
  title?: string;
  familyName?: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: "new" | "used";
  listingTypeId: "gold_special" | "gold_pro";
  description: string;
  pictures: string[];
  attributes: Array<{ id: string; value_name?: string; value_id?: string }>;
  sellerCustomField?: string;
  saleTerms?: Array<{ id: string; value_name?: string; value_id?: string }>;
  fiscalData?: {
    gtin?: string;
    ncm?: string;
    cest?: string;
    csosn?: string;
    net_weight?: number;
    gross_weight?: number;
    measurement_unit?: string;
    origem_fiscal?: string;
    fci?: string;
    ex_tipi?: string;
    cost?: number;
  };
  shipping?: {
    mode?: string;
    localPickUp?: boolean;
    freeShipping?: boolean;
  };
}

export interface MLCreateItemResult {
  id: string;
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  status: string;
}

function sanitizeMlAttributes(
  attrs: Array<{ id: string; value_name?: string; value_id?: string }>,
): Array<{ id: string; value_name?: string; value_id?: string }> {
  const byId = new Map<
    string,
    { id: string; value_name?: string; value_id?: string }
  >();
  for (const attr of attrs || []) {
    const id = String(attr?.id || "")
      .trim()
      .toUpperCase();
    if (!id) continue;

    const valueId =
      attr?.value_id !== undefined && attr?.value_id !== null
        ? String(attr.value_id).trim()
        : "";
    const valueName =
      attr?.value_name !== undefined && attr?.value_name !== null
        ? String(attr.value_name).trim()
        : "";
    if (!valueId && !valueName) continue;

    byId.set(id, {
      id,
      ...(valueId ? { value_id: valueId } : {}),
      ...(valueName ? { value_name: valueName } : {}),
    });
  }
  return Array.from(byId.values());
}

function sanitizeMlSaleTerms(
  terms: Array<{ id: string; value_name?: string; value_id?: string }>,
): Array<{ id: string; value_name?: string; value_id?: string }> {
  const sanitized = (terms || [])
    .map((term) => {
      const id = String(term?.id || "")
        .trim()
        .toUpperCase();
      const valueId =
        term?.value_id !== undefined && term?.value_id !== null
          ? String(term.value_id).trim()
          : "";
      const valueName =
        term?.value_name !== undefined && term?.value_name !== null
          ? String(term.value_name).trim()
          : "";
      if (!id || (!valueId && !valueName)) return null;
      return {
        id,
        ...(valueId ? { value_id: valueId } : {}),
        ...(valueName ? { value_name: valueName } : {}),
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    value_name?: string;
    value_id?: string;
  }>;

  return normalizeMlSaleTerms(sanitized);
}

export async function predictCategory(
  title: string,
  limit: number = 3,
): Promise<MLCategoryPrediction[] | null> {
  const encoded = encodeURIComponent(title);
  return fetchML<MLCategoryPrediction[]>(
    `/sites/MLB/domain_discovery/search?q=${encoded}&limit=${limit}`,
  );
}

export async function getCategoryAttributes(
  categoryId: string,
): Promise<MLAttribute[] | null> {
  const data = await fetchML<any>(`/categories/${categoryId}/attributes`);
  if (!data) return null;
  // ML keeps EMPTY_GTIN_REASON hidden in the technical sheet, but it must be
  // available to the publication flow when a conditional GTIN is absent.
  return data.filter(
    (attribute: any) =>
      !attribute.tags?.hidden || attribute.id === "EMPTY_GTIN_REASON",
  );
}

export async function createListing(
  input: MLCreateItemInput,
): Promise<MLCreateItemResult | null> {
  const attributes = [...input.attributes];
  const hasSellerSku = attributes.some(
    (a) => a.id.toUpperCase() === "SELLER_SKU",
  );
  if (!hasSellerSku && input.sellerCustomField) {
    attributes.push({ id: "SELLER_SKU", value_name: input.sellerCustomField });
  }
  const saleTerms: Array<{
    id: string;
    value_name?: string;
    value_id?: string;
  }> = [...(input.saleTerms || [])];

  if (input.fiscalData) {
    if (input.fiscalData.gtin)
      attributes.push({ id: "GTIN", value_name: input.fiscalData.gtin });
    if (!saleTerms.find((term) => term.id === "INVOICE")) {
      saleTerms.push({ id: "INVOICE", value_name: "Factura A" });
    }
  }

  const sanitizedAttributes = sanitizeMlAttributes(attributes);
  const sanitizedSaleTerms = sanitizeMlSaleTerms(saleTerms);

  const payload: Record<string, any> = {
    category_id: input.categoryId,
    price: input.price,
    currency_id: "BRL",
    available_quantity: input.availableQuantity,
    buying_mode: "buy_it_now",
    listing_type_id: input.listingTypeId,
    condition: input.condition,
    description: { plain_text: input.description },
    pictures: input.pictures.map((url) => ({ source: url })),
    attributes: sanitizedAttributes,
    seller_custom_field: input.sellerCustomField || undefined,
    sale_terms: sanitizedSaleTerms.length > 0 ? sanitizedSaleTerms : undefined,
    shipping: input.shipping
      ? {
          mode: input.shipping.mode || "me2",
          local_pick_up: input.shipping.localPickUp ?? false,
          free_shipping: input.shipping.freeShipping ?? true,
        }
      : { mode: "me2", local_pick_up: false, free_shipping: true },
  };

  if (input.familyName) {
    payload.family_name = input.familyName;
  } else {
    payload.title = input.title;
  }

  console.log("[ML createListing] payload:", JSON.stringify(payload, null, 2));

  const result = await fetchMLResult<MLCreateItemResult>("/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    const message = [
      result.error?.message || "Falha ao criar anúncio no ML",
      result.error?.code ? `code=${result.error.code}` : "",
      result.status ? `http=${result.status}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const error = new Error(message) as Error & {
      status?: number | null;
      code?: string | null;
      category?: string | null;
    };
    error.status = result.status;
    error.code = result.error?.code || null;
    error.category = result.error?.category || null;
    throw error;
  }
  return result.data;
}

export type MLDescriptionResult =
  | { ok: true; chars: number; method: "POST" | "PUT" }
  | {
      ok: false;
      error: string;
      statusHttp?: number | null;
      method?: "POST" | "PUT";
      code?: string | null;
    };

function summarizeMlError(
  result: Awaited<ReturnType<typeof fetchMLResult<any>>>,
) {
  return (
    result.error?.message ||
    (result.status
      ? `HTTP ${result.status}`
      : "Falha de comunicação com o Mercado Livre")
  );
}

export async function getListingDescription(
  itemId: string,
): Promise<{ plain_text?: string } | null> {
  return fetchML<{ plain_text?: string }>(
    `/items/${encodeURIComponent(itemId)}/description`,
  );
}

export async function upsertListingDescription(
  itemId: string,
  plainText: string,
): Promise<MLDescriptionResult> {
  const text = String(plainText || "").trim();
  if (!itemId) return { ok: false, error: "itemId ausente" };
  if (!text) return { ok: false, error: "Descrição vazia" };

  const path = `/items/${encodeURIComponent(itemId)}/description`;
  const payload = JSON.stringify({ plain_text: text.slice(0, 5000) });
  const headers = { "Content-Type": "application/json" };

  const current = await fetchMLResult<{ plain_text?: string }>(path);
  const preferredMethod: "POST" | "PUT" = current.ok ? "PUT" : "POST";
  let method = preferredMethod;
  let result = await fetchMLResult<any>(path, {
    method,
    headers,
    body: payload,
  });

  if (
    !result.ok &&
    method === "POST" &&
    [400, 409].includes(Number(result.status || 0))
  ) {
    method = "PUT";
    result = await fetchMLResult<any>(path, { method, headers, body: payload });
  }

  if (!result.ok) {
    return {
      ok: false,
      method,
      statusHttp: result.status,
      code: result.error?.code || null,
      error: summarizeMlError(result),
    };
  }

  const validation = await fetchMLResult<{ plain_text?: string }>(path);
  const savedText = String(validation.data?.plain_text || "").trim();
  if (!validation.ok || savedText.length === 0) {
    return {
      ok: false,
      method,
      statusHttp: validation.status,
      code: validation.error?.code || null,
      error: validation.ok
        ? "Descrição enviada, mas não confirmada no ML"
        : summarizeMlError(validation),
    };
  }

  return { ok: true, method, chars: savedText.length };
}

export async function upsertItemFiscalData(
  data: FiscalDataInput,
): Promise<FiscalApiResult<any>> {
  const result = await sendItemFiscalData(data);
  if (!result.success && result.status === 409) {
    return fiscalApiFetch(
      `/items/fiscal_information/${encodeURIComponent(data.sku)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }
  return result;
}

export interface UpdateFiscalDataInput {
  itemId: string;
  sku: string;
  title: string;
  ncm: string;
  origin_type: "manufacturer" | "reseller" | "imported";
  origin_detail: string;
  gtin?: string;
  cest?: string;
  csosn?: string;
  net_weight?: number;
  gross_weight?: number;
  measurement_unit?: string;
  cost?: number;
  fci?: string;
  ex_tipi?: string;
  tax_rule_id?: number;
}

type FiscalFailure = {
  success: false;
  step: string;
  error: string;
  statusHttp?: number | null;
  endpoint?: string;
  fields?: Array<{ field: string; message: string; error_code: string }>;
  rawBody?: any;
};

function summarizeFiscalError(
  result: Extract<FiscalApiResult<any>, { success: false }>,
  endpoint: string,
) {
  const fieldErrors = (result.fields || [])
    .map((field) => `${field.field}: ${field.message}`)
    .join(" | ");
  return {
    statusHttp: result.status,
    endpoint,
    fields: result.fields,
    rawBody: result.rawBody,
    error: [result.error, fieldErrors, result.code ? `code=${result.code}` : ""]
      .filter(Boolean)
      .join(" | "),
  };
}

export async function updateListingFiscalData(
  data: UpdateFiscalDataInput,
): Promise<{ success: true } | FiscalFailure> {
  const fiscalPayload: FiscalDataInput = {
    sku: data.sku,
    title: data.title,
    type: "single",
    measurement_unit: data.measurement_unit || "UN",
    cost: data.cost,
    tax_information: {
      ncm: data.ncm,
      origin_type: data.origin_type,
      origin_detail: data.origin_detail,
      ean: data.gtin,
      cest: data.cest,
      net_weight: data.net_weight,
      gross_weight: data.gross_weight,
      fci: data.fci,
      ex_tipi: data.ex_tipi,
      tax_rule_id: data.tax_rule_id,
    },
  };

  const upsertResult = await upsertItemFiscalData(fiscalPayload);
  if (!upsertResult.success) {
    return {
      success: false,
      step: "criar_dados_fiscais",
      ...summarizeFiscalError(upsertResult, "/items/fiscal_information"),
    };
  }

  const skuCheckResult = await getFiscalDataBySku(data.sku);
  if (!skuCheckResult.success) {
    return {
      success: false,
      step: "validar_sku_fiscal",
      ...summarizeFiscalError(
        skuCheckResult,
        `/items/fiscal_information/${data.sku}`,
      ),
      error: `SKU fiscal não encontrado/criado no ML após upsert: ${summarizeFiscalError(skuCheckResult, `/items/fiscal_information/${data.sku}`).error}`,
    };
  }

  const linkResult = await linkFiscalDataToItem(data.sku, data.itemId);
  if (!linkResult.success) {
    return {
      success: false,
      step: "vincular_sku",
      ...summarizeFiscalError(linkResult, "/items/fiscal_information/items"),
    };
  }

  const invoiceResult = await setItemInvoiceSaleTerm(data.itemId);
  if (!invoiceResult) {
    return {
      success: false,
      step: "invoice_term",
      error: "Falha ao setar INVOICE sale_term",
    };
  }

  return { success: true };
}

export interface FiscalDataInput {
  sku: string;
  title: string;
  type: "single" | "bundle";
  measurement_unit?: string;
  cost?: number;
  tax_information: {
    ncm: string;
    origin_type: "manufacturer" | "reseller" | "imported";
    origin_detail: string;
    ean?: string;
    cest?: string;
    csosn?: string;
    tax_rule_id?: number;
    fci?: string;
    ex_tipi?: string;
    net_weight?: number;
    gross_weight?: number;
    med_anvisa_code?: string;
    med_exemption_reason?: string;
  };
}

export type FiscalApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      status: number | null;
      error: string;
      code?: string | null;
      fields?: Array<{ field: string; message: string; error_code: string }>;
      rawBody?: any;
    };

async function fiscalApiFetch<T>(
  path: string,
  options: RequestInit,
): Promise<FiscalApiResult<T>> {
  const token = await getValidMLToken();
  if (!token)
    return { success: false, status: 401, error: "Token ML não disponível" };

  const doFetch = async (tok: string) => {
    return fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
    });
  };

  let res = await doFetch(token);

  if (res.status === 401) {
    console.warn(
      JSON.stringify({
        event: "ml_auth_retry",
        attempt: "retry_after_forced_refresh",
        path,
        method: options.method || "GET",
        status: 401,
        timestamp_utc: new Date().toISOString(),
      }),
    );
    const freshToken = await getValidMLToken(true);
    if (!freshToken)
      return {
        success: false,
        status: 401,
        error: "Token expirado - refresh falhou",
      };
    res = await doFetch(freshToken);
    if (res.status === 401) {
      return {
        success: false,
        status: 401,
        error: "Falha de autenticação no Mercado Livre após refresh forçado",
      };
    }
  }

  const rawText = await res.text().catch(() => "");
  let body: any = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      error:
        typeof body === "object" && body
          ? body.message || body.error || `HTTP ${res.status}`
          : rawText || `HTTP ${res.status}`,
      code:
        typeof body === "object" && body
          ? body.code || body.error_code || body.error || null
          : null,
      fields: typeof body === "object" && body ? body.fields : undefined,
      rawBody: body,
    };
  }

  return { success: true, data: body as T };
}

export async function sendItemFiscalData(
  data: FiscalDataInput,
): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch("/items/fiscal_information", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getFiscalDataBySku(
  sku: string,
): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch(
    `/items/fiscal_information/${encodeURIComponent(sku)}`,
    {
      method: "GET",
    },
  );
}

export async function linkFiscalDataToItem(
  sku: string,
  itemId: string,
  variationId?: string,
): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch("/items/fiscal_information/items", {
    method: "POST",
    body: JSON.stringify({
      sku,
      item_id: itemId,
      variation_id: variationId || "",
    }),
  });
}

export async function getItemFiscalData(
  itemId: string,
): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch(`/items/${itemId}/fiscal_information/detail`, {
    method: "GET",
  });
}

export async function checkCanInvoice(
  itemId: string,
): Promise<
  FiscalApiResult<{
    item_id: string;
    seller_id: string;
    variation_id: string;
    status: boolean;
  }>
> {
  return fiscalApiFetch(`/can_invoice/items/${itemId}`, {
    method: "GET",
  });
}

export async function searchItemBySellerSku(
  sku: string,
): Promise<string | null> {
  const me = await fetchML<{ id: number }>("/users/me");
  if (!me) return null;
  const data = await fetchML<{ results: string[] }>(
    `/users/${me.id}/items/search?seller_sku=${encodeURIComponent(sku)}`,
  );
  if (!data?.results?.length) return null;
  for (const itemId of data.results) {
    const item = await fetchML<{ id: string; status?: string }>(
      `/items/${encodeURIComponent(itemId)}?attributes=id,status`,
    );
    const status = String(item?.status || "").toLowerCase();
    if (item?.id && ["active", "paused"].includes(status)) return item.id;
  }
  return null;
}

export async function setItemInvoiceSaleTerm(itemId: string): Promise<boolean> {
  const result = await fetchML(`/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sale_terms: [{ id: "INVOICE", value_name: "Factura A" }],
    }),
  });
  return result !== null;
}

export async function setItemQuantityPricing(
  itemId: string,
  basePrice: number,
): Promise<QuantityPricingApplyResult> {
  try {
    const result = await applyItemQuantityPricing(
      fetchMLResult,
      itemId,
      basePrice,
    );
    console.log(
      JSON.stringify({
        event: "ml_quantity_pricing_validation",
        timestamp_utc: new Date().toISOString(),
        ml_item_id: itemId,
        base_price: Math.round(basePrice * 100) / 100,
        recommendation_source: result.recommendationSource,
        tiers_expected: result.tiersExpected,
        tiers_found: result.tiersFound,
        result: result.ok ? "ok" : result.code,
      }),
    );
    return result;
  } catch (err: any) {
    console.error(
      `[setItemQuantityPricing] Erro para ${itemId}:`,
      err.message || err,
    );
    return {
      ok: false,
      error: err?.message || "Erro inesperado ao publicar preços de atacado",
      code: "quantity_pricing_exception",
      httpStatus: null,
      providerBody: null,
      recommendationSource: null,
      tiersExpected: [],
      tiersFound: [],
    };
  }
}

export async function previewItemQuantityPricing(
  itemId: string,
  basePrice: number,
  currencyId = "BRL",
): Promise<QuantityPricingPreviewResult> {
  return resolveItemQuantityPricingPreview(
    fetchMLResult,
    itemId,
    basePrice,
    currencyId,
  );
}

export async function updateItemPrice(
  itemId: string,
  price: number,
): Promise<boolean> {
  try {
    const result = await fetchML<any>(`/items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price }),
    });

    const ok = Boolean(result && result.id);
    if (ok) {
      console.log(`[updateItemPrice] Sucesso item=${itemId} price=${price}`);
      return true;
    }

    console.warn(
      `[updateItemPrice] Resposta inesperada item=${itemId}`,
      result,
    );
    return false;
  } catch (err: any) {
    console.error(
      `[updateItemPrice] Falha item=${itemId}:`,
      err?.message || err,
    );
    return false;
  }
}
