import type { ConflictAssessment, ConflictEvidence } from '../../types/commercial-conflicts';

export type ListingLinkState = 'JA_ANUNCIADO_ATIVO' | 'REATIVACAO_CANDIDATA' | 'NOVO_ANUNCIO_CANDIDATO' | 'VINCULO_INCONCLUSIVO';
export type ListingMember = { itemId: string; variationId: string; catalog: boolean };
export type ListingLinkCandidate = ListingMember & {
  sellerId: number; productId: string | null; status: string;
  identity: 'complete' | 'conflict' | 'pending';
  relations: { itemId: string; variationId: string }[];
  sync: { status: 'SYNC' | 'UNSYNC' | 'UNKNOWN'; relations: string[]; evidence?: ConflictEvidence };
  evidence: ConflictEvidence;
};
export type PricingGroupObservation = {
  anchorItemId: string; anchorVariationId: string;
  synchronized: boolean; state: 'verified' | 'unverified';
  members: ListingMember[]; reasons: string[]; evidence: ConflictEvidence[];
};
export type ListingLinkResult = {
  classification: ListingLinkState; listing_link: ConflictAssessment;
  candidates: ListingLinkCandidate[]; groups: PricingGroupObservation[];
  coverage: 'complete' | 'partial';
};
export const listingMemberKey = (member: Pick<ListingMember, 'itemId' | 'variationId'>) => `${member.itemId}:${member.variationId}`;
const validProof = (p: ConflictEvidence) => p?.condition === 'valid' && Boolean(p.reference) && Number.isFinite(Date.parse(p.collectedAt));

/** Vínculo é contexto, não ordem de publicar, reativar, pausar ou precificar. */
export function classifyListingLinks(input: {
  sellerId: number; productId: string; candidates: ListingLinkCandidate[];
  complete: boolean; searchEvidence: ConflictEvidence[];
}): ListingLinkResult {
  const candidates = [...input.candidates].sort((a, b) => listingMemberKey(a).localeCompare(listingMemberKey(b)));
  const groups: PricingGroupObservation[] = [];
  const visited = new Set<string>();
  let uncertain = !input.complete || !input.searchEvidence.length || !input.searchEvidence.every(validProof);
  const valid = (c: ListingLinkCandidate) => c.sellerId === input.sellerId && (!c.productId || c.productId === input.productId) && c.identity === 'complete' && validProof(c.evidence);
  // O membro espelho também precisa ser avaliado, mesmo quando o par já foi visitado.
  if (candidates.some(candidate => !valid(candidate) || !['active', 'paused'].includes(candidate.status))) uncertain = true;
  const member = (c: ListingLinkCandidate): ListingMember => ({ itemId: c.itemId, variationId: c.variationId, catalog: c.catalog });
  for (const candidate of candidates) {
    if (visited.has(listingMemberKey(candidate))) continue;
    const peers = candidates.filter(peer => candidate.relations.some(rel => rel.itemId === peer.itemId && (!rel.variationId || rel.variationId === (candidate.catalog ? peer.variationId : candidate.variationId))));
    const peer = peers.length === 1 ? peers[0] : null;
    const paired = Boolean(peer && valid(candidate) && valid(peer) && peer.catalog !== candidate.catalog
      && candidate.relations.length === 1 && peer.relations.length === 1
      && peer.relations[0].itemId === candidate.itemId
      && (!peer.relations[0].variationId || peer.relations[0].variationId === (peer.catalog ? candidate.variationId : peer.variationId))
      && candidate.sync.status === 'SYNC' && peer.sync.status === 'SYNC'
      && Boolean(candidate.sync.evidence && validProof(candidate.sync.evidence) && peer.sync.evidence && validProof(peer.sync.evidence))
      && candidate.sync.relations.length === 1 && peer.sync.relations.length === 1
      && candidate.sync.relations[0] === peer.itemId && peer.sync.relations[0] === candidate.itemId);
    if (paired && peer) {
      const anchor = candidate.catalog ? peer : candidate;
      groups.push({ anchorItemId: anchor.itemId, anchorVariationId: anchor.variationId, synchronized: true, state: 'verified',
        members: [member(candidate), member(peer)].sort((a, b) => listingMemberKey(a).localeCompare(listingMemberKey(b))), reasons: ['CATALOG_PAIR_SYNC_VERIFIED'], evidence: [candidate.evidence, peer.evidence, candidate.sync.evidence!, peer.sync.evidence!] });
      visited.add(listingMemberKey(peer));
    } else {
      // UNSYNC comprovado separa unidades; falha preserva a composição histórica no writer.
      const noRelation = candidate.relations.length === 0 && candidate.sync.relations.length === 0 && candidate.sync.status === 'UNKNOWN';
      const independent = valid(candidate) && (noRelation || (candidate.sync.status === 'UNSYNC' && Boolean(candidate.sync.evidence && validProof(candidate.sync.evidence) && peer && peer.sync.status === 'UNSYNC' && peer.sync.evidence && validProof(peer.sync.evidence) && valid(peer)
        && candidate.sync.relations.length === 1 && candidate.sync.relations[0] === peer.itemId && peer.sync.relations.length === 1 && peer.sync.relations[0] === candidate.itemId)));
      if (!independent) uncertain = true;
      groups.push({ anchorItemId: candidate.itemId, anchorVariationId: candidate.variationId, synchronized: false,
        state: independent ? 'verified' : 'unverified', members: [member(candidate)],
        reasons: [independent ? 'INDEPENDENT_LISTING' : 'LINK_EVIDENCE_INCOMPLETE'], evidence: [candidate.evidence] });
    }
    visited.add(listingMemberKey(candidate));
    if (!valid(candidate) || !['active', 'paused'].includes(candidate.status)) uncertain = true;
  }
  const active = candidates.some(c => valid(c) && c.status === 'active');
  const paused = candidates.some(c => valid(c) && c.status === 'paused');
  const classification: ListingLinkState = uncertain ? 'VINCULO_INCONCLUSIVO' : active ? 'JA_ANUNCIADO_ATIVO' : paused ? 'REATIVACAO_CANDIDATA' : 'NOVO_ANUNCIO_CANDIDATO';
  const evidence = [...input.searchEvidence, ...candidates.map(c => c.evidence)];
  // Estar anunciado não é conflito para manutenção. O consumidor de NOVO anúncio deve usar classification.
  const listing_link: ConflictAssessment = uncertain
    ? { status: 'INCONCLUSIVO', coverage: 'partial', reasons: [{ code: classification, ruleId: 'M2M-CFL-03' }], evidence }
    : { status: 'SEM_CONFLITO', coverage: 'complete', reasons: [{ code: classification, ruleId: 'M2M-CFL-03' }], evidence: evidence as [ConflictEvidence, ...ConflictEvidence[]] };
  return { classification, listing_link, candidates, groups, coverage: uncertain ? 'partial' : 'complete' };
}
