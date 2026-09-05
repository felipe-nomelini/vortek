import { fetchMLResult } from './integration';
/** Relação sozinha não comprova sincronismo econômico. */
export async function resolveMlPricingGroup(client: {
    from: (name: string) => any;
}, item: any) {
    const relations = (item.item_relations ?? []).map((r: any) => r.id).filter((id: any) => typeof id === 'string');
    const ids = [...new Set<string>([String(item.id), ...relations])].sort();
    let synchronized = false;
    let complete = true;
    let proof: any = null;
    if (relations.length) {
        const response = await fetchMLResult<any>(`/public/buybox/sync/${encodeURIComponent(item.id)}`);
        proof = response.ok ? response.data : { status: 'INCONCLUSIVO', http_status: response.status };
        synchronized = response.ok && response.data?.status === 'SYNC';
        complete = response.ok && ['SYNC', 'UNSYNC'].includes(response.data?.status);
    }
    const groupId = synchronized ? `ml:${ids.join(':')}` : `item:${item.id}`;
    const evidence = { at: new Date().toISOString(), itemIds: ids, proof, complete };
    const { error } = await client.from('anuncios_ml').update({ pricing_group_id: groupId, catalog_synchronized_pair: synchronized, pricing_group_evidence: evidence }).in('ml_item_id', synchronized ? ids : [item.id]);
    if (error)
        throw new Error(error.message);
    return { groupId, synchronized, complete, itemIds: synchronized ? ids : [item.id], evidence };
}
