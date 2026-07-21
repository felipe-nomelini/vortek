import { fetchML } from "@/services/integration";
import type { MLCategoryPrediction } from "@/services/mercadolibre";

const PET_CATEGORY_ROOT = "Pet Shop";
const PET_SUPPLIER_DSLITE_IDS = new Set(["100"]);
const HAYAMAX_DSLITE_IDS = new Set(["2"]);
const HAYAMAX_ELECTRIC_WIRES_CATEGORY = {
  id: "MLB455454",
  name: "Cabos Elétricos",
};
const HAYAMAX_ADJUSTABLE_DESK_CATEGORY = {
  id: "MLB193946",
  name: "Escrivaninhas",
};
const HAYAMAX_ELECTRIC_GRILL_CATEGORY = {
  id: "MLB48730",
  name: "Churrasqueiras Elétricas",
};
const PANASONIC_BATTERY_CATEGORY = {
  id: "MLB7060",
  name: "Pilhas",
};
const PANASONIC_COIN_BATTERY_CATEGORY = {
  id: "MLB431681",
  name: "Pilhas para Relógios",
};
const PREFERRED_PET_CATEGORIES: Record<string, { id: string; name: string }> = {
  coat_liquid: { id: "MLB178927", name: "Shampoo e Condicionadores" },
  coat_other: { id: "MLB434769", name: "Outros artigos para os pêlos" },
  perfume: { id: "MLB178938", name: "Perfumes" },
  soap: { id: "MLB223363", name: "Sabonete" },
  brush: { id: "MLB178925", name: "Escovas e Pentes" },
  hygiene_other: { id: "MLB178923", name: "Outros higiene e limpeza" },
  repellent: { id: "MLB277779", name: "Repelentes Líquidos" },
};

function normalizeCategoryText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function requiresPetShopCategory(produto: any) {
  const fornecedor = String(produto?.fornecedor || "").toLowerCase();
  const dsliteFornecedorId = String(produto?.dslite_fornecedor_id || "").trim();
  return (
    fornecedor.includes("aurium") ||
    PET_SUPPLIER_DSLITE_IDS.has(dsliteFornecedorId)
  );
}

export function requiresHayamaxCategoryGuard(produto: any) {
  const fornecedor = normalizeCategoryText(produto?.fornecedor);
  const dsliteFornecedorId = String(produto?.dslite_fornecedor_id || "").trim();
  return (
    fornecedor.includes("hayamax") || HAYAMAX_DSLITE_IDS.has(dsliteFornecedorId)
  );
}

export function isBlockedMlBrand(produto: any) {
  const brandText = normalizeCategoryText(
    `${produto?.marca || ""} ${produto?.nome || ""}`,
  );
  return /\bwahl\b/.test(brandText);
}

function getRequiredPanasonicBatteryCategory(produto: any) {
  const brand = normalizeCategoryText(produto?.marca);
  const text = normalizeCategoryText(
    `${produto?.nome || ""} ${produto?.categoria || ""}`,
  );
  if (!brand.includes("panasonic") || !/\b(?:pilha|bateria)\b/.test(text)) {
    return null;
  }
  return /\b(?:cr|lr|sr)\s*\d{3,4}\b|\bbotao\b/.test(text)
    ? PANASONIC_COIN_BATTERY_CATEGORY
    : PANASONIC_BATTERY_CATEGORY;
}

export function getPreferredHayamaxCategoryForProduct(produto: any) {
  const text = normalizeCategoryText(
    `${produto?.nome || ""} ${produto?.categoria || ""}`,
  );
  if (text.includes("fio paralelo")) return HAYAMAX_ELECTRIC_WIRES_CATEGORY;
  if (/materiais eletricos.*cabos e fios.*fios/.test(text))
    return HAYAMAX_ELECTRIC_WIRES_CATEGORY;
  if (
    text.includes("mesa eletrica") ||
    text.includes("altura ajustavel") ||
    text.includes("mesa gamer")
  ) {
    return HAYAMAX_ADJUSTABLE_DESK_CATEGORY;
  }
  if (
    text.includes("grill") &&
    (text.includes("arno") || text.includes("gnox"))
  ) {
    return HAYAMAX_ELECTRIC_GRILL_CATEGORY;
  }
  return null;
}

export async function getMlCategoryRoot(
  categoryId: string,
): Promise<string | null> {
  const category = await fetchML<any>(
    `/categories/${encodeURIComponent(categoryId)}`,
  );
  const path = Array.isArray(category?.path_from_root)
    ? category.path_from_root
    : [];
  return path[0]?.name ? String(path[0].name) : null;
}

export async function filterPetShopPredictions(
  predictions: MLCategoryPrediction[] | null,
) {
  if (!Array.isArray(predictions) || predictions.length === 0) return [];

  const filtered: MLCategoryPrediction[] = [];
  for (const prediction of predictions) {
    const categoryId = String(prediction?.category_id || "").trim();
    if (!categoryId) continue;
    const root = await getMlCategoryRoot(categoryId).catch(() => null);
    if (root === PET_CATEGORY_ROOT) filtered.push(prediction);
  }

  return filtered;
}

async function getMlCategoryInfo(
  categoryId: string,
): Promise<{ root: string | null; path: string; domain: string | null }> {
  const category = await fetchML<any>(
    `/categories/${encodeURIComponent(categoryId)}`,
  );
  const path = Array.isArray(category?.path_from_root)
    ? category.path_from_root
    : [];
  return {
    root: path[0]?.name ? String(path[0].name) : null,
    path: path
      .map((node: any) => String(node?.name || ""))
      .filter(Boolean)
      .join(" > "),
    domain: category?.settings?.catalog_domain
      ? String(category.settings.catalog_domain)
      : null,
  };
}

/**
 * Domain discovery is only a suggestion. Reject niche categories unless the
 * supplier title, description, or source category explicitly supports them.
 * This prevents false positives such as a coaxial cable being sent to Aquários.
 */
function assertNicheCategoryEvidence(produto: any, info: { path: string; domain: string | null }) {
  const source = normalizeCategoryText(
    `${produto?.nome || ""} ${produto?.descricao || ""} ${produto?.categoria || ""}`,
  );
  const target = normalizeCategoryText(`${info.path} ${info.domain || ""}`);
  const niches: Array<{ categoryTerms: string[]; sourceTerms: string[]; label: string }> = [
    {
      categoryTerms: ["aquario", "aquarios", "peixe", "peixes"],
      sourceTerms: ["aquario", "aquarios", "peixe", "peixes", "aquatico", "aquatica"],
      label: "Aquários/peixes",
    },
    {
      categoryTerms: ["caravana", "caravanas", "motorhome"],
      sourceTerms: ["caravana", "caravanas", "motorhome", "trailer"],
      label: "Caravanas/motorhomes",
    },
    {
      categoryTerms: ["pesca", "pescaria"],
      sourceTerms: ["pesca", "pescaria", "anzol", "vara de pesca"],
      label: "Pesca",
    },
    {
      categoryTerms: ["bebes", "bebe"],
      sourceTerms: ["bebe", "bebes", "infantil", "crianca", "criancas"],
      label: "Bebês",
    },
  ];

  for (const niche of niches) {
    if (!niche.categoryTerms.some((term) => target.includes(term))) continue;
    if (niche.sourceTerms.some((term) => source.includes(term))) continue;
    throw new Error(
      `Categoria ML sem evidência compatível no cadastro do fornecedor: ${niche.label}. Categoria recebida: ${info.path || "não identificada"}.`,
    );
  }
}

export async function assertAllowedMlCategoryForProduct(
  produto: any,
  categoryId: string,
) {
  if (isBlockedMlBrand(produto)) {
    throw new Error("Marca Wahl bloqueada para anúncios Mercado Livre.");
  }

  const categoryInfo = await getMlCategoryInfo(categoryId);
  assertNicheCategoryEvidence(produto, categoryInfo);

  const requiredPanasonicBatteryCategory =
    getRequiredPanasonicBatteryCategory(produto);
  if (
    requiredPanasonicBatteryCategory &&
    categoryId !== requiredPanasonicBatteryCategory.id
  ) {
    throw new Error(
      `Produto Panasonic de pilha/bateria exige categoria ML "${requiredPanasonicBatteryCategory.name}" (${requiredPanasonicBatteryCategory.id}).`,
    );
  }

  if (requiresPetShopCategory(produto)) {
    const root = await getMlCategoryRoot(categoryId);
    if (root !== PET_CATEGORY_ROOT) {
      throw new Error(
        `Fornecedor pet exige categoria Mercado Livre em "${PET_CATEGORY_ROOT}". Categoria recebida: ${root || categoryId}.`,
      );
    }
  }

  if (!requiresHayamaxCategoryGuard(produto)) return;

  const productText = normalizeCategoryText(
    `${produto?.nome || ""} ${produto?.categoria || ""}`,
  );
  const info = categoryInfo;
  const categoryText = normalizeCategoryText(
    `${categoryId} ${info.path} ${info.domain || ""}`,
  );

  if (
    productText.includes("fio paralelo") ||
    /materiais eletricos.*cabos e fios.*fios/.test(productText)
  ) {
    const isElectricCable =
      categoryId === HAYAMAX_ELECTRIC_WIRES_CATEGORY.id ||
      categoryText.includes("cabos eletricos");
    if (!isElectricCable) {
      throw new Error(
        `Hayamax fio elétrico exige categoria ML "${HAYAMAX_ELECTRIC_WIRES_CATEGORY.name}" (${HAYAMAX_ELECTRIC_WIRES_CATEGORY.id}). Categoria recebida: ${info.path || categoryId}.`,
      );
    }
  }

  if (
    (productText.includes("mesa eletrica") ||
      productText.includes("altura ajustavel") ||
      productText.includes("mesa gamer")) &&
    (categoryText.includes("lixadeira") ||
      categoryText.includes("manicure") ||
      categoryText.includes("pedicure"))
  ) {
    throw new Error(
      `Categoria ML incompatível para mesa Hayamax: ${info.path || categoryId}.`,
    );
  }

  if (productText.includes("grill") && productText.includes("arno")) {
    if (
      categoryText.includes("sanduicheira") ||
      categoryText.includes("sanduicheiras")
    ) {
      throw new Error(
        `Categoria ML incompatível para grill Arno Hayamax: ${info.path || categoryId}. Use categoria/domínio de grill/churrasqueira elétrica.`,
      );
    }
    if (
      categoryId !== HAYAMAX_ELECTRIC_GRILL_CATEGORY.id &&
      !categoryText.includes("churrasqueiras eletricas") &&
      !categoryText.includes("electric_grills")
    ) {
      throw new Error(
        `Categoria ML incompatível para grill Arno Hayamax: ${info.path || categoryId}.`,
      );
    }
  }

  if (productText.includes("lubrificante") && categoryText.includes("pc")) {
    throw new Error(
      `Categoria ML incompatível para lubrificante Hayamax: ${info.path || categoryId}.`,
    );
  }

  if (
    productText.includes("fio") &&
    /microcontrolador|microcontroller/.test(categoryText)
  ) {
    throw new Error(
      `Categoria ML incompatível para fio/cabo Hayamax: ${info.path || categoryId}.`,
    );
  }
}

export function getPreferredPetCategoryForTitle(title: unknown) {
  const text = String(title || "").toLowerCase();
  if (/deo\s*col|col[oô]nia|perfume/.test(text))
    return PREFERRED_PET_CATEGORIES.perfume;
  if (/sabonete/.test(text)) return PREFERRED_PET_CATEGORIES.soap;
  if (/rasqueadeira|\bpente\b|escova|removedor/.test(text))
    return PREFERRED_PET_CATEGORIES.brush;
  if (/desinfetante|espuma/.test(text))
    return PREFERRED_PET_CATEGORIES.hygiene_other;
  if (/educador|repelente/.test(text))
    return PREFERRED_PET_CATEGORIES.repellent;
  if (
    /mascara|máscara|creme para pentear|termoprotetor|finalizador|anti-frizz/.test(
      text,
    )
  )
    return PREFERRED_PET_CATEGORIES.coat_other;
  if (/shampoo|condicionador/.test(text))
    return PREFERRED_PET_CATEGORIES.coat_liquid;
  return null;
}
