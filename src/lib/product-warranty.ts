import { z } from 'zod';
import { normalizeMlWarrantyTime, type MlCategorySaleTerm, type MlSaleTerm } from './ml-sale-terms';

export const warrantyPolicy = 'BNT-CANON-WARRANTY-01-v1';
export const warrantyLabels = { comprovada: 'Garantia comprovada', legal: 'Garantia legal', pendente_validacao: 'Revisão necessária', conflito: 'Fontes divergentes', inconclusiva: 'Garantia inconclusiva' };
export function warrantyUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || !u.hostname.includes('.')
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname) || /^[\d.:\[\]]+$/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
const reference = z.string().max(2000).refine(v => !!warrantyUrl(v), 'Use URL HTTPS pública, sem parâmetros ou credenciais');
const evidenceReference = z.union([reference, z.string().regex(/^vortek:offer:[0-9a-f-]{36}$/i)]);
export const warrantyEvidenceSchema = z.object({
  kind: z.enum(['manufacturer', 'supplier', 'legal']), duration: z.number().int().positive().max(100000), unit: z.enum(['dias', 'meses', 'anos']),
  url: evidenceReference, excerpt: z.string().trim().min(10).max(3000), identity: z.string().trim().min(2).max(500),
  brazil: z.boolean(), coversKit: z.boolean(), classification: z.enum(['durable', 'non_durable']).nullable(),
}).strict();
export type WarrantyEvidence = z.infer<typeof warrantyEvidenceSchema>;
export type WarrantySource = { id: string; scope: string; host: string; state: 'approved' | 'revoked'; reason: string; created_at: string };
export type WarrantyCandidate = WarrantyEvidence & { scope: string; collectedAt: string; origin: 'web' | 'manual' | 'offer'; reviewed: boolean };
export type WarrantyResolution = { policy: string; status: keyof typeof warrantyLabels; reason: string; selected: WarrantyCandidate | null; candidates: WarrantyCandidate[]; revision: string };
export const warrantyCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('research'), commandId: z.string().uuid(), fingerprint: z.string().length(64), reason: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('review'), commandId: z.string().uuid(), fingerprint: z.string().length(64), reason: z.string().trim().min(1).max(200), evidence: warrantyEvidenceSchema }).strict(),
  z.object({ action: z.literal('revoke'), commandId: z.string().uuid(), fingerprint: z.string().length(64), reason: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('source'), commandId: z.string().uuid(), fingerprint: z.string().length(64), reason: z.string().trim().min(1).max(200), url: reference,
    kind: z.enum(['manufacturer', 'supplier']), state: z.enum(['approved', 'revoked']) }).strict(),
]);
export type WarrantyCommand = z.infer<typeof warrantyCommandSchema>;
export const normalizedWarrantyText = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function hasWarrantyDuration(e: WarrantyEvidence) {
  const values = warrantyDurations(e.excerpt);
  return values.length > 0 && values.every(value => value === durationKey(e.duration, e.unit));
}
// Months and years are interchangeable; days are not approximated as months.
function durationKey(amount: number, unit: string) { return unit === 'anos' ? `${amount * 12}:meses` : `${amount}:${unit}`; }
function warrantyDurations(text: string) {
  return [...text.matchAll(/\b(\d+)\s*(dias?|mes(?:es)?|anos?)\b/gi)].map(m => {
    const normalized = normalizeMlWarrantyTime(`${m[1]} ${m[2]}`)!.split(' ');
    return durationKey(Number(normalized[0]), normalized[1]);
  });
}
export function resolveWarranty(input: { candidates: WarrantyCandidate[]; sources: WarrantySource[]; isKit: boolean; revision: string; failure?: string }): WarrantyResolution {
  const base = { policy: warrantyPolicy, selected: null, candidates: input.candidates, revision: input.revision };
  const valid: WarrantyCandidate[] = [];
  for (const e of input.candidates) {
    if (!warrantyEvidenceSchema.safeParse(Object.fromEntries(Object.entries(e).filter(([k]) => !['scope', 'collectedAt', 'origin', 'reviewed'].includes(k)))).success || !e.brazil || (input.isKit && !e.coversKit)) continue;
    if (e.kind === 'legal') {
      if (warrantyUrl(e.url) && e.reviewed && e.classification && e.unit === 'dias' && e.duration === (e.classification === 'durable' ? 90 : 30)) valid.push(e);
      continue;
    }
    if (e.url.startsWith('vortek:offer:')) {
      if (e.kind === 'supplier' && e.reviewed && hasWarrantyDuration(e)) valid.push(e);
      continue;
    }
    const host = new URL(e.url).hostname;
    const source = input.sources.find(s => s.scope === e.scope && s.host === host);
    if (hasWarrantyDuration(e) && (e.reviewed || source?.state === 'approved') && source?.state !== 'revoked') valid.push(e);
  }
  // Distinct grantors are not automatically contradictory. Resolve hierarchy,
  // but never pick silently between contradictory promises of the same grantor.
  for (const kind of ['manufacturer', 'supplier', 'legal'] as const) {
    const rows = valid.filter(e => e.kind === kind);
    if (!rows.length) continue;
    if (new Set(rows.map(e => durationKey(e.duration, e.unit))).size > 1) return { ...base, status: 'conflito', reason: 'Prazos divergentes exigem revisão documentada' };
    if (input.candidates.some(e => e.kind === kind && !valid.includes(e))) return { ...base, status: 'pendente_validacao', reason: 'Há evidência da mesma origem ainda não validada' };
    return { ...base, status: kind === 'legal' ? 'legal' : 'comprovada', selected: rows[0], reason: 'Prazo vinculado à evidência do produto' };
  }
  return { ...base, status: input.candidates.length ? 'pendente_validacao' : 'inconclusiva', reason: input.failure || 'Sem evidência suficiente; não significa ausência de garantia' };
}
export function warrantySaleTerms(resolution: WarrantyResolution, schema: MlCategorySaleTerm[]): { terms: MlSaleTerm[]; compatible: boolean; reason: string } {
  const e = resolution.selected;
  if (!e) return { terms: [], compatible: false, reason: resolution.reason };
  const type = schema.find(s => s.id === 'WARRANTY_TYPE'), time = schema.find(s => s.id === 'WARRANTY_TIME');
  const typeId = e.kind === 'manufacturer' ? '2230279' : '2230280';
  const value = type?.values?.find(v => v.id === typeId);
  let amount = e.duration, unit = e.unit;
  if (!time?.allowed_units?.some(u => u.id === unit)) {
    if (unit === 'anos' && time?.allowed_units?.some(u => u.id === 'meses')) { amount *= 12; unit = 'meses'; }
    else if (unit === 'meses' && amount % 12 === 0 && time?.allowed_units?.some(u => u.id === 'anos')) { amount /= 12; unit = 'anos'; }
  }
  const duration = `${amount} ${unit}`;
  const enumerated = time?.values?.find(v => warrantyDurations(v.name || '')[0] === durationKey(e.duration, e.unit));
  if (!value || !time || (time.values?.length && !enumerated) || (!time.values?.length && !time.allowed_units?.some(u => u.id === unit))) {
    return { terms: [], compatible: false, reason: 'Categoria não representa o tipo/prazo comprovado' };
  }
  return { compatible: true, reason: resolution.reason, terms: [{ id: 'WARRANTY_TYPE', value_id: typeId, value_name: value.name },
    enumerated ? { id: 'WARRANTY_TIME', value_id: enumerated.id, value_name: enumerated.name } : { id: 'WARRANTY_TIME', value_name: duration }] };
}
export function warrantyDescription(text: string, resolution: WarrantyResolution): string {
  // Preserve master data; only the new listing description is normalized.
  const clean = warrantyTextSegments(text).filter(line => !/garanti[ae]|warranty|^Preservados os direitos legais do consumidor\./i.test(line)).join('\n').trim();
  const e = resolution.selected;
  if (!e) return clean;
  const label = e.kind === 'manufacturer' ? 'Garantia do fabricante' : e.kind === 'supplier' ? 'Garantia informada pelo fornecedor' : 'Garantia legal';
  return `${clean}\n\nGARANTIA\n${label}: ${e.duration} ${e.unit}, conforme documentação registrada.\nPreservados os direitos legais do consumidor.`;
}
function warrantyTextSegments(text: string) {
  // A heading and its following promise are one statement, even across lines.
  return text.replace(/(^|\n)\s*(garantia|warranty)\s*:?\s*\n\s*([^\n]+)/gi, '$1$2: $3').split(/\n|(?<=[.!?])\s+/);
}
export function warrantyDescriptionConflicts(text: string, resolution: WarrantyResolution): boolean {
  const selected = resolution.selected;
  return warrantyTextSegments(text).some(line => {
    if (!/garanti[ae]|warranty/i.test(line)) return false;
    if (!selected || /sem garantia|no warranty/i.test(line)) return true;
    if (/fabricante|f[aá]brica/i.test(line) && selected.kind !== 'manufacturer') return true;
    return warrantyDurations(line).some(value => value !== durationKey(selected.duration, selected.unit));
  });
}
