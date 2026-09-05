/** Comparação sem modificar o cadastro ou apagar variantes materiais. */
export const IDENTITY_RULE_VERSION = 'M2M-IDENTITY-v2';
export const normalizeIdentityText = (value: unknown): string => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normalizeModelCode = (value: unknown): string => normalizeIdentityText(value).replace(/[\s\-/]+/g, '');

const brands: Record<string, { name: string; source: string }> = {
    'roadstar brasil': { name: 'roadstar', source: 'https://www.roadstarbrasil.com.br/' },
    roadstar: { name: 'roadstar', source: 'https://www.roadstarbrasil.com.br/' },
    multilaser: { name: 'multi', source: 'https://www.multilaser.com.br/' },
    multi: { name: 'multi', source: 'https://www.multilaser.com.br/' },
    'sohoplus - furukawa': { name: 'furukawa', source: 'https://content.furukawalatam.com/sohoplus-lp' },
    'sohoplus furukawa': { name: 'furukawa', source: 'https://content.furukawalatam.com/sohoplus-lp' },
    furukawa: { name: 'furukawa', source: 'https://content.furukawalatam.com/sohoplus-lp' },
};
export function compareIdentityBrands(left: unknown, right: unknown, supplierText = '') {
    const l = normalizeIdentityText(left), r = normalizeIdentityText(right);
    if (l === r) return { matches: true, basis: 'normalized', source: null };
    if (brands[l] && brands[l].name === brands[r]?.name)
        return { matches: true, basis: 'documented_brand', source: brands[l].source };
    // Relação declarada na oferta deste produto; não é alias global de um distribuidor.
    const scoped = ['nwt', 'storm', 'stormtech', 'storm tech'];
    const declaration = normalizeIdentityText(supplierText).match(/\bmarca\s*:\s*nwt\s*\(storm\s*tech\)/);
    if (scoped.includes(l) && scoped.includes(r) && declaration)
        return { matches: true, basis: 'supplier_declaration', source: declaration[0] };
    return { matches: false, basis: scoped.includes(l) && scoped.includes(r) ? 'unresolved_supplier_brand' : 'different', source: null };
}

export function findModelEvidence(model: unknown, text: string): string | null {
    const code = normalizeIdentityText(model);
    if (!code || /^(desconhecido|generico|nao informado)$/i.test(code)) return null;
    // Separadores são opcionais; os limites impedem CP-130 de coincidir com CP-1300/A.
    const tokens = normalizeModelCode(code).split('');
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = normalizeIdentityText(text).match(new RegExp(`(?:^|[^a-z0-9])(${escaped.join('[\\s\\-/]*')})(?=$|[^a-z0-9])(?![\\-/][a-z0-9])`, 'i'));
    return match?.[1] ?? null;
}
