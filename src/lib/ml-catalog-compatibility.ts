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
  if (/\bcanhot[oa]?\b/.test(text)) return "canhoto";
  if (/\bdestro\b/.test(text)) return "destro";
  return null;
}

export function catalogLocalCriticalMismatches(product: any, catalogProduct: any) {
  const orientation = attributeValue(attributesById(catalogProduct).get("HAND_ORIENTATION"));
  if (!orientation) return [];

  const expected = localHandOrientation(product);
  if (!expected) {
    return [{
      id: "HAND_ORIENTATION",
      name: "Orientação da mão",
      itemValue: "não confirmada no produto local",
      catalogValue: orientation,
    }];
  }
  if (normalize(expected) === normalize(orientation)) return [];
  return [{
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
