import type { ConflictAssessment, ConflictEvidence, ConflictStatus } from '../types/commercial-conflicts';

export type MlIdentityAttribute = { id: string; tags?: Record<string, boolean>; values?: { id: string; name: string }[] };
export type MlIdentityFact = { value: string | null; evidence: ConflictEvidence[]; ambiguous?: boolean };
export type MlIdentityFacts = Record<string, MlIdentityFact>;
export type MlIdentityComparison = {
  field: string; dimension: 'identity' | 'packaging_quantity';
  local: string | null; remote: string | null; status: ConflictStatus; reason: string;
  evidence: ConflictEvidence[];
};
export type MlExistingListingValidationComparison = {
  field: string;
  local: string | null;
  remote: string | null;
  status: ConflictStatus;
  reason: string;
};
export type MlExistingListingValidation = {
  status: 'verified' | 'pending' | 'conflict';
  anchor: 'product' | 'homogeneous_kit_component' | null;
  reasons: string[];
  comparisons: MlExistingListingValidationComparison[];
};
export type MlListingIdentityAssessment = {
  identityState: 'IDENTIDADE_COHERENTE' | 'IDENTIDADE_DIVERGENTE' | 'IDENTIDADE_INCONCLUSIVA';
  identity: ConflictAssessment; packaging_quantity: ConflictAssessment; comparisons: MlIdentityComparison[];
  /** Regra adicional, somente para operar um anúncio já existente. */
  existingListingValidation?: MlExistingListingValidation;
};
export type MlIdentityContext = {
  categoryAttributes: MlIdentityAttribute[] | null; remoteEvidence: ConflictEvidence | null; variationId?: string | null;
  brandEquivalences?: BrandEquivalences;
};
export type BrandEquivalences = ReadonlyMap<string, string>;
const PACK_FIELDS = ['SALE_FORMAT', 'UNITS_PER_PACK', 'PACKS_NUMBER', 'PACKAGES_NUMBER', 'PACKAGING_BOXES_NUMBER'];
const IDENTITY_FIELDS = ['SELLER_SKU', 'GTIN', 'BRAND', 'MODEL', 'MPN', 'PART_NUMBER', 'COLOR', 'VOLTAGE', 'NOMINAL_VOLTAGE', 'DIAMETER', 'BLADES_DIAMETER'];
const INTERNAL_IDENTITY_FIELDS = new Set(['KIT_COMPOSITION']);
const EXISTING_LISTING_COMMERCIAL_FIELDS = new Set([
  'SELLER_SKU', 'GTIN', 'BRAND', 'MODEL', 'MPN', 'PART_NUMBER', ...PACK_FIELDS,
]);
export const isMlIdentityAttribute = (id: string) => [...IDENTITY_FIELDS, ...PACK_FIELDS].includes(id);
const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

/** O ML às vezes grava uma descrição no MODEL; aceita somente o código literal completo no texto. */
function hasExactModelCodeMention(localValue: string, remoteValue: string): boolean {
  const tokens = (value: string) => normalizeText(value).match(/[a-z0-9]+/g) || [];
  const localTokens = tokens(localValue);
  if (localTokens.length === 0 || localTokens.length > 3) return false;
  const code = localTokens.join('');
  if (code.length < 5 || !/[a-z]/.test(code) || !/\d/.test(code)) return false;
  const remoteTokens = tokens(remoteValue);
  const prefix = code.match(/^[a-z]+/)?.[0] || '';
  if (prefix.length < 2 || remoteTokens.filter(token => token.startsWith(prefix)).length !== 1) return false;
  for (let start = 0; start < remoteTokens.length; start++) {
    for (let count = 1; count <= 3 && start + count <= remoteTokens.length; count++) {
      if (remoteTokens.slice(start, start + count).join('') === code) return true;
    }
  }
  return false;
}

export function brandKey(value: unknown): string { return normalizeText(value); }

/** Pares aprovados formam grupos; sem equivalência por semelhança textual. */
export function buildBrandEquivalences(pairs: Array<{ brand_a_key: string; brand_b_key: string }>): BrandEquivalences {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    const previous = parent.get(key);
    if (!previous || previous === key) return key;
    const resolved = root(previous);
    parent.set(key, resolved);
    return resolved;
  };
  for (const pair of pairs) {
    const a = brandKey(pair.brand_a_key);
    const b = brandKey(pair.brand_b_key);
    if (!a || !b || a === b) continue;
    const left = root(a);
    const right = root(b);
    if (left !== right) parent.set(left < right ? right : left, left < right ? left : right);
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
  }
  return new Map([...parent.keys()].map(key => [key, root(key)]));
}

export function equivalentBrandKey(value: unknown, aliases?: BrandEquivalences): string {
  const key = brandKey(value);
  return aliases?.get(key) || key;
}

export function mergeMlAttributePrefill(params: {
  prediction?: Record<string, string | undefined>; initial?: Record<string, string | undefined>;
  ruleBased?: Record<string, string | undefined>; strictEvidence?: boolean; keepRuleBased?: boolean;
}): { value_id?: string; value_name?: string } {
  return { ...(params.strictEvidence ? {} : params.prediction || {}), ...(params.initial || {}), ...(params.ruleBased || {}) };
}

export function normalizeMlDiameter(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)$/i);
  if (!match) return null;
  const cm = Number(match[1].replace(',', '.')) * ({ mm: 0.1, cm: 1, m: 100 }[match[2].toLowerCase()]!);
  return cm > 0 && Number.isFinite(cm) ? `${Number(cm.toFixed(6))} cm` : null;
}

export function extractStrictProductDiameter(value: unknown): string | null {
  const matches = Array.from(String(value ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*cm\b/gi))
    .map(match => normalizeMlDiameter(match[0])).filter(Boolean);
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : null;
}

/** Somente valores da categoria resolvem value_id; nunca comparar ID interno com rótulo. */
export function readMlIdentityAttribute(attributes: any[], field: string, definitions: MlIdentityAttribute[]): string[] {
  const definition = definitions.find(attr => attr.id === field);
  return attributes.filter(attr => attr?.id === field).flatMap(attr => {
    const entries = Array.isArray(attr.values) && attr.values.length ? attr.values : [attr];
    return entries.map((entry: any) => {
      const id = entry === attr ? entry.value_id : entry.id;
      if (id === '-1') return null;
      return (entry === attr ? entry.value_name : entry.name) ?? definition?.values?.find(value => value.id === id)?.name ?? null;
    }).filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
  });
}

export function normalizeMlIdentityValue(field: string, value: string): string | null {
  if (field === 'SALE_FORMAT') {
    const format = normalizeText(value);
    if (['kit', 'pack', 'pacote'].includes(format)) return 'pack';
    if (['unit', 'unidad', 'unidade'].includes(format)) return 'unit';
    return format || null;
  }
  if (field === 'GTIN') {
    const digits = value.replace(/\s/g, '');
    return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) ? digits.padStart(14, '0') : null;
  }
  if (['UNITS_PER_PACK', 'PACKS_NUMBER', 'PACKAGES_NUMBER', 'PACKAGING_BOXES_NUMBER'].includes(field)) {
    return /^\d+$/.test(value.trim()) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? String(Number(value)) : null;
  }
  if (['DIAMETER', 'BLADES_DIAMETER'].includes(field)) return normalizeMlDiameter(value);
  if (['VOLTAGE', 'NOMINAL_VOLTAGE'].includes(field)) return normalizeText(value).replace(/\s+/g, '').replace(',', '.');
  return normalizeText(value) || null;
}

function dimensionAssessment(dimension: MlIdentityComparison['dimension'], comparisons: MlIdentityComparison[]): ConflictAssessment {
  const rows = comparisons.filter(row => row.dimension === dimension);
  const confirmed = rows.filter(row => row.status === 'CONFLITO_CONFIRMADO');
  const status: ConflictStatus = confirmed.length ? 'CONFLITO_CONFIRMADO'
    : rows.some(row => row.status === 'INCONCLUSIVO') ? 'INCONCLUSIVO'
      : !rows.length || rows.some(row => row.status === 'PENDENCIA_VALIDACAO') ? 'PENDENCIA_VALIDACAO' : 'SEM_CONFLITO';
  const reasons = rows.map(row => ({ code: `${row.field}:${row.reason}`, ruleId: 'M2M-CFL-02' }));
  const evidence = (confirmed.length ? confirmed : rows).flatMap(row => row.evidence);
  const details = {
    coverage: rows.length && rows.every(row => row.status === 'SEM_CONFLITO' || row.status === 'CONFLITO_CONFIRMADO') ? 'complete' as const : 'partial' as const,
    reasons: (reasons.length ? reasons : [{ code: 'DIMENSAO_NAO_AVALIADA', ruleId: 'M2M-CFL-02' }]) as [{ code: string; ruleId: string }, ...{ code: string; ruleId: string }[]],
  };
  if ((status === 'SEM_CONFLITO' || status === 'CONFLITO_CONFIRMADO') && evidence.length) return { ...details, status, evidence: evidence as [ConflictEvidence, ...ConflictEvidence[]] };
  return { ...details, status: status === 'INCONCLUSIVO' ? status : 'PENDENCIA_VALIDACAO', evidence };
}

/** Identidade/apresentação somente; não autoriza vínculo, publicação ou pausa. */
export function assessMlListingIdentity(item: any, facts: MlIdentityFacts, context: MlIdentityContext): MlListingIdentityAssessment {
  const comparisons: MlIdentityComparison[] = [];
  const definitions = context.categoryAttributes || [];
  let attributes = Array.isArray(item?.attributes) ? item.attributes : [];
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  let variantMissing = false;
  if (variations.length) {
    const selected = variations.filter((variation: any) => context.variationId
      ? String(variation.id) === context.variationId
      : facts.SELLER_SKU?.value && normalizeText(variation.seller_custom_field || readMlIdentityAttribute(variation.attributes || [], 'SELLER_SKU', definitions)[0]) === normalizeText(facts.SELLER_SKU.value));
    variantMissing = selected.length !== 1;
    if (!variantMissing) {
      const variant = selected[0];
      const own = [...(variant.attribute_combinations || []), ...(variant.attributes || [])];
      if (variant.seller_custom_field) own.push({ id: 'SELLER_SKU', value_name: variant.seller_custom_field });
      const ids = new Set(own.map((attr: any) => attr.id));
      attributes = [...attributes.filter((attr: any) => {
        const tags = definitions.find(def => def.id === attr.id)?.tags;
        return !ids.has(attr.id) && attr.id !== 'GTIN' && !tags?.variation_attribute && !tags?.allow_variations;
      }), ...own];
    }
  } else if (item?.seller_custom_field) attributes = [...attributes, { id: 'SELLER_SKU', value_name: item.seller_custom_field }];

  const definitionIds = new Set(definitions.map(attribute => attribute.id));
  const observedAttributeIds = new Set(attributes.map((attribute: any) => String(attribute?.id || '')));
  // A validação de identidade compara somente campos de identidade/apresentação
  // aceitos pela categoria. Atributos editoriais obrigatórios continuam sendo
  // validados pelo endpoint condicional e por /items/validate na publicação.
  const fields = new Set(definitions.length
    ? [
        'SELLER_SKU',
        ...Object.keys(facts).filter(field => field === 'SELLER_SKU' || definitionIds.has(field) || INTERNAL_IDENTITY_FIELDS.has(field)),
        ...definitions.filter(attribute => isMlIdentityAttribute(attribute.id) && observedAttributeIds.has(attribute.id))
          .map(attribute => attribute.id),
      ]
    : Object.keys(facts));
  const localGtin = facts.GTIN?.value ? normalizeMlIdentityValue('GTIN', facts.GTIN.value) : null;
  const remoteGtins = readMlIdentityAttribute(attributes, 'GTIN', definitions)
    .map(value => normalizeMlIdentityValue('GTIN', value))
    .filter((value): value is string => Boolean(value));
  const exactGtin = Boolean(localGtin)
    && new Set(remoteGtins).size === 1
    && remoteGtins[0] === localGtin;
  const exactCatalogGtin = item?.catalog_listing === true && exactGtin;
  const remoteSkus = [
    ...readMlIdentityAttribute(attributes, 'SELLER_SKU', definitions),
    ...(!variations.length && item?.seller_custom_field ? [String(item.seller_custom_field)] : []),
  ].map(normalizeText).filter(Boolean);
  const exactSku = Boolean(facts.SELLER_SKU?.value)
    && new Set(remoteSkus).size === 1
    && remoteSkus[0] === normalizeText(facts.SELLER_SKU.value);
  const remoteBrands = readMlIdentityAttribute(attributes, 'BRAND', definitions)
    .map(value => equivalentBrandKey(value, context.brandEquivalences)).filter(Boolean);
  const exactBrand = Boolean(facts.BRAND?.value && !facts.BRAND.ambiguous && facts.BRAND.evidence.length)
    && new Set(remoteBrands).size === 1
    && remoteBrands[0] === equivalentBrandKey(facts.BRAND!.value, context.brandEquivalences);
  for (const field of fields) {
    const fact = facts[field];
    const rawValues = readMlIdentityAttribute(attributes, field, definitions);
    const normalized = (value: string) => field === 'BRAND'
      ? equivalentBrandKey(value, context.brandEquivalences)
      : normalizeMlIdentityValue(field, value);
    const remoteValues = [...new Set(rawValues.map(normalized))];
    const local = fact?.value ? normalized(fact.value) : null;
    const remote = remoteValues.length === 1 ? remoteValues[0] : null;
    const evidence = [...(fact?.evidence || []), ...(context.remoteEvidence ? [context.remoteEvidence] : [])];
    let status: ConflictStatus = 'SEM_CONFLITO';
    let reason = 'COERENTE';
    if (variantMissing) { status = 'PENDENCIA_VALIDACAO'; reason = 'VARIANTE_NAO_IDENTIFICADA'; }
    else if (fact?.ambiguous || remoteValues.length > 1) { status = 'INCONCLUSIVO'; reason = 'FONTES_CONTRADITORIAS'; }
    else if (evidence.some(proof => proof.condition !== 'valid' || !proof.reference?.trim() || !proof.collectedAt || !Number.isFinite(Date.parse(proof.collectedAt))) || !context.remoteEvidence) { status = 'INCONCLUSIVO'; reason = 'FONTE_NAO_CONCLUSIVA'; }
    else if ((fact?.value && local === null) || (rawValues.length && remoteValues.includes(null))) { status = 'INCONCLUSIVO'; reason = 'VALOR_INVALIDO'; }
    else if (!local || !remote || !fact?.evidence.length) { status = 'PENDENCIA_VALIDACAO'; reason = 'EVIDENCIA_AUSENTE'; }
    else if (local !== remote) {
      // O produto de catálogo pode substituir o modelo enviado pelo rótulo
      // editorial da ficha oficial. O GTIN exato continua sendo a âncora forte.
      const modelNormalizedByExactCatalog = field === 'MODEL' && exactCatalogGtin;
      const modelCodeVerified = field === 'MODEL' && !modelNormalizedByExactCatalog
        && exactSku && exactGtin && exactBrand && Boolean(fact?.value)
        && rawValues.length === 1 && hasExactModelCodeMention(fact!.value!, rawValues[0]);
      const uncertainVoltage = ['VOLTAGE', 'NOMINAL_VOLTAGE'].includes(field) && [local, remote].every(value => ['120v', '127v'].includes(value));
      status = modelNormalizedByExactCatalog || modelCodeVerified ? 'SEM_CONFLITO'
        : uncertainVoltage || field === 'SELLER_SKU' ? 'INCONCLUSIVO' : 'CONFLITO_CONFIRMADO';
      reason = modelNormalizedByExactCatalog ? 'MODELO_NORMALIZADO_PELO_CATALOGO_COM_GTIN_EXATO'
        : modelCodeVerified ? 'MODELO_CODIGO_LITERAL_CONFIRMADO_COM_SKU_GTIN_MARCA'
        : uncertainVoltage ? 'EQUIVALENCIA_NAO_COMPROVADA'
          : field === 'SELLER_SKU' ? 'SKU_VINCULO_NAO_COMPROVADO'
            : PACK_FIELDS.includes(field) ? 'CONFLITO_EMBALAGEM_QUANTIDADE' : 'IDENTIDADE_DIVERGENTE';
    }
    comparisons.push({ field, dimension: PACK_FIELDS.includes(field) ? 'packaging_quantity' : 'identity', local: fact?.value || null, remote: rawValues.join(' | ') || null, status, reason, evidence });
  }
  for (const dimension of ['identity', 'packaging_quantity'] as const) {
    if (comparisons.some(row => row.dimension === dimension)) continue;
    const presentationNotApplicable = dimension === 'packaging_quantity'
      && definitions.length > 0
      && !definitions.some(attribute => PACK_FIELDS.includes(attribute.id));
    comparisons.push({
      field: dimension === 'identity' ? 'IDENTITY' : 'PRESENTATION', dimension, local: null, remote: null,
      status: presentationNotApplicable ? 'SEM_CONFLITO' : 'PENDENCIA_VALIDACAO',
      reason: presentationNotApplicable ? 'NAO_APLICAVEL_A_CATEGORIA' : 'EVIDENCIA_AUSENTE',
      evidence: presentationNotApplicable && context.remoteEvidence ? [context.remoteEvidence] : [],
    });
  }
  if (!context.categoryAttributes?.length) for (const dimension of ['identity', 'packaging_quantity'] as const) {
    comparisons.push({ field: 'CATEGORY', dimension, local: null, remote: null, status: 'PENDENCIA_VALIDACAO', reason: 'CRITERIOS_CATEGORIA_AUSENTES', evidence: [] });
  }
  const identity = dimensionAssessment('identity', comparisons);
  return { identityState: identity.status === 'SEM_CONFLITO' ? 'IDENTIDADE_COHERENTE' : identity.status === 'CONFLITO_CONFIRMADO' ? 'IDENTIDADE_DIVERGENTE' : 'IDENTIDADE_INCONCLUSIVA',
    identity, packaging_quantity: dimensionAssessment('packaging_quantity', comparisons), comparisons };
}

export function isMlIdentityComplete(assessment: MlListingIdentityAssessment): boolean {
  return [assessment.identity, assessment.packaging_quantity].every(value => value.status === 'SEM_CONFLITO' && value.coverage === 'complete');
}

/**
 * Contrato mínimo para operar um anúncio que já pertence à conta.
 *
 * Atributos editoriais obrigatórios da categoria (cor, apresentação, resolução etc.)
 * continuam sendo avaliados para qualidade/publicação, mas não impedem o vínculo de
 * um anúncio existente quando há SKU coerente, uma âncora forte e nenhum conflito
 * material confirmado. A criação de anúncio continua usando isMlIdentityComplete.
 */
export function isMlExistingListingIdentitySafe(assessment: MlListingIdentityAssessment): boolean {
  if (hasConfirmedMlExistingListingIdentityConflict(assessment)) return false;
  if (assessment.existingListingValidation) return assessment.existingListingValidation.status === 'verified';
  const coherent = (field: string) => assessment.comparisons.some(
    comparison => comparison.field === field && comparison.status === 'SEM_CONFLITO',
  );
  const skuCoherent = coherent('SELLER_SKU');
  const strongAnchor = coherent('GTIN')
    || (coherent('BRAND') && ['MODEL', 'MPN', 'PART_NUMBER'].some(coherent));
  return skuCoherent && strongAnchor;
}

export function hasConfirmedMlExistingListingIdentityConflict(assessment: MlListingIdentityAssessment): boolean {
  return assessment.comparisons.some(comparison => EXISTING_LISTING_COMMERCIAL_FIELDS.has(comparison.field)
    && comparison.status === 'CONFLITO_CONFIRMADO');
}

export function hasConfirmedMlIdentityConflict(assessment: MlListingIdentityAssessment): boolean {
  return [assessment.identity, assessment.packaging_quantity].some(value => value.status === 'CONFLITO_CONFIRMADO');
}
