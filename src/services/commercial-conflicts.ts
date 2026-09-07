import type {
  CommercialConflictInput, CommercialConflictResult, ConflictAssessment,
  ConflictDimension, ConflictDimensionResult, ConflictEvidence, ConflictReason, ConflictStatus,
} from '../types/commercial-conflicts';

const DIMENSIONS: readonly ConflictDimension[] = ['identity', 'packaging_quantity', 'listing_link', 'economy'];
const STATUSES: readonly ConflictStatus[] = ['CONFLITO_CONFIRMADO', 'INCONCLUSIVO', 'PENDENCIA_VALIDACAO', 'SEM_CONFLITO'];
const SOURCES: readonly ConflictEvidence['source'][] = ['mercado_livre', 'supplier', 'product', 'economic_memory', 'manual_validation'];
const CONDITIONS: readonly ConflictEvidence['condition'][] = ['valid', 'stale', 'invalid', 'unavailable', 'inconsistent'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const reason = (code: string): ConflictReason => ({ code, ruleId: 'M2M-CFL-01' });

function validEvidence(value: ConflictEvidence): boolean {
  return Boolean(value && SOURCES.includes(value.source) && text(value.reference)
    && CONDITIONS.includes(value.condition) && text(value.collectedAt)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.collectedAt)
    && Number.isFinite(Date.parse(value.collectedAt))
    && new Date(value.collectedAt).toISOString().replace('.000Z', 'Z')
      === value.collectedAt.replace(/\.(\d{1,2})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, '0')}Z`).replace('.000Z', 'Z'));
}

function evaluateDimension(dimension: ConflictDimension, assessment: ConflictAssessment | undefined): ConflictDimensionResult {
  const base: ConflictDimensionResult = {
    dimension, status: 'PENDENCIA_VALIDACAO', reportedStatus: null,
    coverage: 'partial', reasons: [], evidence: [],
  };
  if (assessment === undefined) return { ...base, reasons: [reason('DIMENSAO_NAO_AVALIADA')] };

  // Protege a fronteira JS sem aceitar estado desconhecido como sucesso.
  if (!assessment || !STATUSES.includes(assessment.status)
    || !['complete', 'partial'].includes(assessment.coverage)
    || !Array.isArray(assessment.reasons) || !assessment.reasons.length
    || !Array.from(assessment.reasons).every(item => item && text(item.code) && text(item.ruleId))
    || !Array.isArray(assessment.evidence)) {
    return { ...base, status: 'INCONCLUSIVO', reasons: [reason('AVALIACAO_INVALIDA')] };
  }

  const reasons: ConflictReason[] = assessment.reasons.map(item => ({ code: item.code, ruleId: item.ruleId }));
  const evidence: ConflictEvidence[] = [];
  let malformedEvidence = false;
  for (const item of assessment.evidence) {
    if (!validEvidence(item)) {
      malformedEvidence = true;
      continue;
    }
    evidence.push({ source: item.source, reference: item.reference, collectedAt: item.collectedAt, condition: item.condition });
  }

  let status: ConflictStatus = assessment.status;
  if (malformedEvidence || evidence.some(item => item.condition !== 'valid')) {
    status = 'INCONCLUSIVO';
    reasons.push(reason(malformedEvidence ? 'EVIDENCIA_INVALIDA' : 'EVIDENCIA_NAO_CONCLUSIVA'));
  } else if (!evidence.length && (status === 'SEM_CONFLITO' || status === 'CONFLITO_CONFIRMADO')) {
    status = status === 'CONFLITO_CONFIRMADO' ? 'INCONCLUSIVO' : 'PENDENCIA_VALIDACAO';
    reasons.push(reason('EVIDENCIA_AUSENTE'));
  }
  if (assessment.coverage === 'partial') {
    reasons.push(reason('VALIDACAO_INCOMPLETA'));
    if (status === 'SEM_CONFLITO') status = 'PENDENCIA_VALIDACAO';
  }
  return { dimension, status, reportedStatus: assessment.status, coverage: assessment.coverage, reasons, evidence };
}

/**
 * Consolida avaliações já produzidas pelos donos de identidade/vínculo/economia.
 * Não compara atributos, calcula preços, consulta fontes ou autoriza operações.
 * SEM_CONFLITO exige as quatro dimensões completas; ausência não é contradição.
 */
export function classifyCommercialConflicts(input: CommercialConflictInput): CommercialConflictResult {
  const validInput = input !== null && typeof input === 'object' && !Array.isArray(input);
  const dimensions = DIMENSIONS.map(dimension => validInput
    ? evaluateDimension(dimension, input[dimension])
    : { ...evaluateDimension(dimension, undefined), status: 'INCONCLUSIVO' as const, reasons: [reason('ENTRADA_INVALIDA')] });
  // Precedência de apresentação: mantém todas as evidências/pendências na saída.
  const status = STATUSES.find(candidate => dimensions.some(item => item.status === candidate))!;
  return {
    version: 'M2M-CFL-01-v1', status, dimensions,
    reasons: dimensions.flatMap(item => item.reasons.map(entry => ({ dimension: item.dimension, ...entry }))),
  };
}
