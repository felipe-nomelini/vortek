import type { MlCategorySaleTerm, MlSaleTerm } from './ml-sale-terms';

/**
 * Regra comercial vigente definida pela diretoria da Bentevi.
 *
 * A garantia não depende de pesquisa, documento ou avaliação individual por
 * produto: todos os fornecedores operacionais oferecem 12 meses de garantia
 * de fábrica para os produtos comercializados pela empresa.
 */
export const warrantyPolicy = 'BNT-WARRANTY-FACTORY-12M-v1';
export const factoryWarranty = {
  typeId: '2230279',
  typeName: 'Garantia de fábrica',
  duration: 12,
  unit: 'meses',
  revision: warrantyPolicy,
} as const;

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

function warrantyTextSegments(text: string) {
  return text
    .replace(/(^|\n)\s*(garantia|warranty)\s*:?\s*\n\s*([^\n]+)/gi, '$1$2: $3')
    .split(/\n|(?<=[.!?])\s+/);
}

function durationInMonths(value: unknown): number | null {
  const match = normalize(value).match(/\b(\d+)\s*(dia|dias|mes|meses|ano|anos)\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (match[2].startsWith('ano')) return amount * 12;
  if (match[2].startsWith('mes')) return amount;
  return null;
}

/** Representa a política fixa no formato aceito pela categoria do Mercado Livre. */
export function warrantySaleTerms(schema: MlCategorySaleTerm[]): {
  terms: MlSaleTerm[];
  compatible: boolean;
  reason: string;
} {
  const type = schema.find((term) => String(term.id).toUpperCase() === 'WARRANTY_TYPE');
  const time = schema.find((term) => String(term.id).toUpperCase() === 'WARRANTY_TIME');
  const typeValue = type?.values?.find((value) => value.id === factoryWarranty.typeId);
  const enumeratedTime = time?.values?.find((value) => durationInMonths(value.name) === factoryWarranty.duration);
  const supportsMonths = time?.allowed_units?.some((unit) => normalize(unit.id || unit.name) === factoryWarranty.unit);

  if (!typeValue || !time || (time.values?.length && !enumeratedTime) || (!time.values?.length && !supportsMonths)) {
    return {
      terms: [],
      compatible: false,
      reason: 'Esta categoria não aceita a garantia de fábrica de 12 meses.',
    };
  }

  return {
    compatible: true,
    reason: 'Garantia de fábrica de 12 meses.',
    terms: [
      { id: 'WARRANTY_TYPE', value_id: factoryWarranty.typeId, value_name: typeValue.name || factoryWarranty.typeName },
      enumeratedTime
        ? { id: 'WARRANTY_TIME', value_id: enumeratedTime.id, value_name: enumeratedTime.name }
        : { id: 'WARRANTY_TIME', value_name: `${factoryWarranty.duration} ${factoryWarranty.unit}` },
    ],
  };
}

/** Normaliza somente a descrição enviada ao anúncio; o cadastro mestre é preservado. */
export function warrantyDescription(text: string): string {
  const clean = warrantyTextSegments(text)
    .filter((line) => !/garanti[ae]|warranty|^Preservados os direitos legais do consumidor\./i.test(line))
    .join('\n')
    .trim();
  return `${clean}\n\nGARANTIA\nGarantia de fábrica: 12 meses.`.trim();
}

/** Impede que uma entrada manual contradiga a regra comercial fixa. */
export function warrantyDescriptionConflicts(text: string): boolean {
  return warrantyTextSegments(text).some((line) => {
    if (!/garanti[ae]|warranty/i.test(line)) return false;
    const normalized = normalize(line);
    if (/sem garantia|no warranty/.test(normalized)) return true;
    if (/vendedor|supplier|fornecedor/.test(normalized) && !/fabricante|fabrica/.test(normalized)) return true;
    const duration = durationInMonths(line);
    return duration !== null && duration !== factoryWarranty.duration;
  });
}
