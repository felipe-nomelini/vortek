import 'server-only';

import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { normalizeBuyBoxStatus, normalizePriceToWin } from '@/lib/catalogo/no-catalogo';

type CheckpointRow = {
  id: string;
  experiment_id: string;
  checkpoint: 'D1' | 'D3' | 'D7';
  attempts: number;
};

function moneyCents(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function nestedPedido(value: unknown): any | null {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

async function collectCheckpoint(client: ReturnType<typeof createServiceClient>, checkpoint: CheckpointRow) {
  const found = await (client as any).from('pricing_experiments').select('*')
    .eq('id', checkpoint.experiment_id).single();
  if (found.error || !found.data) throw new Error('pricing_experiment_missing');
  const experiment = found.data as any;
  const baseline = experiment.baseline || {};
  const [item, competition, sales] = await Promise.all([
    fetchMLResult<any>(`/items/${encodeURIComponent(experiment.ml_item_id)}`),
    fetchMLResult<any>(`/items/${encodeURIComponent(experiment.ml_item_id)}/price_to_win?siteId=MLB&version=v2`),
    (client as any).from('pedido_itens')
      .select('id,quantidade,valor_total_liquido,frete_rateado_item,cmv_total_snapshot,pedido:pedidos!inner(id,ml_order_id,situacao,data_venda)')
      .eq('ml_item_id', experiment.ml_item_id)
      .gte('pedido.data_venda', experiment.started_at)
      .neq('pedido.situacao', 'cancelado'),
  ]);
  if (!item.ok || item.data?.id !== experiment.ml_item_id || !competition.ok || sales.error) {
    throw new Error('pricing_experiment_live_read_failed');
  }
  const currentPriceCents = moneyCents(item.data.price);
  if (currentPriceCents === null) throw new Error('pricing_experiment_price_invalid');

  const rows = (sales.data || []).flatMap((row: any) => {
    const pedido = nestedPedido(row.pedido);
    const quantity = Number(row.quantidade);
    const netCents = moneyCents(row.valor_total_liquido);
    const freightCents = moneyCents(row.frete_rateado_item || 0);
    if (!pedido || !Number.isSafeInteger(quantity) || quantity <= 0 || netCents === null || freightCents === null) return [];
    return [{ ...row, pedido, quantity, revenueCents: Math.max(0, netCents - freightCents) }];
  });
  const orderIds = new Set(rows.map((row: any) => String(row.pedido.ml_order_id || row.pedido.id)));
  const units = rows.reduce((sum: number, row: any) => sum + row.quantity, 0);
  const revenueCents = rows.reduce((sum: number, row: any) => sum + row.revenueCents, 0);
  const costCents = rows.reduce((sum: number, row: any) => {
    const captured = moneyCents(row.cmv_total_snapshot);
    return sum + (captured ?? row.quantity * Number(baseline.costCents || 0));
  }, 0);
  const priceAfterCents = Number(baseline.priceAfterCents || 0);
  const feeRate = priceAfterCents > 0 ? Number(baseline.feeCents || 0) / priceAfterCents : 0;
  const estimatedFeeCents = Math.ceil(revenueCents * feeRate);
  const estimatedShippingCents = units * Number(baseline.shippingCents || 0);
  const estimatedTaxCents = Math.ceil(revenueCents * Number(baseline.taxRate || 0));
  const estimatedResultCents = revenueCents - costCents - estimatedFeeCents - estimatedShippingCents - estimatedTaxCents;
  const observedAt = new Date().toISOString();
  const observation = {
    observedAt,
    buyBoxStatus: normalizeBuyBoxStatus(competition.data),
    buyBoxWinning: competition.data?.winner?.item_id === experiment.ml_item_id
      || competition.data?.winner?.id === experiment.ml_item_id,
    currentPriceCents,
    priceToWinCents: moneyCents(normalizePriceToWin(competition.data)),
    orders: orderIds.size,
    units,
    revenueCents,
    margin: revenueCents > 0 ? estimatedResultCents / revenueCents : null,
    marginStatus: revenueCents > 0 ? 'estimated' : 'unavailable',
    estimatedResultCents: revenueCents > 0 ? estimatedResultCents : null,
    priceChangedExternally: currentPriceCents !== Number(baseline.priceAfterCents),
  };
  const saved = await (client as any).from('pricing_experiment_checkpoints').update({
    state: 'completed', observation, error_code: null, captured_at: observedAt, updated_at: observedAt,
  }).eq('id', checkpoint.id).eq('state', 'processing');
  if (saved.error) throw new Error('pricing_experiment_checkpoint_persist_failed');

  if (observation.priceChangedExternally) {
    await (client as any).from('pricing_experiments').update({
      state: 'interrupted', finished_at: observedAt, updated_at: observedAt,
    }).eq('id', experiment.id).eq('state', 'running');
  } else if (checkpoint.checkpoint === 'D7') {
    await (client as any).from('pricing_experiments').update({
      state: 'completed', finished_at: observedAt, updated_at: observedAt,
    }).eq('id', experiment.id).eq('state', 'running');
  }
  return { id: checkpoint.id, experimentId: experiment.id, checkpoint: checkpoint.checkpoint, ok: true };
}

/** Processa somente observação vencida. Nunca chama qualquer writer de preço. */
export async function processDuePricingExperimentCheckpoints(limit = 5) {
  const client = createServiceClient();
  const claimed = await (client as any).rpc('claim_due_pricing_experiment_checkpoints', { p_limit: limit });
  if (claimed.error) throw new Error('pricing_experiment_checkpoint_claim_failed');
  const results: any[] = [];
  for (const checkpoint of (claimed.data || []) as CheckpointRow[]) {
    try {
      results.push(await collectCheckpoint(client, checkpoint));
    } catch (error) {
      const final = checkpoint.attempts >= 5;
      const code = error instanceof Error ? error.message : 'pricing_experiment_checkpoint_failed';
      const changes: Record<string, unknown> = {
        state: final ? 'failed' : 'pending',
        error_code: code,
        updated_at: new Date().toISOString(),
      };
      if (!final) changes.due_at = new Date(Date.now() + 15 * 60_000).toISOString();
      await (client as any).from('pricing_experiment_checkpoints').update(changes)
        .eq('id', checkpoint.id).eq('state', 'processing');
      if (final && checkpoint.checkpoint === 'D7') {
        await (client as any).from('pricing_experiments').update({
          state: 'safety_stopped', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', checkpoint.experiment_id).eq('state', 'running');
      }
      results.push({ id: checkpoint.id, checkpoint: checkpoint.checkpoint, ok: false, error: code, final });
    }
  }
  return { claimed: (claimed.data || []).length, results };
}
