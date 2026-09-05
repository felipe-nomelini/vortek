import { titlePackQuantity } from '../ml-catalog-compatibility.ts';
import type { IdentityFacts } from './opportunity-conflicts.ts';
/** Somente atributos explícitos; título não fornece uma quantidade padrão. */
export function identityFacts(attributes: Array<{
    id: string;
    value_name?: string | null;
}> = []): IdentityFacts {
    const get = (id: string) => attributes.find(a => a.id === id)?.value_name ?? null;
    const quantity = get('UNITS_PER_PACK') ?? get('SALE_UNITS');
    const packs = get('PACKS_NUMBER');
    const multiplier = packs && /^\d+$/.test(packs) ? Number(packs) : 1;
    const rawPackaging = get('SALE_FORMAT');
    const packaging = rawPackaging && /^(unidade|unidad|unit)$/i.test(rawPackaging) ? 'unidade' : rawPackaging;
    return { gtin: get('GTIN'), brand: get('BRAND'), model: get('MODEL'), partNumber: get('PART_NUMBER'), packaging, quantity: quantity && /^\d+$/.test(quantity) ? Number(quantity) * multiplier : null, variation: get('COLOR'),
        critical: Object.fromEntries(['VOLTAGE', 'LENGTH', 'SIZE', 'CAPACITY', 'CONNECTOR_TYPE', 'INPUT_CONNECTOR', 'OUTPUT_CONNECTOR'].map(id => [id, get(id)])) };
}
export function supplierIdentityFacts(product: any, reference?: IdentityFacts): IdentityFacts {
    const text = `${product.nome ?? ''} ${product.descricao ?? ''}`;
    const model = reference?.model && text.toLocaleLowerCase().includes(reference.model.toLocaleLowerCase()) ? reference.model : null;
    const quantity = titlePackQuantity(product.nome);
    const unit = /\b(?:venda por unidade|vendido por unidade|conteúdo: 1 unidade)\b/i.test(text);
    return { gtin: product.gtin ?? null, brand: product.marca ?? null, model, quantity: quantity ?? (unit ? 1 : null), packaging: quantity && quantity > 1 ? 'Kit' : unit ? 'unidade' : null };
}
