import type { IdentityFacts } from './opportunity-conflicts.ts';
import { findModelEvidence, normalizeIdentityText, titlePackQuantity, identityColor } from './identity-normalization.ts';

export type FactOrigin = { source: string; excerpt: string };
type TextContext = { title?: string; description?: string; source?: string };
export type IdentitySupplement = { offerId: string; gtin: string; source: string; observedAt: string; facts: IdentityFacts };
const clean = (text: unknown) => String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|bull);/g, ' ').replace(/\s+/g, ' ').trim();

/** Composição comercial explícita. Não confunde portas, medidas ou volumes com kits. */
export function presentationFacts(title: string, description = '') {
    const text = normalizeIdentityText(clean(`${title} ${description}`));
    const kit = /\b(?:kit|conjunto|jogo|pack)\b/.test(normalizeIdentityText(title)) || /\b(?:este kit|esse kit|kit (?:de|com))\b/.test(text);
    const pair = /\bpar\b/.test(normalizeIdentityText(title));
    const count = text.match(/\b(?:kit|pack|conjunto)\s*(?:com|de)?\s*(\d+)\b(?!\s*(?:vias?|pol|polegadas?|mm|cm|m|v|w)\b)/)
        ?? text.match(/\bkit\s+(?:de\s+)?(?:coolers?|fans?|falantes?|sensores?)\s+(?:com|de)\s+(\d+)\b/)
        ?? text.match(/\bcomposto\s+por\s+(\d+)\s+unidades?\b/)
        ?? text.match(/\b(?:conteudo(?: da embalagem)?|acompanha|inclui|contem)\s*[:\-]?\s*(\d+)\s+(?:unidades?|pecas?|coolers?|falantes?)\b/);
    const unit = text.match(/\b(?:venda por unidade|vendido por unidade|conteudo(?: da embalagem)?\s*:\s*1 unidade)\b/);
    const quantity = pair ? 2 : count ? Number(count[1]) : unit ? 1 : titlePackQuantity(title);
    return { quantity, packaging: pair || kit || (quantity !== null && quantity > 1) ? 'kit' : unit ? 'unidade' : null,
        excerpt: pair ? title : count?.[0] ?? unit?.[0] ?? (kit || quantity !== null ? title : null) };
}

export function identityFacts(attributes: Array<{ id: string; value_name?: string | null }> = [], context: TextContext = {}): IdentityFacts {
    const get = (id: string) => attributes.find(a => a.id === id)?.value_name ?? null;
    const positive = (s: string | null) => s && /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
    const content = presentationFacts(context.title ?? '', context.description ?? '');
    const units = positive(get('UNITS_PER_PACK') ?? get('SALE_UNITS'));
    const packs = positive(get('PACKS_NUMBER'));
    const saleUnits = units === null ? null : units * (packs ?? 1);
    const format = normalizeIdentityText(get('SALE_FORMAT'));
    const packaging = content.packaging ?? (/^(unidade|unidad|unit)$/.test(format) ? 'unidade' : /^(kit|pack|pacote|par)$/.test(format) ? 'kit' : null);
    // Um kit vendido como uma unidade conserva sua composição; não são quatro kits.
    const quantity = content.quantity ?? (content.packaging === 'kit' ? null : saleUnits);
    const provenance: Record<string, FactOrigin> = {};
    const source = context.source ?? 'ml_attributes';
    for (const [field, id] of Object.entries({ gtin: 'GTIN', brand: 'BRAND', model: 'MODEL', partNumber: 'PART_NUMBER', variation: 'COLOR' }))
        if (get(id)) provenance[field] = { source, excerpt: `${id}: ${get(id)}` };
    if (content.excerpt) provenance.presentation = { source, excerpt: content.excerpt };
    else if (saleUnits !== null || format) provenance.presentation = { source, excerpt: `SALE_FORMAT: ${get('SALE_FORMAT')}; UNITS_PER_PACK: ${units}; PACKS_NUMBER: ${packs}` };
    return { gtin: get('GTIN'), brand: get('BRAND'), model: get('MODEL'), partNumber: get('PART_NUMBER'), packaging, quantity, saleUnits,
        variation: get('COLOR') ?? identityColor(get('MODEL')), provenance,
        critical: Object.fromEntries(['VOLTAGE', 'LENGTH', 'SIZE', 'CAPACITY', 'CONNECTOR_TYPE', 'INPUT_CONNECTOR', 'OUTPUT_CONNECTOR', 'PINS_NUMBER'].map(id => [id, get(id)])) };
}

export function supplierIdentityFacts(product: any, reference?: IdentityFacts, supplement?: IdentitySupplement | null): IdentityFacts {
    const title = clean(product.nome), description = clean(product.descricao);
    const text = `${title} ${description}`;
    const source = product.id ? `supplier_offer:${product.id}` : 'supplier_product';
    const matchedModel = normalizeIdentityText(reference?.model) === normalizeIdentityText(reference?.brand) ? null : findModelEvidence(reference?.model, text, reference?.brand);
    const matchedPart = findModelEvidence(reference?.partNumber, text);
    const content = presentationFacts(title, description);
    const provenance: Record<string, FactOrigin> = {};
    if (matchedModel) provenance.model = { source, excerpt: matchedModel };
    if (matchedPart) provenance.partNumber = { source, excerpt: matchedPart };
    if (content.excerpt) provenance.presentation = { source, excerpt: content.excerpt };
    if (product.marca) provenance.brand = { source, excerpt: `${product.marca}; ${description.match(/marca\s*:[^.\n]+/i)?.[0] ?? ''}` };
    if (product.gtin) provenance.gtin = { source, excerpt: String(product.gtin) };
    const facts: IdentityFacts = { gtin: product.gtin ?? null, brand: product.marca ?? null, model: matchedModel, partNumber: matchedPart,
        quantity: content.quantity, packaging: content.packaging, provenance, variation: identityColor(title),
        brandEvidence: text };
    if (supplement && supplement.offerId === product.id && supplement.gtin === String(product.gtin) && supplement.source && supplement.observedAt) {
        // Complemento auditado por produto/oferta; troca de oferta/GTIN exige nova comprovação.
        return { ...facts, ...supplement.facts, gtin: facts.gtin, brand: facts.brand, brandEvidence: facts.brandEvidence, provenance: { ...provenance, ...supplement.facts.provenance },
            critical: { ...facts.critical, ...supplement.facts.critical } };
    }
    return facts;
}
