import type { EconomicMemory } from '../../services/pricing.ts';
import { compareIdentityBrands, normalizeIdentityText, normalizeModelCode, modelCodeLabel, identityColor, IDENTITY_RULE_VERSION } from './identity-normalization.ts';
import type { FactOrigin } from './opportunity-identity.ts';
export type ConflictState = 'SEM_CONFLITO' | 'CONFLITO_CONFIRMADO' | 'PENDENCIA_VALIDACAO' | 'INCONCLUSIVO';
export type IdentityState = 'IDENTIDADE_COHERENTE' | 'IDENTIDADE_DIVERGENTE' | 'IDENTIDADE_INCONCLUSIVA';
export type ListingState = 'JA_ANUNCIADO_ATIVO' | 'REATIVACAO_CANDIDATA' | 'NOVO_ANUNCIO_CANDIDATO' | 'VINCULO_INCONCLUSIVO';
export type EconomicState = 'VIAVEL_NO_ALVO' | 'VIAVEL_ACIMA_DO_PISO' | 'ABAIXO_DO_PISO_MAS_POSITIVO' | 'PREJUIZO_NO_PRECO_COMPETITIVO' | 'CONFLITO_ECONOMICO_DE_BUY_BOX' | 'INCONCLUSIVO';
export type DemandState = 'SEM_EVIDENCIA_DE_DEMANDA' | 'SINAL_INDIRETO' | 'RANKING_ML' | 'HISTORICO_PROPRIO';
export type RadarStage = 'DESCOBERTO' | 'IDENTIDADE_VALIDADA' | 'ECONOMIA_VALIDADA' | 'SEM_CONFLITOS' | 'PRONTO_PARA_PREPARACAO' | 'AGUARDANDO_APROVACAO' | 'PUBLICADO_EXPERIMENTO' | 'VALIDADO' | 'REJEITADO' | 'REVISAR' | 'REATIVACAO_CANDIDATA' | 'PENDENCIA_VALIDACAO' | 'CONFLITO_CONFIRMADO' | 'INCONCLUSIVO';
export type RadarQueue = 'PRONTOS_PARA_ANALISE' | 'ALTA_PRIORIDADE' | 'REATIVACOES' | 'PENDENCIAS_IDENTIDADE' | 'CONFLITOS' | 'ECONOMICAMENTE_INVIAVEIS' | 'EXPLORATORIOS' | 'INCONCLUSIVOS' | 'REVISAR' | 'JA_ANUNCIADOS';
export interface IdentityFacts {
    gtin?: string | null;
    brand?: string | null;
    model?: string | null;
    partNumber?: string | null;
    packaging?: string | null;
    quantity?: number | null;
    saleUnits?: number | null;
    brandEvidence?: string;
    provenance?: Record<string, FactOrigin>;
    pendingReasons?: string[];
    variation?: string | null;
    critical?: Record<string, string | null>;
}
export interface IdentityEvidence {
    local: IdentityFacts;
    remote: IdentityFacts;
    source: string | null;
    variationMatchEvidence?: string | null;
}
export interface ListingEvidence {
    itemId: string;
    status: string;
    pricingGroupId: string;
    synchronized: boolean;
    source: string;
    observedAt: string;
}
export interface ConflictAssessment {
    state: ConflictState;
    identity: IdentityState;
    listing: ListingState;
    economy: EconomicState;
    reasons: string[];
    warnings?: string[];
    identityRuleVersion?: string;
    comparisons: Array<{
        field: string;
        local: string;
        remote: string;
        matches: boolean;
        basis?: string;
        evidence?: string | null;
    }>;
    listings: ListingEvidence[];
    publicationAutonomy: 'REQUIRES_CONFIRMATION';
}
const normalize = normalizeIdentityText;
const gtin = (v: unknown): string => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
export function assessIdentity(evidence: IdentityEvidence): Pick<ConflictAssessment, 'identity' | 'comparisons' | 'reasons' | 'warnings' | 'identityRuleVersion'> {
    const comparisons: ConflictAssessment['comparisons'] = [];
    const reasons: string[] = [];
    const warnings: string[] = [];
    const fields = ['gtin', 'brand', 'model', 'partNumber', 'packaging', 'quantity', 'saleUnits', 'variation'] as const;
    for (const field of fields) {
        const left = evidence.local[field];
        const right = evidence.remote[field];
        if (left === undefined || left === null || left === '' || right === undefined || right === null || right === '')
            continue;
        const normalizer = field === 'gtin' ? gtin : ['model', 'partNumber'].includes(field) ? normalizeModelCode : normalize;
        const brandMatch = field === 'brand' ? compareIdentityBrands(left, right, evidence.local.brandEvidence) : null;
        const matches = brandMatch ? brandMatch.matches : field === 'model'
            ? normalizeModelCode(modelCodeLabel(left, evidence.local.brand)) === normalizeModelCode(modelCodeLabel(right, evidence.remote.brand))
            : field === 'variation' && identityColor(left) && identityColor(right)
                ? identityColor(left) === identityColor(right) : normalizer(left) === normalizer(right);
        comparisons.push({ field, local: String(left), remote: String(right), matches, basis: brandMatch?.basis ?? 'normalized', evidence: brandMatch?.source ?? null });
        if (!matches) {
            if (field === 'gtin' && evidence.variationMatchEvidence)
                continue;
            reasons.push(brandMatch?.basis === 'unresolved_supplier_brand' ? 'EQUIVALENCIA_MARCA_NAO_COMPROVADA' : ['quantity', 'packaging', 'saleUnits'].includes(field) ? 'CONFLITO_EMBALAGEM_QUANTIDADE' : `DIVERGENCIA_${field.toUpperCase()}`);
        }
    }
    for (const [field, left] of Object.entries(evidence.local.critical ?? {})) {
        const right = evidence.remote.critical?.[field];
        if (!left || !right)
            continue;
        const matches = normalize(left) === normalize(right);
        comparisons.push({ field, local: left, remote: right, matches });
        if (!matches)
            reasons.push(`DIVERGENCIA_ATRIBUTO_${field}`);
    }
    // Ausência de atributo não é contradição. Kits ainda exigem composição comprovada.
    const matching = new Set(comparisons.filter(c => c.matches).map(c => c.field));
    const identified = matching.has('brand') && (matching.has('model') || matching.has('partNumber') || matching.has('gtin'));
    const kit = [evidence.local.packaging, evidence.remote.packaging].some(p => normalize(p) === 'kit');
    const materialConflicts = reasons.some(r => r !== 'EQUIVALENCIA_MARCA_NAO_COMPROVADA');
    reasons.push(...(evidence.local.pendingReasons ?? []), ...(evidence.remote.pendingReasons ?? []));
    if (identityColor(evidence.remote.model) && !evidence.local.variation) reasons.push('COR_DO_MODELO_NAO_COMPROVADA');
    if (!identified || !evidence.source) reasons.push('EVIDENCIA_IDENTIDADE_INCOMPLETA');
    if (kit && (!evidence.local.quantity || !evidence.remote.quantity)) reasons.push('COMPOSICAO_KIT_NAO_COMPROVADA');
    if (!kit && (!evidence.local.quantity || !evidence.remote.quantity)) warnings.push('APRESENTACAO_NAO_EXPLICITA');
    return { identity: materialConflicts ? 'IDENTIDADE_DIVERGENTE' : reasons.length ? 'IDENTIDADE_INCONCLUSIVA' : 'IDENTIDADE_COHERENTE', comparisons, reasons: [...new Set(reasons)], warnings, identityRuleVersion: IDENTITY_RULE_VERSION };
}
export function classifyCompetitiveEconomy(memory: EconomicMemory | null, buyBox = false): EconomicState {
    if (!memory || memory.result === null || memory.margin === null || !memory.band)
        return 'INCONCLUSIVO';
    if (memory.result < 0 && (memory.fee.source !== 'ml_live' || memory.shipping.source !== 'ml_live'))
        return 'INCONCLUSIVO';
    if (memory.result < 0)
        return buyBox ? 'CONFLITO_ECONOMICO_DE_BUY_BOX' : 'PREJUIZO_NO_PRECO_COMPETITIVO';
    if (memory.margin + 1e-10 >= memory.band.target)
        return 'VIAVEL_NO_ALVO';
    if (memory.margin + 1e-10 >= memory.band.floor)
        return 'VIAVEL_ACIMA_DO_PISO';
    return 'ABAIXO_DO_PISO_MAS_POSITIVO';
}
export function assessOpportunityConflicts(input: {
    identity: IdentityEvidence;
    listings: ListingEvidence[];
    listingSearchComplete: boolean;
    economy: EconomicMemory | null;
    buyBox?: boolean;
    eligibleOffer: boolean;
}): ConflictAssessment {
    const identity = assessIdentity(input.identity);
    const active = input.listings.some(l => ['active', 'ativo'].includes(l.status));
    const paused = input.listings.some(l => ['paused', 'pausado'].includes(l.status));
    const listing: ListingState = active ? 'JA_ANUNCIADO_ATIVO' : !input.listingSearchComplete ? 'VINCULO_INCONCLUSIVO' : paused ? 'REATIVACAO_CANDIDATA' : 'NOVO_ANUNCIO_CANDIDATO';
    const economy = classifyCompetitiveEconomy(input.economy, input.buyBox);
    const reasons = [...identity.reasons];
    if (!input.eligibleOffer)
        reasons.push('OFERTA_ELEGIVEL_INDISPONIVEL');
    if (listing !== 'NOVO_ANUNCIO_CANDIDATO')
        reasons.push(listing);
    if (economy === 'INCONCLUSIVO' || economy === 'ABAIXO_DO_PISO_MAS_POSITIVO' || economy.includes('PREJUIZO') || economy === 'CONFLITO_ECONOMICO_DE_BUY_BOX')
        reasons.push(economy);
    const warnings = [...(identity.warnings ?? []), ...(input.economy?.status === 'estimated' ? input.economy.reasons : [])];
    let state: ConflictState = 'SEM_CONFLITO';
    if (identity.identity === 'IDENTIDADE_DIVERGENTE' || active || economy.includes('PREJUIZO') || economy === 'CONFLITO_ECONOMICO_DE_BUY_BOX')
        state = 'CONFLITO_CONFIRMADO';
    else if (!input.listingSearchComplete || economy === 'INCONCLUSIVO')
        state = 'INCONCLUSIVO';
    else if (reasons.length)
        state = 'PENDENCIA_VALIDACAO';
    return { ...identity, listing, economy, reasons: [...new Set(reasons)], warnings: [...new Set(warnings)], state, listings: input.listings, publicationAutonomy: 'REQUIRES_CONFIRMATION' };
}
export function radarClassification(assessment: ConflictAssessment, demand: DemandState, stock: number, publicationComplete: boolean): {
    queue: RadarQueue;
    stage: RadarStage;
    recommendation: string;
} {
    const result = (queue: RadarQueue, stage: RadarStage, recommendation: string) => ({ queue, stage, recommendation });
    if (assessment.listing === 'JA_ANUNCIADO_ATIVO')
        return result('JA_ANUNCIADOS', 'REVISAR', 'Manter na gestão dos anúncios existentes');
    if (assessment.identity === 'IDENTIDADE_DIVERGENTE')
        return result('CONFLITOS', 'CONFLITO_CONFIRMADO', 'Resolver divergência material');
    if (assessment.economy.includes('PREJUIZO') || assessment.economy === 'CONFLITO_ECONOMICO_DE_BUY_BOX')
        return result('ECONOMICAMENTE_INVIAVEIS', 'CONFLITO_CONFIRMADO', 'Não perseguir o preço competitivo; revisar fontes e estratégia');
    if (assessment.listing === 'REATIVACAO_CANDIDATA')
        return result('REATIVACOES', 'REATIVACAO_CANDIDATA', 'Revisar reativação do anúncio existente');
    if (assessment.state === 'INCONCLUSIVO')
        return result('INCONCLUSIVOS', 'INCONCLUSIVO', 'Completar fontes e vínculos');
    if (assessment.identity === 'IDENTIDADE_INCONCLUSIVA')
        return result('PENDENCIAS_IDENTIDADE', 'PENDENCIA_VALIDACAO', 'Validar identidade e apresentação');
    if (stock <= 0 || assessment.economy === 'ABAIXO_DO_PISO_MAS_POSITIVO')
        return result('REVISAR', 'REVISAR', 'Revisar disponibilidade ou estratégia comercial');
    const stage: RadarStage = assessment.state === 'SEM_CONFLITO' ? publicationComplete ? 'AGUARDANDO_APROVACAO' : 'PRONTO_PARA_PREPARACAO' : 'PENDENCIA_VALIDACAO';
    if (demand === 'SEM_EVIDENCIA_DE_DEMANDA')
        return result('EXPLORATORIOS', stage, 'Explorar demanda; validar pendências antes de aprovar');
    if (['HISTORICO_PROPRIO', 'RANKING_ML'].includes(demand))
        return result('ALTA_PRIORIDADE', stage, 'Analisar evidências e preparar aprovação');
    return result('PRONTOS_PARA_ANALISE', stage, 'Analisar sinal indireto e completar preparação');
}
export function radarPriority(input: {
    assessment: ConflictAssessment;
    demand: DemandState;
    contribution: number | null;
    stock: number;
    publicationComplete: boolean;
    competitivePrice: number | null;
}) {
    return {
        identity: input.assessment.identity, economy: input.assessment.economy, demand: input.demand,
        competitiveness: { price: input.competitivePrice, contribution: input.contribution },
        stock: input.stock, publication: input.publicationComplete ? 'COMPLETA' : 'PENDENTE',
        demandRank: ['HISTORICO_PROPRIO', 'RANKING_ML', 'SINAL_INDIRETO', 'SEM_EVIDENCIA_DE_DEMANDA'].indexOf(input.demand),
    };
}
