import { IDENTITY_RULE_VERSION } from '../lib/ml/identity-normalization';
import { fetchMLResult } from './integration';
import { fetchAllMlItemIds } from './ml-listing-scan';
import { resolveMlPricingGroup } from './ml-pricing-group';
import { loadPricingRuntime, resolvePricingProduct, quoteMlEconomics, resolveNewListingQuoteContext, persistPricingEvaluation, pricingFingerprint } from './pricing-context';
import { solveQuotedPrice, type EconomicMemory } from './pricing.ts';
import { assessOpportunityConflicts, radarClassification, radarPriority, type ListingEvidence, type DemandState } from '../lib/ml/opportunity-conflicts.ts';
import { identityFacts, supplierIdentityFacts } from '../lib/ml/opportunity-identity.ts';
type Client = {
    from: (table: string) => any;
    rpc: (name: string, args: any) => any;
};
export async function processRadarBatch(client: Client, jobId: string, ownerToken: string) {
    const startedAt = new Date().toISOString();
    const job = await client.from('jobs').select('log,processados').eq('id', jobId).single();
    if (job.error)
        throw new Error(job.error.message);
    const logs = Array.isArray(job.data.log) ? job.data.log : [];
    const previous = [...logs].reverse().find((entry: any) => entry.event === 'radar_checkpoint')?.payload;
    const runtime = await loadPricingRuntime(client);
    let query = client.from('produtos').select('*').order('id').limit(runtime.policy.radar.batchSize);
    if (previous?.lastId)
        query = query.gt('id', previous.lastId);
    const products = await query;
    if (products.error)
        throw new Error(products.error.message);
    let coverageComplete = previous?.coverageComplete === true;
    let coverageObservedAt = previous?.coverageObservedAt;
    if (!coverageObservedAt || Date.now() - Date.parse(coverageObservedAt) > runtime.policy.evidenceMaxAgeHours * 3600000) {
        const me = await fetchMLResult<any>('/users/me');
        const scan = me.ok ? await fetchAllMlItemIds(me.data.id) : { ok: false, itemIds: [] };
        const allKnown: any[] = [];
        for (let offset = 0;; offset += 1000) {
            const page = await client.from('anuncios_ml').select('ml_item_id,produto_id,sku').range(offset, offset + 999);
            if (page.error)
                throw new Error(page.error.message);
            allKnown.push(...page.data);
            if (page.data.length < 1000)
                break;
        }
        const known = new Map(allKnown.map(row => [row.ml_item_id, row]));
        coverageComplete = scan.ok && scan.itemIds.every(id => known.get(id)?.produto_id);
        coverageObservedAt = startedAt;
    }
    let processed = Number(previous?.processed ?? 0);
    let lastId = previous?.lastId ?? null;
    let saved = 0;
    let skipped = 0;
    const rows: any[] = [];
    for (let offset = 0; offset < products.data.length; offset += runtime.policy.radar.concurrency) {
        if (Date.now() - Date.parse(startedAt) > 180000)
            break;
        const batch = products.data.slice(offset, offset + runtime.policy.radar.concurrency);
        const settled = await Promise.allSettled(batch.map(async (product: any) => {
            const existing = await client.from('radar_oportunidades').select('*').eq('candidate_key', `product:${product.id}`).maybeSingle();
            if (existing.error)
                throw new Error(existing.error.message);
            const resolved = await resolvePricingProduct(client, product.id);
            const own = await client.from('anuncios_ml').select('*').or(`produto_id.eq.${product.id},sku.eq.${product.sku}`);
            if (own.error)
                throw new Error(own.error.message);
            const prior = existing.data;
            const catalogId = prior?.catalog_product_id ?? null;
            if (catalogId) {
                const related = await client.from('catalogo_ml_snapshot').select('ml_item_id').eq('catalog_product_id', catalogId);
                if (related.error)
                    throw new Error(related.error.message);
                const relatedIds = related.data.map((s: any) => s.ml_item_id).filter((id: string) => !own.data.some((l: any) => l.ml_item_id === id));
                if (relatedIds.length) {
                    const others = await client.from('anuncios_ml').select('*').in('ml_item_id', relatedIds);
                    if (others.error)
                        throw new Error(others.error.message);
                    own.data.push(...others.data);
                }
            }
            const inputHash = pricingFingerprint({ identityRule: IDENTITY_RULE_VERSION, policy: runtime.policy.version, tax: runtime.tax.rate, taxStatus: runtime.tax.status, product: { id: product.id, active: product.ativo, preferred: product.oferta_preferencial_id, manual: product.fornecedor_preferencial_manual, gtin: product.gtin, brand: product.marca, name: product.nome, description: product.descricao, dimensions: [product.altura, product.largura, product.profundidade, product.peso_bruto] }, offer: resolved.offer && { id: resolved.offer.id, name: resolved.offer.nome, description: resolved.offer.descricao, brand: resolved.offer.marca, gtin: resolved.offer.gtin, cost: resolved.offer.custo, stock: resolved.offer.estoque, active: resolved.offer.ativo }, listings: own.data.map((l: any) => [l.ml_item_id, l.status, l.preco_ml]), catalogId, coverageComplete, competitive: prior?.evidence?.competitivePrice, identityReview: prior?.evidence?.identityReview });
            if (prior?.input_fingerprint === inputHash && Date.now() - Date.parse(prior.processed_at) < runtime.policy.evidenceMaxAgeHours * 3600000)
                return null;
            const listings: ListingEvidence[] = [];
            let liveItem: any = null;
            let linksComplete = coverageComplete;
            for (const listing of own.data) {
                const remote = await fetchMLResult<any>(`/items/${encodeURIComponent(listing.ml_item_id)}`);
                if (!remote.ok) {
                    linksComplete = false;
                    listings.push({ itemId: listing.ml_item_id, status: listing.status, pricingGroupId: listing.pricing_group_id ?? `item:${listing.ml_item_id}`, synchronized: false, source: 'local_stale', observedAt: listing.updated_at });
                    continue;
                }
                const group = await resolveMlPricingGroup(client, remote.data);
                linksComplete = linksComplete && group.complete;
                listings.push({ itemId: listing.ml_item_id, status: remote.data.status, pricingGroupId: group.groupId, synchronized: group.synchronized, source: 'ml_live', observedAt: startedAt });
                liveItem ??= remote.data;
            }
            const catalog = catalogId ? await fetchMLResult<any>(`/products/${encodeURIComponent(catalogId)}`) : null;
            const remoteProduct = catalog?.ok ? catalog.data : liveItem;
            const remoteFacts = identityFacts(remoteProduct?.attributes ?? [], { title: remoteProduct?.name ?? remoteProduct?.title, source: catalog?.ok ? `/products/${catalogId}` : liveItem ? `/items/${liveItem.id}` : 'ml' });
            const identity = { local: supplierIdentityFacts(resolved.offer ?? product, remoteFacts), remote: remoteFacts, source: catalog?.ok ? `/products/${catalogId}` : liveItem ? `/items/${liveItem.id}` : null };
            const competitivePrice = Number(prior?.evidence?.competitivePrice) > 0 ? Number(prior.evidence.competitivePrice) : null;
            // Preço competitivo salvo é evidência observada, nunca uma promessa de Buy Box atual.
            const context = liveItem ? undefined : catalog?.ok ? await resolveNewListingQuoteContext(product, catalog.data.category_id, prior?.evidence?.listingType ?? 'gold_special') : null;
            const { mlQuoteContext } = await import('./pricing-context');
            const ctx = liveItem ? mlQuoteContext(liveItem) : context ?? null;
            const quotes = new Map<number, EconomicMemory>();
            const quote = async (price: number) => { let m = quotes.get(price); if (!m) {
                m = await quoteMlEconomics({ ...resolved, price, runtime, context: ctx, requireLive: true, evaluatedAt: startedAt });
                quotes.set(price, m);
            } return m; };
            const active = listings.some(l => l.status === 'active');
            const memories: Record<string, EconomicMemory | null> = { competitive: !active && competitivePrice ? await quote(competitivePrice) : null, current: !active && liveItem ? await quote(Number(liveItem.price)) : null };
            for (const objective of ['target', 'floor', 'break_even'] as const) {
                if (active || !ctx || !resolved.offer || runtime.tax.rate === null) {
                    memories[objective] = null;
                    continue;
                }
                const solution = await solveQuotedPrice({ cost: Number(resolved.offer.custo), taxRate: runtime.tax.rate, initialPrice: competitivePrice ?? Number(resolved.offer.custo), objective, policy: runtime.policy, quote });
                memories[objective] = solution.ok ? solution.memory : null;
            }
            const ids: Record<string, string | null> = {};
            for (const [scenario, memory] of Object.entries(memories))
                if (memory)
                    ids[scenario] = await persistPricingEvaluation(client, { ...resolved, memory, scenario, itemId: liveItem?.id, groupId: listings[0]?.pricingGroupId, jobId });
            const economy = memories.competitive ?? memories.target;
            const assessment = assessOpportunityConflicts({ identity, listings, listingSearchComplete: linksComplete, economy, buyBox: !!competitivePrice, eligibleOffer: product.ativo === true && !!resolved.offer });
            const sold = await client.from('pedido_itens').select('id,pedidos!inner(situacao)').eq('seller_sku', product.sku).not('pedidos.situacao','in','(cancelado,recusado,pendente,aberto)').limit(1);
            if (sold.error)
                throw new Error(sold.error.message);
            const demand: DemandState = (sold.data?.length ?? 0) > 0 ? 'HISTORICO_PROPRIO' : prior?.evidence?.demand ?? 'SEM_EVIDENCIA_DE_DEMANDA';
            const stock = Number(resolved.offer?.estoque ?? 0);
            const complete = !!product.ncm && Array.isArray(product.imagens) && product.imagens.length > 0 && assessment.identity === 'IDENTIDADE_COHERENTE' && !(assessment.warnings ?? []).includes('APRESENTACAO_NAO_EXPLICITA');
            const classification = radarClassification(assessment, demand, stock, complete);
                if (prior && ['REJEITADO','VALIDADO','PUBLICADO_EXPERIMENTO'].includes(prior.stage) && prior.input_fingerprint===inputHash) classification.stage=prior.stage;
                else if (prior && ['VALIDADO','PUBLICADO_EXPERIMENTO'].includes(prior.stage)) classification.stage='REVISAR';
            const priority = radarPriority({ assessment, demand, stock, publicationComplete: complete, competitivePrice, contribution: economy?.result ?? null });
            return { produto_id: product.id, candidate_key: `product:${product.id}`, sku: product.sku, catalog_product_id: catalogId, pricing_group_id: listings[0]?.pricingGroupId ?? null, stage: classification.stage, queue: classification.queue, conflict_state: assessment.state, assessment, evidence: { ...prior?.evidence, product: product.nome, supplier: resolved.offer?.fornecedor_nome, cost: resolved.offer?.custo, identity, competitivePrice, demand, coverageComplete: linksComplete, observedAt: startedAt }, priority, recommendation: classification.recommendation, evaluation_id: ids.competitive ?? ids.current ?? ids.target ?? null, target_evaluation_id: ids.target ?? null, floor_evaluation_id: ids.floor ?? null, break_even_evaluation_id: ids.break_even ?? null, input_fingerprint: inputHash, stock, demand_rank: priority.demandRank, contribution: economy?.result ?? null };
        }));
        for (let i = 0; i < settled.length; i++) {
            const result = settled[i];
            if (result.status === 'rejected')
                throw new Error(`RADAR_PRODUTO_${batch[i].sku}: ${String(result.reason?.message ?? result.reason)}`);
            if (result.value) {
                rows.push(result.value);
                saved++;
            }
            else
                skipped++;
            processed++;
            lastId = batch[i].id;
        }
    }
    const complete = products.data.length < runtime.policy.radar.batchSize && lastId === (products.data.at(-1)?.id ?? lastId);
    const checkpoint = { startedAt, lastId, processed, complete, saved, skipped, coverageComplete, coverageObservedAt };
    const written = await client.rpc('save_radar_batch', { p_job_id: jobId, p_owner_token: ownerToken, p_rows: rows, p_checkpoint: checkpoint });
    if (written.error)
        throw new Error(written.error.message);
    return { success: true, processados: processed, total: processed + (complete ? 0 : 1), radar_checkpoint: checkpoint, continue_required: !complete };
}
