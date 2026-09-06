export type MlSaleTerm = { id: string; value_name?: string; value_id?: string };
export type WarrantyOrigin = 'FABRICANTE' | 'GARANTIA_FORNECEDOR' | 'GARANTIA_LEGAL';
export type WarrantyEvidence = {
  productId: string; gtin: string | null; offerId?: string | null;
  origin: 'FABRICANTE' | 'GARANTIA_FORNECEDOR'; duration: number;
  unit: 'dias' | 'meses' | 'anos'; source: string; observedAt: string;
};
export type DurabilityEvidence = { productId: string; gtin: string | null; kind: 'durable' | 'non_durable'; source: string; observedAt: string };
export type WarrantyResolution = {
  status: 'resolved'; origin: WarrantyOrigin; duration: number; unit: 'dias' | 'meses' | 'anos';
  source: string; observedAt: string; productId: string; gtin: string | null; offerId: string | null;
} | { status: 'pending'; reason: string };

export function normalizeMlWarrantyTime(input: unknown): string {
  const match = String(input ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/^(\d+)\s+(dias?|mes(?:es)?|anos?)$/);
  if (!match || Number(match[1]) <= 0) return '';
  const unit = match[2].startsWith('dia') ? 'dias' : match[2].startsWith('mes') ? 'meses' : 'anos';
  return `${Number(match[1])} ${unit}`;
}
/** Normaliza somente dados fornecidos. Ausência nunca cria uma garantia. */
export function normalizeMlSaleTerms(terms: MlSaleTerm[]): MlSaleTerm[] {
  return (terms ?? []).flatMap(term => {
    const id = String(term.id ?? '').trim().toUpperCase();
    if (!id) return [];
    const name = id === 'WARRANTY_TIME' ? normalizeMlWarrantyTime(term.value_name) : term.value_name;
    if (!term.value_id && !name) return [];
    return [{ id, ...(term.value_id ? { value_id: term.value_id } : {}), ...(name ? { value_name: name } : {}) }];
  });
}
export function resolveWarranty(input: { productId: string; gtin: string | null; offerId: string | null; evidence: WarrantyEvidence[]; durability?: DurabilityEvidence | null }): WarrantyResolution {
  const relevant = input.evidence.filter(e => e.productId === input.productId && (e.gtin ?? null) === input.gtin
    && (e.origin === 'FABRICANTE' || (!!input.offerId && e.offerId === input.offerId)));
  for (const origin of ['FABRICANTE', 'GARANTIA_FORNECEDOR'] as const) {
    const candidates = relevant.filter(e => e.origin === origin);
    if (!candidates.length) continue;
    if (candidates.some(e => !Number.isInteger(e.duration) || e.duration <= 0 || !['dias','meses','anos'].includes(e.unit) || !e.source?.trim() || !Number.isFinite(Date.parse(e.observedAt))))
      return { status: 'pending', reason: 'GARANTIA_EVIDENCIA_INVALIDA' };
    if (new Set(candidates.map(e => e.unit === 'dias' ? `${e.duration}:dias` : `${e.duration * (e.unit === 'anos' ? 12 : 1)}:meses`)).size > 1) return { status: 'pending', reason: 'GARANTIA_FONTES_CONTRADITORIAS' };
    const e = [...candidates].sort((a,b) => Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
    return { ...e, status: 'resolved', offerId: origin === 'GARANTIA_FORNECEDOR' ? input.offerId : null };
  }
  const d = input.durability;
  if (!d || d.productId !== input.productId || (d.gtin ?? null) !== input.gtin || !['durable','non_durable'].includes(d.kind) || !d.source?.trim() || !Number.isFinite(Date.parse(d.observedAt)))
    return { status: 'pending', reason: 'GARANTIA_CLASSIFICACAO_DURABILIDADE_PENDENTE' };
  return { status: 'resolved', origin: 'GARANTIA_LEGAL', duration: d.kind === 'durable' ? 90 : 30, unit: 'dias', source: `CDC art.26; ${d.source}`, observedAt: d.observedAt, productId: input.productId, gtin: input.gtin, offerId: null };
}
/** O tipo ML não substitui a origem auditada da garantia. */
export function warrantySaleTerms(warranty: WarrantyResolution, schemas: any[]): MlSaleTerm[] {
  if (warranty.status !== 'resolved') throw new Error(warranty.reason);
  const type = schemas.find(s => s.id === 'WARRANTY_TYPE');
  const time = schemas.find(s => s.id === 'WARRANTY_TIME');
  const typeId = warranty.origin === 'FABRICANTE' ? '2230279' : '2230280';
  const selected = type?.values?.find((v: any) => String(v.id) === typeId);
  if (!selected || !time) throw new Error('GARANTIA_REPRESENTACAO_ML_PENDENTE');
  const duration = `${warranty.duration} ${warranty.unit}`;
  let timeTerm: MlSaleTerm = { id: 'WARRANTY_TIME', value_name: duration };
  if (time.value_type === 'list') {
    const match = time.values?.find((v: any) => normalizeMlWarrantyTime(v.name) === duration);
    if (!match) throw new Error('GARANTIA_DURACAO_NAO_ACEITA_ML');
    timeTerm = { id: 'WARRANTY_TIME', value_id: String(match.id), value_name: String(match.name) };
  } else if (time.allowed_units?.length && !time.allowed_units.some((u: any) => u.id === warranty.unit)) throw new Error('GARANTIA_UNIDADE_NAO_ACEITA_ML');
  return [{ id: 'WARRANTY_TYPE', value_id: typeId, value_name: selected.name }, timeTerm];
}
export function warrantyDescription(w: WarrantyResolution): string {
  if (w.status !== 'resolved') return '';
  const title = w.origin === 'FABRICANTE' ? 'Garantia do fabricante' : w.origin === 'GARANTIA_FORNECEDOR' ? 'Garantia declarada pelo fornecedor' : 'Garantia legal';
  return `${title}: ${w.duration} ${w.unit}. Preservados os direitos de garantia legal aplicáveis.`;
}
