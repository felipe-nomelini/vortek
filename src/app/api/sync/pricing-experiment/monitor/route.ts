import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { sendWhatsappAlert } from '@/services/whatsapp-alerts';
import {
  getHighMarginPricingExperiment,
  pricingExperimentUnitResult,
  saveHighMarginPricingExperiment,
  type PricingExperimentCheckpoint,
  type PricingExperimentGroup,
} from '@/lib/ml/pricing-experiment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const CHECKPOINT_BATCH_SIZE = 25;
const MAX_SAFETY_PAUSE_ATTEMPTS = 3;
const DATABASE_BATCH_SIZE = 100;

function nowIso() { return new Date().toISOString(); }
function isoDay(value = new Date()) { return new Date(value).toISOString().slice(0, 10); }

function dueCheckpoint(group: PricingExperimentGroup, now = Date.now()): PricingExperimentCheckpoint | null {
  const ageDays = (now - new Date(group.started_at).getTime()) / 86_400_000;
  if (ageDays >= 30 && !group.checkpoints?.D30) return 'D30';
  if (ageDays >= 15 && !group.checkpoints?.D15) return 'D15';
  if (ageDays >= 7 && !group.checkpoints?.D7) return 'D7';
  return null;
}

function checkpointDays(checkpoint: PricingExperimentCheckpoint): number {
  if (checkpoint === 'D7') return 7;
  if (checkpoint === 'D15') return 15;
  return 30;
}

function checkpointClassification(checkpoint: PricingExperimentCheckpoint, visits: number, orders: number) {
  if (checkpoint === 'D7' && visits === 0) return 'OBSERVACAO_SEM_TRAFEGO';
  if (checkpoint === 'D15' && visits === 0) return 'ALERTA_AMARELO_SEM_TRAFEGO';
  if (checkpoint === 'D30') {
    if (visits <= 5) return 'FALHA_DE_EXPOSICAO_PROVAVEL';
    if (orders === 0) return 'TRAFEGO_SEM_CONVERSAO';
    if (orders >= 2) return 'EXPERIMENTO_COM_SUCESSO_FORTE';
    return 'PRECO_RELEVANTE_PARA_PERFORMANCE';
  }
  return orders > 0 ? 'TRAFEGO_E_VENDA_OBSERVADOS' : 'MONITORAMENTO_NORMAL';
}

function standardPrice(payload: any): number | null {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const row = prices.find((candidate: any) => {
    const contexts = candidate?.conditions?.context_restrictions || [];
    return candidate?.eligible !== false
      && String(candidate?.type || '').toLowerCase() === 'standard'
      && Number(candidate?.conditions?.min_purchase_unit || 1) === 1
      && (!contexts.length || contexts.includes('channel_marketplace'));
  });
  const value = Number(row?.amount);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function visitTotal(payload: any): number {
  if (Array.isArray(payload?.results)) {
    return payload.results.reduce((sum: number, row: any) => sum + Number(row.total || row.visits || 0), 0);
  }
  return Number(payload?.total || 0);
}

async function pauseLossGroup(client: ReturnType<typeof createServiceClient>, group: PricingExperimentGroup) {
  const remote: Array<{ ml_item_id: string; ok: boolean; status: number | null; error: string | null }> = [];
  for (const mlItemId of group.ml_item_ids) {
    const observed = await fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}`);
    if (observed.ok && String(observed.data?.status || '') === 'paused') {
      remote.push({ ml_item_id: mlItemId, ok: true, status: observed.status, error: null });
      continue;
    }
    const result = await fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }),
    });
    const confirmed = result.ok ? await fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}`) : result;
    const ok = Boolean(result.ok && confirmed.ok && String(confirmed.data?.status || '') === 'paused');
    remote.push({ ml_item_id: mlItemId, ok, status: result.status, error: ok ? null : (result.error?.message || 'Pausa não confirmada') });
  }
  const allPaused = remote.every((row) => row.ok);
  if (allPaused) {
    await Promise.all([
      client.from('anuncios_ml').update({ status: 'pausado', updated_at: nowIso() }).in('ml_item_id', group.ml_item_ids),
      client.from('produtos').update({ ml_status: 'pausado', updated_at: nowIso() }).eq('id', group.product_id),
    ]);
  }
  return { allPaused, remote };
}

async function runCheckpoint(client: ReturnType<typeof createServiceClient>, group: PricingExperimentGroup, checkpoint: PricingExperimentCheckpoint) {
  const days = checkpointDays(checkpoint);
  let visits = 0;
  let priceConfirmed = true;
  for (const mlItemId of group.ml_item_ids) {
    const [visitResponse, priceResponse] = await Promise.all([
      fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}/visits/time_window?last=${days}&unit=day&ending=${isoDay()}`),
      fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}/prices`),
    ]);
    if (!visitResponse.ok || !priceResponse.ok) throw new Error(`Evidência ML indisponível para ${mlItemId}`);
    visits += visitTotal(visitResponse.data);
    const observedPrice = standardPrice(priceResponse.data);
    priceConfirmed = priceConfirmed && observedPrice !== null && Math.abs(observedPrice - group.experimental_price) < 0.01;
  }
  const { data: soldItems, error } = await client.from('pedido_itens')
    .select('ml_order_id,created_at')
    .in('ml_item_id', group.ml_item_ids)
    .gte('created_at', group.started_at);
  if (error) throw new Error(`Falha ao carregar vendas da coorte: ${error.message}`);
  const orders = new Set((soldItems || []).map((row) => String(row.ml_order_id || '')).filter(Boolean)).size;
  return {
    completed_at: nowIso(), visits, orders, price_confirmed: priceConfirmed,
    classification: checkpointClassification(checkpoint, visits, orders),
  };
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }
  const client = createServiceClient();
  const state = await getHighMarginPricingExperiment(client);
  if (!state || state.status === 'closed' || !state.groups.length) {
    return NextResponse.json({ sucesso: true, processados: 0, total: 0, skipped: 'experimento_inativo' });
  }
  if (state.status === 'executing') {
    return NextResponse.json({ sucesso: true, processados: 0, total: 0, skipped: 'execucao_d0_em_andamento' });
  }

  const activeGroups = state.groups.filter((group) => group.status === 'active' || group.status === 'awaiting_director_decision');
  if (!activeGroups.length) {
    state.status = 'awaiting_director_decision';
    await saveHighMarginPricingExperiment(client, state);
    return NextResponse.json({ sucesso: true, processados: 0, total: 0, skipped: 'sem_grupos_ativos' });
  }
  const productIds = activeGroups.map((group) => group.product_id);
  const products: any[] = [];
  for (let index = 0; index < productIds.length; index += DATABASE_BATCH_SIZE) {
    const { data, error } = await client.from('produtos')
      .select('id,custo,custom_price,ml_fee,ml_shipping')
      .in('id', productIds.slice(index, index + DATABASE_BATCH_SIZE));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    products.push(...(data || []));
  }
  const productById = new Map(products.map((product) => [String(product.id), product]));
  let safetyPaused = 0;
  const safetyFailures: any[] = [];

  for (const group of activeGroups) {
    const product = productById.get(group.product_id);
    if (!product) continue;
    const currentPrice = Number(product.custom_price || group.experimental_price);
    const currentCost = Number(product.custo);
    const result = pricingExperimentUnitResult({
      price: currentPrice, cost: currentCost, feeAmount: group.fee_amount,
      shippingAmount: Number(product.ml_shipping ?? group.shipping_amount), taxRate: group.tax_rate,
    });
    if (result === null || result >= 0) continue;
    const attempts = Number(group.safety_pause_attempts || 0);
    if (attempts >= MAX_SAFETY_PAUSE_ATTEMPTS) continue;
    group.safety_pause_attempts = attempts + 1;
    const pause = await pauseLossGroup(client, group);
    if (pause.allPaused) {
      group.status = 'paused_loss';
      group.stopped_at = nowIso();
      group.stop_reason = `ALERTA_CRITICO_PREJUIZO_EXPERIMENTO: resultado_unitario=${result.toFixed(2)}`;
      safetyPaused += 1;
    } else {
      safetyFailures.push({ pricing_group_id: group.pricing_group_id, attempts: group.safety_pause_attempts, remote: pause.remote });
      if (group.safety_pause_attempts >= MAX_SAFETY_PAUSE_ATTEMPTS) {
        group.status = 'execution_failed';
        group.stop_reason = 'PAUSA_CRITICA_NAO_CONFIRMADA_APOS_3_TENTATIVAS';
      }
    }
    await sendWhatsappAlert({
      type: 'critical_error', severity: 'critical', title: 'Prejuízo em experimento de pricing',
      message: `Grupo ${group.pricing_group_id}: resultado unitário estimado ${result.toFixed(2)}. ${pause.allPaused ? 'Anúncios pausados.' : 'Pausa não confirmada.'}`,
      dedupeKey: `pricing-experiment-loss:${group.pricing_group_id}:${group.safety_pause_attempts}`,
      payload: { pricing_group_id: group.pricing_group_id, sku: group.sku, result, pause_confirmed: pause.allPaused },
    });
  }

  const due = state.groups
    .filter((group) => group.status === 'active' || group.status === 'awaiting_director_decision')
    .map((group) => ({ group, checkpoint: dueCheckpoint(group) }))
    .filter((entry): entry is { group: PricingExperimentGroup; checkpoint: PricingExperimentCheckpoint } => Boolean(entry.checkpoint))
    .slice(0, CHECKPOINT_BATCH_SIZE);
  let checkpointsCompleted = 0;
  const checkpointFailures: any[] = [];
  for (const entry of due) {
    try {
      const result = await runCheckpoint(client, entry.group, entry.checkpoint);
      entry.group.checkpoints = { ...(entry.group.checkpoints || {}), [entry.checkpoint]: result };
      checkpointsCompleted += 1;
      if (result.classification === 'ALERTA_AMARELO_SEM_TRAFEGO') {
        await sendWhatsappAlert({
          type: 'critical_error', severity: 'warning', title: 'Alerta amarelo: experimento sem tráfego',
          message: `Grupo ${entry.group.pricing_group_id} permanece sem visitas no D+15.`,
          dedupeKey: `pricing-experiment-yellow:${entry.group.pricing_group_id}:D15`,
          payload: { pricing_group_id: entry.group.pricing_group_id, sku: entry.group.sku, checkpoint: 'D15' },
        });
      }
    } catch (error: any) {
      checkpointFailures.push({ pricing_group_id: entry.group.pricing_group_id, checkpoint: entry.checkpoint, error: error?.message || 'Falha no checkpoint' });
    }
  }

  const monitored = state.groups.filter((group) => group.status !== 'execution_failed');
  if (monitored.length > 0 && monitored.every((group) => Boolean(group.checkpoints?.D30) || group.status === 'paused_loss')) {
    state.status = 'awaiting_director_decision';
    for (const group of state.groups) if (group.status === 'active') group.status = 'awaiting_director_decision';
  }
  await saveHighMarginPricingExperiment(client, state);
  return NextResponse.json({
    sucesso: checkpointFailures.length === 0 && safetyFailures.length === 0,
    processados: checkpointsCompleted + safetyPaused,
    total: due.length + safetyPaused,
    checkpoint_due: due.length,
    checkpoints_completed: checkpointsCompleted,
    safety_paused: safetyPaused,
    errors: [...checkpointFailures, ...safetyFailures],
  }, { status: checkpointFailures.length || safetyFailures.length ? 207 : 200 });
}
