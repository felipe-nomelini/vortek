type CatalogAttribute = {
  id?: string | null;
  name?: string | null;
  value_id?: string | null;
  value_name?: string | null;
  values?: Array<{ id?: string | null; name?: string | null }>;
};

const IGNORED_ATTRIBUTE_IDS = new Set([
  "ITEM_CONDITION",
  "SELLER_SKU",
  "CATALOG_PRODUCT_ID",
]);

function normalize(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*([,;:/])\s*/g, "$1")
    .replace(/\s+/g, " ");
}

function attributeValue(attribute: CatalogAttribute | null | undefined): string | null {
  const direct = String(attribute?.value_id || attribute?.value_name || "").trim();
  if (direct) return direct;
  const values = Array.isArray(attribute?.values) ? attribute.values : [];
  const first = values[0];
  const value = String(first?.id || first?.name || "").trim();
  return value || null;
}

function attributeLabel(attribute: CatalogAttribute | null | undefined): string | null {
  const direct = String(attribute?.value_name || "").trim();
  if (direct) return direct;
  const values = Array.isArray(attribute?.values) ? attribute.values : [];
  const value = String(values[0]?.name || attribute?.value_id || values[0]?.id || "").trim();
  return value || null;
}

function attributesById(source: any): Map<string, CatalogAttribute> {
  const map = new Map<string, CatalogAttribute>();
  for (const attribute of Array.isArray(source?.attributes) ? source.attributes : []) {
    const id = String(attribute?.id || "").trim().toUpperCase();
    if (id) map.set(id, attribute);
  }
  return map;
}

export function catalogAttributeMismatches(item: any, catalogProduct: any) {
  const itemAttributes = attributesById(item);
  const mismatches: Array<{
    id: string;
    name: string;
    itemValue: string;
    catalogValue: string;
  }> = [];

  for (const [id, catalogAttribute] of attributesById(catalogProduct)) {
    if (IGNORED_ATTRIBUTE_IDS.has(id)) continue;
    const itemAttribute = itemAttributes.get(id);
    const itemValue = attributeValue(itemAttribute);
    const catalogValue = attributeValue(catalogAttribute);
    if (!itemValue || !catalogValue || normalize(itemValue) === normalize(catalogValue)) continue;
    mismatches.push({
      id,
      name: String(catalogAttribute?.name || itemAttribute?.name || id),
      itemValue,
      catalogValue,
    });
  }

  return mismatches;
}

function localHandOrientation(product: any): "destro" | "canhoto" | null {
  const text = normalize([product?.nome, product?.descricao].filter(Boolean).join(" "));
  const hasLeft = /\bcanhot[oa]?\b/.test(text);
  const hasRight = /\bdestro\b/.test(text);
  if (hasLeft && hasRight) return null;
  if (hasLeft) return "canhoto";
  if (hasRight) return "destro";
  return null;
}

function titleHandOrientation(value: unknown): "destro" | "canhoto" | null {
  const text = normalize(value);
  const hasLeft = /\bcanhot[oa]?\b|\bmao esquerda\b|\bleft handed\b/.test(text);
  const hasRight = /\bdestro\b|\bmao direita\b|\bright handed\b/.test(text);
  if (hasLeft && hasRight) return null;
  if (hasLeft) return "canhoto";
  if (hasRight) return "destro";
  return null;
}

function titlePackQuantity(value: unknown): number | null {
  const text = normalize(value);
  const match = text.match(
    /\b(?:kit|pack|combo|conjunto|lote)\s*(?:com|de)?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:unidades?|unds?|itens?|pecas?|pcs?)\b|\b(?:c|ct|cartela|car|bli|pct|dz|cem|tub)\s*(?:\/|x)\s*(\d{1,3})\b/,
  );
  const quantity = Number(match?.[1] || match?.[2] || match?.[3] || 0);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

function catalogTitleCriticalMismatches(product: any, catalogProduct: any) {
  const localTitle = String(product?.nome || "").trim();
  const catalogTitle = String(catalogProduct?.name || catalogProduct?.title || "").trim();
  if (!localTitle || !catalogTitle) return [];

  const mismatches: Array<{
    id: string;
    name: string;
    itemValue: string;
    catalogValue: string;
  }> = [];
  const localOrientation = titleHandOrientation(localTitle);
  const catalogOrientation = titleHandOrientation(catalogTitle);
  if (catalogOrientation && localOrientation !== catalogOrientation) {
    mismatches.push({
      id: "TITLE_HAND_ORIENTATION",
      name: "Orientação no título",
      itemValue: localOrientation || "não confirmada no título local",
      catalogValue: catalogOrientation,
    });
  }

  const localQuantity = titlePackQuantity(localTitle);
  const catalogQuantity = titlePackQuantity(catalogTitle);
  if (catalogQuantity && catalogQuantity > 1 && localQuantity !== catalogQuantity) {
    mismatches.push({
      id: "TITLE_PACK_QUANTITY",
      name: "Quantidade do kit no título",
      itemValue: localQuantity ? String(localQuantity) : "produto unitário",
      catalogValue: String(catalogQuantity),
    });
  }

  return mismatches;
}

export function catalogLocalCriticalMismatches(product: any, catalogProduct: any) {
  const titleMismatches = catalogTitleCriticalMismatches(product, catalogProduct);
  const orientation = attributeLabel(attributesById(catalogProduct).get("HAND_ORIENTATION"));
  if (!orientation) return titleMismatches;

  const expected = localHandOrientation(product);
  if (!expected) {
    return [...titleMismatches, {
      id: "HAND_ORIENTATION",
      name: "Orientação da mão",
      itemValue: "não confirmada no produto local",
      catalogValue: orientation,
    }];
  }
  if (normalize(expected) === normalize(orientation)) return titleMismatches;
  return [...titleMismatches, {
    id: "HAND_ORIENTATION",
    name: "Orientação da mão",
    itemValue: expected,
    catalogValue: orientation,
  }];
}

export function catalogCompatibilityMismatches(params: {
  item: any;
  catalogProduct: any;
  localProduct?: any | null;
}) {
  const mismatches = catalogAttributeMismatches(params.item, params.catalogProduct);
  if (params.localProduct) {
    mismatches.push(...catalogLocalCriticalMismatches(params.localProduct, params.catalogProduct));
  }
  return mismatches;
}
