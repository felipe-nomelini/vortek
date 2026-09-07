/** CFL-01: avaliações de domínio, não payloads ML nem autorização de escrita. */
export type ConflictDimension = 'identity' | 'packaging_quantity' | 'listing_link' | 'economy';
export type ConflictStatus =
  | 'SEM_CONFLITO'
  | 'CONFLITO_CONFIRMADO'
  | 'PENDENCIA_VALIDACAO'
  | 'INCONCLUSIVO';

export type ConflictEvidence = Readonly<{
  source: 'mercado_livre' | 'supplier' | 'product' | 'economic_memory' | 'manual_validation';
  /** Referência sanitizada; nunca URL autenticada, credencial ou payload bruto. */
  reference: string;
  collectedAt: string;
  /** A validade é determinada pelo dono da evidência; este núcleo não inventa TTL. */
  condition: 'valid' | 'stale' | 'invalid' | 'unavailable' | 'inconsistent';
}>;

export type ConflictReason = Readonly<{ code: string; ruleId: string }>;
type AssessmentDetails = Readonly<{
  reasons: readonly [ConflictReason, ...ConflictReason[]];
  /** Completo significa que o avaliador verificou todos os critérios da dimensão. */
  coverage: 'complete' | 'partial';
}>;

export type ConflictAssessment = AssessmentDetails & (
  | Readonly<{
    status: 'SEM_CONFLITO' | 'CONFLITO_CONFIRMADO';
    evidence: readonly [ConflictEvidence, ...ConflictEvidence[]];
  }>
  | Readonly<{
    status: 'PENDENCIA_VALIDACAO' | 'INCONCLUSIVO';
    evidence: readonly ConflictEvidence[];
  }>
);

/** Score, demanda e ranking não pertencem a este contrato. Dimensões omitidas ficam pendentes. */
export type CommercialConflictInput = Readonly<Partial<Record<ConflictDimension, ConflictAssessment>>>;

export type ConflictDimensionResult = Readonly<{
  dimension: ConflictDimension;
  status: ConflictStatus;
  reportedStatus: ConflictStatus | null;
  coverage: 'complete' | 'partial';
  reasons: readonly ConflictReason[];
  evidence: readonly ConflictEvidence[];
}>;

export type CommercialConflictResult = Readonly<{
  version: 'M2M-CFL-01-v1';
  status: ConflictStatus;
  dimensions: readonly ConflictDimensionResult[];
  reasons: readonly (ConflictReason & Readonly<{ dimension: ConflictDimension }>)[];
}>;
