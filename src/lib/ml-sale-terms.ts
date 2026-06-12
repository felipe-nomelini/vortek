export const DEFAULT_ML_WARRANTY_TIME = '12 meses';
export const DEFAULT_ML_WARRANTY_TYPE_ID = '2230279';
export const DEFAULT_ML_WARRANTY_TYPE_NAME = 'Garantia de fábrica';

export type MlSaleTerm = { id: string; value_name?: string; value_id?: string };

const VALID_WARRANTY_UNITS = new Set(['dia', 'dias', 'mes', 'meses', 'ano', 'anos']);

function normalizeWarrantyUnit(unit: string) {
  const normalized = unit
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'mes') return 'meses';
  if (normalized === 'dia') return 'dias';
  if (normalized === 'ano') return 'anos';
  return normalized;
}

export function normalizeMlWarrantyTime(input: unknown): string {
  const text = String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const match = text.match(/\b(\d+)\s+(dias?|mes(?:es)?|anos?)\b/);
  if (!match) return DEFAULT_ML_WARRANTY_TIME;

  const amount = Number(match[1]);
  const unit = normalizeWarrantyUnit(match[2]);
  if (!Number.isFinite(amount) || amount <= 0 || !VALID_WARRANTY_UNITS.has(unit)) {
    return DEFAULT_ML_WARRANTY_TIME;
  }

  return `${amount} ${unit}`;
}

export function normalizeMlSaleTerms(terms: MlSaleTerm[]): MlSaleTerm[] {
  const byId = new Map<string, MlSaleTerm>();

  for (const term of terms || []) {
    const id = String(term?.id || '').trim().toUpperCase();
    if (!id) continue;

    const valueId = term?.value_id !== undefined && term?.value_id !== null
      ? String(term.value_id).trim()
      : '';
    const rawValueName = term?.value_name !== undefined && term?.value_name !== null
      ? String(term.value_name).trim()
      : '';
    const valueName = id === 'WARRANTY_TIME' ? normalizeMlWarrantyTime(rawValueName) : rawValueName;

    if (!valueId && !valueName) continue;

    byId.set(id, {
      id,
      ...(valueId ? { value_id: valueId } : {}),
      ...(valueName ? { value_name: valueName } : {}),
    });
  }

  if (!byId.has('WARRANTY_TYPE')) {
    byId.set('WARRANTY_TYPE', {
      id: 'WARRANTY_TYPE',
      value_id: DEFAULT_ML_WARRANTY_TYPE_ID,
      value_name: DEFAULT_ML_WARRANTY_TYPE_NAME,
    });
  }

  if (!byId.has('WARRANTY_TIME')) {
    byId.set('WARRANTY_TIME', {
      id: 'WARRANTY_TIME',
      value_name: DEFAULT_ML_WARRANTY_TIME,
    });
  }

  return Array.from(byId.values());
}
