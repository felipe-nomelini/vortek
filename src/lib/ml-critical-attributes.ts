import { resolvePreferredOfferForProduct } from '@/lib/preferred-offer';
import { extractStrictVoltage, normalizeVoltageValue } from '@/lib/ml-voltage';
import { assessMlListingIdentity, extractStrictProductDiameter, hasConfirmedMlExistingListingIdentityConflict, isMlExistingListingIdentitySafe, normalizeMlIdentityValue, isMlIdentityAttribute } from '@/lib/ml-listing-identity';
import type { MlExistingListingValidation, MlIdentityContext, MlIdentityFacts, MlIdentityAttribute, MlListingIdentityAssessment } from '@/lib/ml-listing-identity';
import type { ConflictEvidence } from '@/types/commercial-conflicts';
import { filterOperationalDropshippingSupplierOffers } from '@/lib/dslite/supplier-policy';

export { extractStrictVoltage, normalizeVoltageValue } from '@/lib/ml-voltage';
export type MlIdentityKit = {
  status: 'not_kit' | 'ready' | 'inconclusive';
  components: { quantidade: number; produto: any; nestedKit: boolean | null }[];
};

/** Leitura do cadastro existente; componentes carregados em lote, sem inventar unidade base. */
export async function loadMlIdentityKit(client: { from: (table: string) => any }, productId: string): Promise<MlIdentityKit> {
  const { data: kit, error } = await client.from('produto_kits').select('produto_id,ativo').eq('produto_id', productId).maybeSingle();
  if (error) return { status: 'inconclusive', components: [] };
  if (!kit) return { status: 'not_kit', components: [] };
  if (!kit.ativo) return { status: 'inconclusive', components: [] };
  const { data: rows, error: componentError } = await client.from('produto_kit_componentes').select('componente_produto_id,quantidade').eq('kit_produto_id', productId);
  if (componentError || !rows?.length) return { status: 'inconclusive', components: [] };
  const componentIds = rows.map((row: any) => row.componente_produto_id);
  const [{ data: products, error: productError }, { data: nestedKits, error: nestedKitError }] = await Promise.all([
    client.from('produtos').select('id,nome,descricao,marca,gtin,ativo,updated_at').in('id', componentIds),
    client.from('produto_kits').select('produto_id').in('produto_id', componentIds),
  ]);
  if (productError || nestedKitError) return { status: 'inconclusive', components: [] };
  const nestedIds = new Set((nestedKits || []).map((nested: any) => String(nested.produto_id)));
  const components = rows.map((row: any) => ({
    quantidade: Number(row.quantidade),
    produto: products?.find((product: any) => product.id === row.componente_produto_id),
    nestedKit: nestedIds.has(String(row.componente_produto_id)),
  }));
  return { status: components.every((row: any) => row.produto?.ativo === true && Number.isSafeInteger(row.quantidade) && row.quantidade > 0) ? 'ready' : 'inconclusive', components };
}

const clean = (value: unknown) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
export const isMlCriticalAttributeId = (input: unknown) => isMlIdentityAttribute(String(input || '').toUpperCase());
export const normalizeCriticalAttributeValue = (attrId: unknown, value: unknown) => normalizeMlIdentityValue(String(attrId || '').toUpperCase(), String(value ?? ''));

function uniqueNumbers(input: string, pattern: RegExp): number[] {
  return [...new Set(Array.from(input.matchAll(pattern)).map(match => Number(match[1])))];
}
export function extractPackagesNumber(input: unknown): number | null {
  const values = uniqueNumbers(clean(input), /\b(?:quantidade de caixas|volumes de transporte|embalagem|contendo)\s*[:\-]?\s*(\d+)\s*(?:caixas?|volumes?)\b/g);
  return values.length === 1 && values[0] > 0 ? values[0] : null;
}

function proof(row: any, source: ConflictEvidence['source']): ConflictEvidence[] {
  const timestamp = row?.last_sync_at || row?.updated_at;
  if (!row?.id || !timestamp || !Number.isFinite(Date.parse(timestamp))) return [];
  return [{ source, reference: String(row.id), collectedAt: new Date(timestamp).toISOString(), condition: 'valid' }];
}

/** Fatos explícitos, não predições de categoria nem primeiro número encontrado. */
function rowFacts(row: any, source: ConflictEvidence['source']): MlIdentityFacts {
  const evidence = proof(row, source);
  const facts: MlIdentityFacts = {};
  const set = (field: string, value: unknown, ambiguous = false) => {
    if (value !== undefined && value !== null && String(value).trim()) facts[field] = { value: String(value).trim(), evidence, ambiguous };
    else if (ambiguous) facts[field] = { value: null, evidence, ambiguous: true };
  };
  set('BRAND', row?.marca); set('GTIN', row?.gtin);
  const text = clean([row?.nome, row?.descricao].filter(Boolean).join(' ; ').replace(/[\r\n]+/g, ';'));
  const labels = 'marca|modelo|part number|mpn|cor|tamanho|voltagem|tensao|formato de venda|apresentacao|conteudo(?: da embalagem)?';
  for (const [field, label] of [['MODEL', 'modelo'], ['MPN', 'part number|mpn'], ['COLOR', 'cor']] as const) {
    const values = [...new Set(Array.from(text.matchAll(new RegExp(`\\b(?:${label})\\s*:\\s*(.+?)(?=\\s+\\b(?:${labels})\\s*:|[;|]|$)`, 'g'))).map(match => match[1].trim()))];
    if (values.length) set(field, values.length === 1 ? values[0] : null, values.length > 1);
  }
  const voltages = [...new Set(Array.from(text.matchAll(/\b(?:\d+(?:[.,]\d+)?)\s*v(?:dc)?\b/g)).map(match => normalizeVoltageValue(match[0])))];
  if (voltages.length) {
    const voltage = voltages.length === 1 ? extractStrictVoltage(text) : null;
    set('VOLTAGE', voltage, voltages.length > 1);
  }
  const diameters = [...new Set(Array.from(text.matchAll(/diametro\s*:\s*(\d+(?:[.,]\d+)?\s*(?:mm|cm|m))\b/g)).map(match => normalizeMlIdentityValue('DIAMETER', match[1])))];
  set('DIAMETER', diameters.length === 1 ? diameters[0] : diameters.length > 1 ? null : (/\bventilador\b/.test(clean(row?.nome)) ? extractStrictProductDiameter(row.nome) : null), diameters.length > 1);
  const units = uniqueNumbers(text, /\b(?:kit\s+(?:com\s+)?|com\s+|conteudo(?: da embalagem)?\s*:\s*)(\d+)\s*(?:unidades?|pecas?|pilhas?|baterias?)\b/g);
  const explicitUnit = /\b(?:formato de venda|apresentacao)\s*:\s*unidade\b/.test(text);
  if (explicitUnit) units.push(1);
  const distinct = [...new Set(units)];
  if (distinct.length) {
    const count = distinct.length === 1 && distinct[0] > 0 ? distinct[0] : null;
    set('UNITS_PER_PACK', count, count === null);
    set('SALE_FORMAT', count === null ? null : count > 1 ? 'Kit' : 'Unidade', count === null);
  }
  const boxes = uniqueNumbers(text, /\b(?:quantidade de caixas|volumes de transporte|embalagem|contendo)\s*[:\-]?\s*(\d+)\s*(?:caixas?|volumes?)\b/g);
  if (boxes.length) set('PACKAGES_NUMBER', boxes.length === 1 && boxes[0] > 0 ? boxes[0] : null, boxes.length !== 1 || boxes[0] <= 0);
  return facts;
}

export function resolveMlCriticalFacts(produto: any, offers: any[] = [], operationalSupplierIds?: ReadonlySet<string>, kit?: MlIdentityKit) {
  const safeOffers = operationalSupplierIds ? filterOperationalDropshippingSupplierOffers(offers, operationalSupplierIds) : [];
  const preferredOffer = resolvePreferredOfferForProduct(safeOffers, produto?.oferta_preferencial_id, produto?.fornecedor_preferencial_manual === true);
  const facts = rowFacts(produto, 'product');
  if (produto?.sku) facts.SELLER_SKU = { value: String(produto.sku), evidence: proof(produto, 'product') };
  const supplier = rowFacts(preferredOffer, 'supplier');
  for (const [field, fact] of Object.entries(supplier)) {
    const own = facts[field];
    facts[field] = own ? {
      value: fact.value || own.value, evidence: [...own.evidence, ...fact.evidence],
      ambiguous: own.ambiguous || fact.ambiguous || Boolean(own.value && fact.value && normalizeMlIdentityValue(field, own.value) !== normalizeMlIdentityValue(field, fact.value)),
    } : fact;
  }
  if (kit?.status === 'ready') {
    const componentFacts = kit.components.map(row => ({ quantity: row.quantidade, facts: rowFacts(row.produto, 'product') }));
    const componentsComplete = componentFacts.every(row => row.facts.UNITS_PER_PACK?.value && !row.facts.UNITS_PER_PACK.ambiguous && row.facts.UNITS_PER_PACK.evidence.length);
    // Total só quando todos os componentes explicitam sua unidade comercial.
    const sum = componentsComplete ? componentFacts.reduce((sum, row) => sum + row.quantity * Number(row.facts.UNITS_PER_PACK.value), 0) : null;
    const total = sum !== null && Number.isSafeInteger(sum) && sum > 0 ? sum : null;
    const evidence = componentFacts.flatMap(row => row.facts.UNITS_PER_PACK?.evidence || []);
    for (const [field, value] of [['UNITS_PER_PACK', total === null ? null : String(total)], ['SALE_FORMAT', total === null ? null : total > 1 ? 'Kit' : 'Unidade']] as const) {
      const previous = facts[field];
      if (value === null && previous) continue;
      facts[field] = {
        value,
        evidence: [...(previous?.evidence || []), ...evidence],
        ambiguous: Boolean(previous?.ambiguous || (previous?.value && value && normalizeMlIdentityValue(field, previous.value) !== normalizeMlIdentityValue(field, value))),
      };
    }
    // Um kit composto não herda marca/modelo/GTIN ou formato de um componente arbitrário.
    if (kit.components.length > 1) facts.KIT_COMPOSITION = { value: null, evidence: [], ambiguous: false };
  } else if (!kit || kit.status === 'inconclusive') {
    for (const field of ['SALE_FORMAT', 'UNITS_PER_PACK']) facts[field] = { value: null, evidence: [], ambiguous: kit?.status === 'inconclusive' };
  }
  return { preferredOffer, facts };
}

export function resolveTrustedMlCriticalValue(attrId: unknown, produto: any, offers: any[] = [], operationalSupplierIds?: ReadonlySet<string>, kit?: MlIdentityKit, categoryAttributes?: MlIdentityAttribute[]): string | null {
  const id = String(attrId || '').toUpperCase();
  const { facts } = resolveMlCriticalFacts(produto, offers, operationalSupplierIds, kit);
  const field = ({ NOMINAL_VOLTAGE: 'VOLTAGE', BLADES_DIAMETER: 'DIAMETER', PACKAGING_BOXES_NUMBER: 'PACKAGES_NUMBER' } as Record<string, string>)[id] || id;
  // Dois atributos presentes podem descrever grandezas distintas (ex.: tensão de entrada e nominal).
  if (field !== id && categoryAttributes?.some(attr => attr.id === field)) return null;
  const fact = facts[field];
  return fact?.value && fact.evidence.length && !fact.ambiguous ? normalizeCriticalAttributeValue(id, fact.value) : null;
}

function normalizedRemoteValues(assessment: MlListingIdentityAssessment, field: string): string[] {
  const raw = assessment.comparisons.find(comparison => comparison.field === field)?.remote;
  if (!raw) return [];
  return [...new Set(raw.split(' | ').map(value => normalizeMlIdentityValue(field, value))
    .filter((value): value is string => Boolean(value)))];
}

function validFact(fact: MlIdentityFacts[string] | undefined): fact is MlIdentityFacts[string] & { value: string } {
  return Boolean(fact?.value && !fact.ambiguous && fact.evidence.length
    && fact.evidence.every(evidence => evidence.condition === 'valid'));
}

/**
 * Exceção estrita para um anúncio existente de kit homogêneo.
 * O identificador do componente é somente prova de comparação e nunca vira fato do produto pai.
 */
function kitExistingListingValidation(
  assessment: MlListingIdentityAssessment,
  facts: MlIdentityFacts,
  kit: MlIdentityKit,
): MlExistingListingValidation {
  const comparisons: MlExistingListingValidation['comparisons'] = [];
  const reasons: string[] = [];
  const compare = (field: string, local: string | null, remoteValues: string[], matches: boolean, reason: string) => {
    const remote = remoteValues.join(' | ') || null;
    comparisons.push({ field, local, remote,
      status: matches ? 'SEM_CONFLITO' : remote ? 'CONFLITO_CONFIRMADO' : 'PENDENCIA_VALIDACAO',
      reason: matches ? 'COERENTE' : reason });
    if (!matches) reasons.push(reason);
  };

  if (hasConfirmedMlExistingListingIdentityConflict(assessment)) return {
    status: 'conflict', anchor: null, reasons: ['CONFLITO_COMERCIAL_CONFIRMADO'], comparisons,
  };
  if (kit.status !== 'ready') return {
    status: 'pending', anchor: null, reasons: ['COMPOSICAO_DO_KIT_NAO_COMPROVADA'], comparisons,
  };
  if (kit.components.length !== 1) return {
    status: 'pending', anchor: null, reasons: ['KIT_HETEROGENEO_NAO_E_VALIDADO_AUTOMATICAMENTE'], comparisons,
  };
  const component = kit.components[0];
  if (component.nestedKit !== false) return {
    status: 'pending', anchor: null, reasons: ['COMPONENTE_DO_KIT_ANINHADO_OU_NAO_COMPROVADO'], comparisons,
  };

  const sku = assessment.comparisons.find(comparison => comparison.field === 'SELLER_SKU');
  compare('SELLER_SKU', sku?.local || null, normalizedRemoteValues(assessment, 'SELLER_SKU'),
    sku?.status === 'SEM_CONFLITO', 'SKU_NAO_COHERENTE');

  const componentFacts = rowFacts(component.produto, 'product');
  const parentBrand = validFact(facts.BRAND) ? facts.BRAND : null;
  const componentBrand = validFact(componentFacts.BRAND) ? componentFacts.BRAND : null;
  const brandsAgree = !parentBrand || !componentBrand
    || normalizeMlIdentityValue('BRAND', parentBrand.value) === normalizeMlIdentityValue('BRAND', componentBrand.value);
  const localBrand = brandsAgree ? (parentBrand || componentBrand) : null;
  const remoteBrands = normalizedRemoteValues(assessment, 'BRAND');
  compare('BRAND', localBrand?.value || null, remoteBrands,
    Boolean(localBrand && remoteBrands.length === 1
      && normalizeMlIdentityValue('BRAND', localBrand.value) === remoteBrands[0]),
    brandsAgree ? 'MARCA_NAO_COHERENTE' : 'MARCAS_LOCAIS_CONTRADITORIAS');

  const saleFormats = normalizedRemoteValues(assessment, 'SALE_FORMAT');
  compare('SALE_FORMAT', 'Kit', saleFormats, saleFormats.length === 1 && saleFormats[0] === 'pack',
    'FORMATO_DE_VENDA_DO_KIT_NAO_COMPROVADO');
  const units = normalizedRemoteValues(assessment, 'UNITS_PER_PACK');
  const quantity = String(component.quantidade);
  compare('UNITS_PER_PACK', quantity, units, units.length === 1 && units[0] === quantity,
    'QUANTIDADE_DO_KIT_DIVERGENTE');
  const packs = normalizedRemoteValues(assessment, 'PACKS_NUMBER');
  compare('PACKS_NUMBER', '1', packs, packs.length === 0 || (packs.length === 1 && packs[0] === '1'),
    'NUMERO_DE_PACKS_DIVERGENTE');

  const productAnchor = isMlExistingListingIdentitySafe(assessment);
  let componentAnchor = false;
  const componentGtin = validFact(componentFacts.GTIN) ? componentFacts.GTIN.value : null;
  const remoteGtins = normalizedRemoteValues(assessment, 'GTIN');
  if (componentGtin && remoteGtins.length) {
    const normalizedGtin = normalizeMlIdentityValue('GTIN', componentGtin);
    componentAnchor = Boolean(normalizedGtin && remoteGtins.length === 1 && remoteGtins[0] === normalizedGtin);
    comparisons.push({ field: 'COMPONENT_GTIN', local: componentGtin, remote: remoteGtins.join(' | '),
      status: componentAnchor ? 'SEM_CONFLITO' : 'CONFLITO_CONFIRMADO',
      reason: componentAnchor ? 'COERENTE' : 'GTIN_DO_COMPONENTE_DIVERGENTE' });
    if (!componentAnchor) reasons.push('GTIN_DO_COMPONENTE_DIVERGENTE');
  } else {
    for (const field of ['MODEL', 'MPN', 'PART_NUMBER']) {
      const fact = componentFacts[field];
      if (!validFact(fact)) continue;
      const remoteValues = normalizedRemoteValues(assessment, field);
      const normalized = normalizeMlIdentityValue(field, fact.value);
      const matches = Boolean(normalized && remoteValues.length === 1 && remoteValues[0] === normalized);
      comparisons.push({ field: `COMPONENT_${field}`, local: fact.value, remote: remoteValues.join(' | ') || null,
        status: matches ? 'SEM_CONFLITO' : remoteValues.length ? 'CONFLITO_CONFIRMADO' : 'PENDENCIA_VALIDACAO',
        reason: matches ? 'COERENTE' : `IDENTIFICADOR_${field}_DO_COMPONENTE_NAO_COINCIDE` });
      componentAnchor ||= matches;
    }
  }
  if (!productAnchor && !componentAnchor) reasons.push('IDENTIFICADOR_DO_COMPONENTE_NAO_COINCIDE');

  const verified = reasons.length === 0 && (productAnchor || componentAnchor);
  const conflict = comparisons.some(comparison => comparison.status === 'CONFLITO_CONFIRMADO');
  return {
    status: verified ? 'verified' : conflict ? 'conflict' : 'pending',
    anchor: verified ? productAnchor ? 'product' : 'homogeneous_kit_component' : null,
    reasons: [...new Set(reasons)],
    comparisons,
  };
}

export function assessMlProductIdentity(item: any, produto: any, offers: any[] = [], operationalSupplierIds?: ReadonlySet<string>, context?: MlIdentityContext & { kit?: MlIdentityKit }) {
  const { facts } = resolveMlCriticalFacts(produto, offers, operationalSupplierIds, context?.kit);
  for (const [alias, original] of [['NOMINAL_VOLTAGE', 'VOLTAGE'], ['BLADES_DIAMETER', 'DIAMETER'], ['PACKAGING_BOXES_NUMBER', 'PACKAGES_NUMBER']]) {
    if (context?.categoryAttributes?.some(attr => attr.id === alias) && !context.categoryAttributes.some(attr => attr.id === original) && facts[original]) { facts[alias] = facts[original]; delete facts[original]; }
  }
  const assessment = assessMlListingIdentity(item, facts, context || { categoryAttributes: null, remoteEvidence: null });
  if (context?.kit && context.kit.status !== 'not_kit') {
    assessment.existingListingValidation = kitExistingListingValidation(assessment, facts, context.kit);
  }
  return assessment;
}
