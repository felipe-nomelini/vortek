import { fetchML } from '@/services/integration';
import type { MLCategoryPrediction } from '@/services/mercadolibre';

const PET_CATEGORY_ROOT = 'Pet Shop';
const PET_SUPPLIER_DSLITE_IDS = new Set(['100']);
const PREFERRED_PET_CATEGORIES: Record<string, { id: string; name: string }> = {
  coat_liquid: { id: 'MLB178927', name: 'Shampoo e Condicionadores' },
  coat_other: { id: 'MLB434769', name: 'Outros artigos para os pêlos' },
  perfume: { id: 'MLB178938', name: 'Perfumes' },
  soap: { id: 'MLB223363', name: 'Sabonete' },
  brush: { id: 'MLB178925', name: 'Escovas e Pentes' },
  hygiene_other: { id: 'MLB178923', name: 'Outros higiene e limpeza' },
  repellent: { id: 'MLB277779', name: 'Repelentes Líquidos' },
};

export function requiresPetShopCategory(produto: any) {
  const fornecedor = String(produto?.fornecedor || '').toLowerCase();
  const dsliteFornecedorId = String(produto?.dslite_fornecedor_id || '').trim();
  return fornecedor.includes('aurium') || PET_SUPPLIER_DSLITE_IDS.has(dsliteFornecedorId);
}

export async function getMlCategoryRoot(categoryId: string): Promise<string | null> {
  const category = await fetchML<any>(`/categories/${encodeURIComponent(categoryId)}`);
  const path = Array.isArray(category?.path_from_root) ? category.path_from_root : [];
  return path[0]?.name ? String(path[0].name) : null;
}

export async function filterPetShopPredictions(predictions: MLCategoryPrediction[] | null) {
  if (!Array.isArray(predictions) || predictions.length === 0) return [];

  const filtered: MLCategoryPrediction[] = [];
  for (const prediction of predictions) {
    const categoryId = String(prediction?.category_id || '').trim();
    if (!categoryId) continue;
    const root = await getMlCategoryRoot(categoryId).catch(() => null);
    if (root === PET_CATEGORY_ROOT) filtered.push(prediction);
  }

  return filtered;
}

export async function assertAllowedMlCategoryForProduct(produto: any, categoryId: string) {
  if (!requiresPetShopCategory(produto)) return;

  const root = await getMlCategoryRoot(categoryId);
  if (root !== PET_CATEGORY_ROOT) {
    throw new Error(`Fornecedor pet exige categoria Mercado Livre em "${PET_CATEGORY_ROOT}". Categoria recebida: ${root || categoryId}.`);
  }
}

export function getPreferredPetCategoryForTitle(title: unknown) {
  const text = String(title || '').toLowerCase();
  if (/deo\s*col|col[oô]nia|perfume/.test(text)) return PREFERRED_PET_CATEGORIES.perfume;
  if (/sabonete/.test(text)) return PREFERRED_PET_CATEGORIES.soap;
  if (/rasqueadeira|\bpente\b|escova|removedor/.test(text)) return PREFERRED_PET_CATEGORIES.brush;
  if (/desinfetante|espuma/.test(text)) return PREFERRED_PET_CATEGORIES.hygiene_other;
  if (/educador|repelente/.test(text)) return PREFERRED_PET_CATEGORIES.repellent;
  if (/mascara|máscara|creme para pentear|termoprotetor|finalizador|anti-frizz/.test(text)) return PREFERRED_PET_CATEGORIES.coat_other;
  if (/shampoo|condicionador/.test(text)) return PREFERRED_PET_CATEGORIES.coat_liquid;
  return null;
}
