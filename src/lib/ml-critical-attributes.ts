import { resolvePreferredOfferForProduct } from '@/lib/preferred-offer';
import { extractStrictVoltage, normalizeVoltageValue } from '@/lib/ml-voltage';
import { assessMlListingIdentity, extractStrictProductDiameter, normalizeMlIdentityValue, isMlIdentityAttribute } from '@/lib/ml-listing-identity';
import type { MlIdentityContext, MlIdentityFacts, MlIdentityAttribute } from '@/lib/ml-listing-identity';
import type { ConflictEvidence } from '@/types/commercial-conflicts';
import { filterOperationalDropshippingSupplierOffers } from '@/lib/dslite/supplier-policy';

export { extractStrictVoltage, normalizeVoltageValue } from '@/lib/ml-voltage';
export type MlIdentityKit = { status: 'not_kit' | 'ready' | 'inconclusive'; components: { quantidade: number; produto: any }[] };

/** Leitura do cadastro existente; componentes carregados em lote, sem inventar unidade base. */
export async function loadMlIdentityKit(client: { from: (table: string) => any }, productId: string): Promise<MlIdentityKit> {
  const { data: kit, error } = await client.from('produto_kits').select('produto_id,ativo').eq('produto_id', productId).maybeSingle();
  if (error) return { status: 'inconclusive', components: [] };
  if (!kit) return { status: 'not_kit', components: [] };
  if (!kit.ativo) return { status: 'inconclusive', components: [] };
  const { data: rows, error: componentError } = await client.from('produto_kit_componentes').select('componente_produto_id,quantidade').eq('kit_produto_id', productId);
  if (componentError || !rows?.length) return { status: 'inconclusive', components: [] };
  const { data: products, error: productError } = await client.from('produtos').select('id,nome,descricao,marca,gtin,ativo,updated_at').in('id', rows.map((row: any) => row.componente_produto_id));
  if (productError) return { status: 'inconclusive', components: [] };
  const components = rows.map((row: any) => ({ quantidade: Number(row.quantidade), produto: products?.find((product: any) => product.id === row.componente_produto_id) }));
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
  for (const [field, label] of [['MODEL', 'modelo'], ['MPN', 'part number|mpn'], ['COLOR', 'cor']] as const) {
    const values = [...new Set(Array.from(text.matchAll(new RegExp(`(?:^|[;|\\n])\\s*(?:${label})\\s*:\\s*([^;|]+)`, 'g'))).map(match => match[1].trim()))];
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
      facts[field] = { value, evidence, ambiguous: Boolean(previous?.ambiguous || (previous?.value && value && normalizeMlIdentityValue(field, previous.value) !== normalizeMlIdentityValue(field, value))) };
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

export function assessMlProductIdentity(item: any, produto: any, offers: any[] = [], operationalSupplierIds?: ReadonlySet<string>, context?: MlIdentityContext & { kit?: MlIdentityKit }) {
  const { facts } = resolveMlCriticalFacts(produto, offers, operationalSupplierIds, context?.kit);
  for (const [alias, original] of [['NOMINAL_VOLTAGE', 'VOLTAGE'], ['BLADES_DIAMETER', 'DIAMETER'], ['PACKAGING_BOXES_NUMBER', 'PACKAGES_NUMBER']]) {
    if (context?.categoryAttributes?.some(attr => attr.id === alias) && !context.categoryAttributes.some(attr => attr.id === original) && facts[original]) { facts[alias] = facts[original]; delete facts[original]; }
  }
  return assessMlListingIdentity(item, facts, context || { categoryAttributes: null, remoteEvidence: null });
}
