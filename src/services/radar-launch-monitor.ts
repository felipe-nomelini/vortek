import { fetchMLResult } from './integration';
import { evaluateProductPricing, persistPricingEvaluation, recordPricingEvent } from './pricing-context';

export function radarCheckpointClassification(day: number, visits: number) {
  return visits > 0 ? 'TRAFEGO_OBSERVADO' : day === 7 ? 'OBSERVACAO_SEM_TRAFEGO' : day === 15 ? 'ALERTA_AMARELO_SEM_TRAFEGO' : 'AUDITORIA_EXPOSICAO_QUALIDADE';
}
/** Executado pelo monitor já agendado; sem envio de mensagens ou alteração de preço. */
export async function monitorRadarLaunch(client: { from: (table: string) => any }) {
  const rows = await client.from('pricing_events').select('*').eq('pricing_source', 'radar_launch').eq('event_type', 'RADAR_LAUNCH_VALIDATED');
  if (rows.error) throw new Error(rows.error.message);
  let processed = 0;
  const errors: Array<{itemId: string; error: string}> = [];
  for (const row of rows.data ?? []) {
    for (const day of [7, 15, 30]) {
      const due = Date.parse(row.payload.startedAt) + day * 86400000;
      if (Date.now() < due) continue;
      const key = `${row.payload.cohort}:${row.ml_item_id}:D${day}`;
      const existing = await client.from('pricing_events').select('id').eq('dedupe_key', key).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) continue;
      try {
        const ending = new Date(due).toISOString().slice(0, 10);
        const [remote, traffic, orders, competition] = await Promise.all([
          fetchMLResult<any>(`/items/${row.ml_item_id}`),
          fetchMLResult<any>(`/items/${row.ml_item_id}/visits/time_window?last=${day}&unit=day&ending=${ending}`),
          client.from('pedido_itens').select('ml_order_id,quantidade,valor_total_liquido,pedidos!inner(situacao)').eq('ml_item_id', row.ml_item_id).neq('pedidos.situacao', 'cancelado').gte('created_at', row.payload.startedAt).lte('created_at', new Date(due).toISOString()),
          fetchMLResult<any>(`/items/${row.ml_item_id}/price_to_win?version=v2`),
        ]);
        if (!remote.ok || !traffic.ok || orders.error) throw new Error('FONTES_CHECKPOINT_INDISPONIVEIS');
        const evaluation = await evaluateProductPricing(client, { productId: row.produto_id, itemId: row.ml_item_id, price: Number(remote.data.price), requireLive: true });
        if (!evaluation.memory || evaluation.memory.result === null) throw new Error('ECONOMIA_CHECKPOINT_INCONCLUSIVA');
        const evaluationId = await persistPricingEvaluation(client, { ...evaluation, memory: evaluation.memory, scenario: 'current', itemId: row.ml_item_id, groupId: row.pricing_group_id });
        const visits = Number(traffic.data.total ?? traffic.data.results?.reduce((sum: number, r: any) => sum + Number(r.total ?? r.visits ?? 0), 0) ?? 0);
        const sold = orders.data ?? [];
        const sales = new Set(sold.map((r: any) => r.ml_order_id)).size;
        const revenue = sold.reduce((sum: number, r: any) => sum + Number(r.valor_total_liquido), 0);
        await recordPricingEvent(client, { event_type: 'RADAR_LAUNCH_CHECKPOINT', produto_id: row.produto_id, ml_item_id: row.ml_item_id, pricing_group_id: row.pricing_group_id, evaluation_id: evaluationId,
          pricing_source: 'radar_launch', actor: 'job:sync_ml_pricing_experiment_monitor', reason: radarCheckpointClassification(day, visits), rule_id: evaluation.memory.policyVersion, dedupe_key: key,
          payload: { cohort: row.payload.cohort, day, dueAt: new Date(due).toISOString(), visits, sales, conversion: visits ? sales / visits : null, revenue, contributionAtCurrentEconomy: sold.reduce((sum: number, r: any) => sum + Number(r.quantidade), 0) * evaluation.memory.result,
            memory: evaluation.memory, price: remote.data.price, stock: remote.data.available_quantity, status: remote.data.status, subStatus: remote.data.sub_status, health: remote.data.health ?? null, buyBox: competition.ok ? competition.data : { status: 'INCONCLUSIVO' }, priceConfirmed: Number(remote.data.price) === Number(row.new_price) } });
        processed++;
      } catch (error: any) { errors.push({ itemId: row.ml_item_id, error: error.message }); break; }
    }
  }
  return { processed, errors };
}
