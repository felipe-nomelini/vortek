/** Comparação sem modificar o cadastro ou apagar variantes materiais. */
export const IDENTITY_RULE_VERSION = 'M2M-IDENTITY-v2.1';
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

const identityColors: Record<string, string> = { black: 'preto', preto: 'preto', preta: 'preto', white: 'branco', branco: 'branco', branca: 'branco', red: 'vermelho', vermelho: 'vermelho', vermelha: 'vermelho', blue: 'azul', azul: 'azul', silver: 'prata', prata: 'prata' };
export function identityColor(value: unknown): string | null {
    const matches = normalizeIdentityText(value).match(/\b(?:black|pret[oa]|white|branc[oa]|red|vermelh[oa]|blue|azul|silver|prata)\b/g) ?? [];
    const colors = [...new Set(matches.map(m => identityColors[m]))];
    return colors.length === 1 ? colors[0] : null;
}
/** Separa descritores comerciais do código, mantendo sufixos de versão como -PK ou -A. */
export function modelCodeLabel(value: unknown, brand?: unknown): string {
    let label = normalizeIdentityText(value);
    const prefix = normalizeIdentityText(brand);
    if (prefix && label.startsWith(prefix + ' ')) label = label.slice(prefix.length).trim();
    label = label.replace(/^(?:mouse|calculadora|cooler)\s+/, '');
    if (/[a-z]/.test(label) && /\d/.test(label))
        label = label.replace(/\s+(?:-\s*)?(?:universal|black|pret[oa]|white|branc[oa]|red|vermelh[oa]|blue|azul|silver|prata)$/, '').trim();
    return label;
}

export function findModelEvidence(model: unknown, text: string, brand?: unknown): string | null {
    const code = modelCodeLabel(model, brand);
    if (!code || /^(desconhecido|generico|nao informado)$/i.test(code)) return null;
    // Separadores são opcionais; os limites impedem CP-130 de coincidir com CP-1300/A.
    const tokens = normalizeModelCode(code).split('');
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = normalizeIdentityText(text).match(new RegExp(`(?:^|[^a-z0-9])(${escaped.join('[\\s\\-/]*')})(?=$|[^a-z0-9])(?![\\-/][a-z0-9])`, 'i'));
    return match?.[1] ?? null;
}

export function titlePackQuantity(value: unknown): number | null {
  const text = normalizeIdentityText(value);
  const match = text.match(
    /^\s*(\d{1,4})\s*(?:un(?:idades?|id)?|unds?|itens?|pecas?|pcs?|pilhas?|baterias?|cartelas?|pares?|jogos?|tubos?|pacotes?|blisters?|encordoamentos?)\b|\b(?:kit|pack|combo|conjunto|lote)\s*(?:com|de)?\s*(\d{1,4})\b(?!\s*(?:vias?|pol|polegadas?|mm|cm|m|v|w)\b)|\b(\d{1,4})\s*(?:un(?:idades?|id)?|unds?|itens?|pecas?|pcs?|pilhas?|baterias?|cartelas?|pares?|jogos?)\b|\b(?:cartela|cart|car|blister|bli|pacote|pct|caixa|cx|dz|cem|tub)\s+(?:(?:com|de|c\/|\/|x)\s*)?(\d{1,4})\b|\b(?:c|ct)\s*\/\s*(\d{1,4})\b/,
  );
  const quantity = Number(match?.[1] || match?.[2] || match?.[3] || match?.[4] || match?.[5] || 0);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}
