import type { EconomicMemory } from './pricing.ts';
export type ProductPricingProjection = {
    current: EconomicMemory | null;
    target: EconomicMemory | null;
};
/** Leitura em lote da memória canônica; nenhuma fórmula alternativa para listas ou PDFs. */
export async function loadPricingProjections(client: {
    from: (table: string) => any;
}, productIds: string[]): Promise<Map<string, ProductPricingProjection>> {
    const result = new Map<string, ProductPricingProjection>();
    const ids = [...new Set(productIds.filter(Boolean))];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await client.from('current_pricing_evaluations').select('produto_id,scenario,memory,evaluated_at').in('produto_id', ids.slice(offset, offset + 100)).in('scenario', ['current', 'target']).order('evaluated_at', { ascending: false }).limit(1000);
        if (error)
            throw new Error(`MEMORIA_ECONOMICA_INDISPONIVEL: ${error.message}`);
        for (const row of data ?? []) {
            const projection = result.get(row.produto_id) ?? { current: null, target: null };
            const scenario = row.scenario as 'current' | 'target';
            projection[scenario] ??= row.memory;
            result.set(row.produto_id, projection);
        }
    }
    return result;
}
