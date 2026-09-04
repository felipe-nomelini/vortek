export const ML_WARRANTY_TYPE_NAMES = {
  '2230279': 'Garantia de fábrica',
  '2230280': 'Garantia do vendedor',
} as const;

export type MlWarrantyTypeId = keyof typeof ML_WARRANTY_TYPE_NAMES;
export type MlWarrantyUnit = 'dias' | 'meses' | 'anos';
export type MlWarrantyConfiguration = { typeId: MlWarrantyTypeId; duration: number; unit: MlWarrantyUnit };
export type MlSaleTerm = { id: string; value_name?: string; value_id?: string };
export type MlCategorySaleTerm = { id?: string; value_type?: string; values?: Array<{ id?: string; name?: string }> };

function normalizeWarrantyUnit(unit: string): MlWarrantyUnit | null {
  const normalized = unit
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'mes' || normalized === 'meses') return 'meses';
  if (normalized === 'dia' || normalized === 'dias') return 'dias';
  if (normalized === 'ano' || normalized === 'anos') return 'anos';
  return null;
}

export function formatMlWarrantyTime(configuration: Pick<MlWarrantyConfiguration, 'duration' | 'unit'>) {
  return `${configuration.duration} ${configuration.unit}`;
}

export function normalizeMlWarrantyTime(input: unknown): string | null {
  const text = String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const match = text.match(/^\s*(\d+)\s+(dias?|mes(?:es)?|anos?)\s*$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = normalizeWarrantyUnit(match[2]);
  if (!Number.isInteger(amount) || amount <= 0 || !unit) return null;

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
    const valueName = id === 'WARRANTY_TIME' ? normalizeMlWarrantyTime(rawValueName) || '' : rawValueName;

    if (!valueId && !valueName) continue;

    byId.set(id, {
      id,
      ...(valueId ? { value_id: valueId } : {}),
      ...(valueName ? { value_name: valueName } : {}),
    });
  }

  return Array.from(byId.values());
}

function normalizedText(value: unknown) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function buildSupportedMlWarrantyTerms(
  categoryTerms: MlCategorySaleTerm[],
  configuration: MlWarrantyConfiguration,
): MlSaleTerm[] {
  const typeSchema = categoryTerms.find((term) => String(term.id).toUpperCase() === 'WARRANTY_TYPE');
  const timeSchema = categoryTerms.find((term) => String(term.id).toUpperCase() === 'WARRANTY_TIME');
  const typeValue = typeSchema?.values?.find((value) => String(value.id) === configuration.typeId);
  if (!typeSchema || !timeSchema || !typeValue) return [];
  const formattedTime = formatMlWarrantyTime(configuration);
  const enumeratedTime = timeSchema.values?.find((value) => normalizedText(value.name) === normalizedText(formattedTime));
  if (timeSchema.values?.length && !enumeratedTime) return [];
  return [
    {
      id: 'WARRANTY_TYPE',
      value_id: configuration.typeId,
      value_name: String(typeValue.name || ML_WARRANTY_TYPE_NAMES[configuration.typeId]),
    },
    enumeratedTime
      ? { id: 'WARRANTY_TIME', value_id: String(enumeratedTime.id), value_name: String(enumeratedTime.name) }
      : { id: 'WARRANTY_TIME', value_name: formattedTime },
  ];
}
