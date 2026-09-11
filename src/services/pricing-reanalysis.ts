import 'server-only';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { loadPricingDetail } from '@/services/pricing-detail';
import { persistProductMlGroups, resolveProductMlLinks } from '@/services/ml-listing-links';

export const PRICING_REANALYSIS_JOB_TYPE = 'pricing_product_reanalysis';
const ACTIVE_JOB_STATES = ['pendente', 'rodando', 'on_hold'];
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000;
const MATERIAL_RETRY_CODES = new Set([
  'CONTEXTO_ALTERADO',
  'PRODUTO_LOCAL_ALTERADO',
  'ANUNCIO_REMOTO_ALTERADO',
  'GRUPO_ALTERADO',
  'CONCORRENCIA_ALTERADA',
]);

type Client = ReturnType<typeof createServiceClient>;
type JobSource = 'manual' | 'scheduled_refresh';

function parseLog(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function productIdFromJob(job: any): string | null {
  const entry = parseLog(job?.log).find((row) => typeof row?.productId === 'string');
  return entry?.productId || null;
}

function attemptFromJob(job: any): number {
  return parseLog(job?.log).reduce((value, row) => Math.max(value, Number(row?.attempt || 0)), 0);
}

function retryDue(job: any): boolean {
  const next = [...parseLog(job?.log)].reverse().find((row) => row?.nextRetryAt)?.nextRetryAt;
  return !next || !Number.isFinite(Date.parse(next)) || Date.parse(next) <= Date.now();
}

async function readJob(client: Client, jobId: string) {
  return client.from('jobs').select('id,tipo,status,created_by,dedupe_key,log,created_at,finished_at')
    .eq('id', jobId).maybeSingle();
}

export async function enqueuePricingReanalysis(input: {
  productId: string;
  source: JobSource;
  actorId?: string | null;
  commandId?: string;
}, client: Client = createServiceClient()) {
  const dedupeKey = `product:${input.productId}`;
  const log = [{ event: 'queued', at: new Date().toISOString(), productId: input.productId, source: input.source, attempt: 0 }];
  const payload = {
    ...(input.commandId ? { id: input.commandId } : {}),
    tipo: PRICING_REANALYSIS_JOB_TYPE,
    status: 'pendente',
    progresso: 0,
    total: 1,
    processados: 0,
    unidade_progresso: 'itens',
    created_by: input.actorId ?? null,
    dedupe_key: dedupeKey,
    log,
  };
  const inserted = await client.from('jobs').insert(payload).select('id,status,created_by,log').single();
  if (!inserted.error && inserted.data?.id) return { jobId: inserted.data.id, state: inserted.data.status, replayed: false };

  if (input.commandId) {
    const prior = await readJob(client, input.commandId);
    if (!prior.error && prior.data && productIdFromJob(prior.data) === input.productId
      && prior.data.created_by === (input.actorId ?? null)) {
      return { jobId: prior.data.id, state: prior.data.status, replayed: true };
    }
  }
  const active = await client.from('jobs').select('id,status,created_by,log')
    .eq('tipo', PRICING_REANALYSIS_JOB_TYPE).eq('dedupe_key', dedupeKey)
    .in('status', ACTIVE_JOB_STATES).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!active.error && active.data?.id && productIdFromJob(active.data) === input.productId) {
    return { jobId: active.data.id, state: active.data.status, replayed: true };
  }
  throw new Error('pricing_reanalysis_queue_failed');
}

async function evaluateProduct(client: Client, productId: string, actorId: string | null) {
  const [product, account] = await Promise.all([
    client.from('produtos').select('*').eq('id', productId).maybeSingle(),
    fetchMLResult<any>('/users/me'),
  ]);
  if (product.error || !product.data) throw new Error('product_unavailable');
  if (!account.ok || !account.data?.id || account.data.site_id !== 'MLB') throw new Error('ml_account_unavailable');
  const productData = product.data;

  const observedAt = new Date().toISOString();
  const links = await resolveProductMlLinks(client, productData, Number(account.data.id));
  const stored = await persistProductMlGroups(client, productId, Number(account.data.id), links, observedAt);
  if (stored?.applied !== true) throw new Error('group_observation_not_applied');

  const candidates = links.candidates.filter((row) => ['active', 'paused'].includes(row.status) && !row.variationId);
  const execution = candidates.sort((a, b) => {
    const aPointer = a.itemId === productData.ml_item_id ? 0 : 1;
    const bPointer = b.itemId === productData.ml_item_id ? 0 : 1;
    return aPointer - bPointer || Number(a.catalog) - Number(b.catalog)
      || Number(b.identity === 'complete') - Number(a.identity === 'complete') || a.itemId.localeCompare(b.itemId);
  })[0];
  if (!execution) throw new Error('listing_identity_pending');
  const verifiedGroup = links.groups.find((group) => group.state === 'verified'
    && group.members.some((member) => member.itemId === execution.itemId));
  const competitionItemId = verifiedGroup?.members.find((member) => member.catalog)?.itemId
    || (execution.catalog ? execution.itemId : null);
  const response = await loadPricingDetail(
    { produtoId: productId, mlItemId: execution.itemId },
    { actorId, competitionItemId },
  );
  const detail = await response.json();
  if (!response.ok) {
    const error = new Error(detail.code || 'pricing_reanalysis_unavailable') as Error & { transient?: boolean };
    error.transient = response.status >= 500 || detail.code === 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL';
    throw error;
  }
  return { detail, links, executionItemId: execution.itemId, competitionItemId };
}

export async function runPricingReanalysisJob(jobId: string, options: { force?: boolean } = {}, client: Client = createServiceClient()) {
  const current = await readJob(client, jobId);
  if (current.error || !current.data || current.data.tipo !== PRICING_REANALYSIS_JOB_TYPE)
    throw new Error('pricing_reanalysis_job_missing');
  const productId = productIdFromJob(current.data);
  if (!productId) throw new Error('pricing_reanalysis_job_invalid');
  if (['completo', 'erro', 'cancelado'].includes(current.data.status)) {
    return { jobId, productId, state: current.data.status, replayed: true };
  }
  if (current.data.status === 'rodando') return { jobId, productId, state: 'rodando', replayed: true };
  if (current.data.status === 'on_hold' && !options.force && !retryDue(current.data))
    return { jobId, productId, state: 'on_hold', replayed: true };

  const attempt = attemptFromJob(current.data) + 1;
  const startedAt = new Date().toISOString();
  const log = [...parseLog(current.data.log), { event: 'started', at: startedAt, productId, attempt }];
  const claim = await client.from('jobs').update({ status: 'rodando', finished_at: null, log })
    .eq('id', jobId).in('status', ['pendente', 'on_hold']).select('id').maybeSingle();
  if (claim.error || !claim.data?.id) return { jobId, productId, state: 'rodando', replayed: true };

  try {
    let result = await evaluateProduct(client, productId, current.data.created_by || null);
    const materialCode = result.detail?.pricing?.revalidation?.code;
    if (MATERIAL_RETRY_CODES.has(materialCode)) result = await evaluateProduct(client, productId, current.data.created_by || null);
    const finishedAt = new Date().toISOString();
    const completedLog = [...log, { event: 'completed', at: finishedAt, productId, attempt,
      evaluationId: result.detail.evaluationId, executionItemId: result.executionItemId,
      competitionItemId: result.competitionItemId, groupCoverage: result.links.coverage,
      groups: result.links.groups.length, diagnosis: result.detail?.competitiveAssessment?.classification || 'SEM_REFERENCIA_COMPETITIVA' }];
    const saved = await client.from('jobs').update({ status: 'completo', progresso: 100, processados: 1,
      finished_at: finishedAt, log: completedLog }).eq('id', jobId).eq('status', 'rodando');
    if (saved.error) throw new Error('reanalysis_persistence_failed');
    return { jobId, productId, state: 'completo', evaluationId: result.detail.evaluationId,
      itemId: result.executionItemId, competitionItemId: result.competitionItemId, replayed: false };
  } catch (cause) {
    const error = cause as Error & { transient?: boolean };
    const transient = error.transient === true || ['ml_account_unavailable', 'pricing_reanalysis_unavailable'].includes(error.message);
    const hold = transient && attempt < MAX_ATTEMPTS;
    const finishedAt = new Date().toISOString();
    const failedLog = [...log, { event: hold ? 'deferred' : 'failed', at: finishedAt, productId, attempt,
      code: error.message || 'pricing_reanalysis_unavailable',
      ...(hold ? { nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString() } : {}) }];
    await client.from('jobs').update({ status: hold ? 'on_hold' : 'erro', finished_at: hold ? null : finishedAt,
      progresso: hold ? 0 : 100, log: failedLog }).eq('id', jobId).eq('status', 'rodando');
    return { jobId, productId, state: hold ? 'on_hold' : 'erro', error: error.message, replayed: false };
  }
}

/** Enfileira somente produtos que já possuem alerta aberto e cuja última leitura envelheceu. */
export async function enqueueStalePricingReanalyses(client: Client = createServiceClient(), staleMinutes = 15) {
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const alerts = await client.from('pricing_alerts').select('produto_id,last_seen_at')
    .eq('state', 'open').is('merged_into', null).lt('last_seen_at', staleBefore)
    .order('last_seen_at', { ascending: true }).limit(20);
  if (alerts.error) throw new Error('pricing_reanalysis_alert_read_failed');
  const productIds = [...new Set((alerts.data || []).map((row) => String(row.produto_id)).filter(Boolean))];
  let enqueued = 0;
  for (const productId of productIds) {
    try {
      const result = await enqueuePricingReanalysis({ productId, source: 'scheduled_refresh' }, client);
      if (!result.replayed) enqueued += 1;
    } catch {
      // Uma falha isolada não impede a fila dos demais produtos.
    }
  }
  return { candidates: productIds.length, enqueued };
}

export async function processPricingReanalysisQueue(client: Client = createServiceClient()) {
  const queued = await client.from('jobs').select('id,status,log,created_at')
    .eq('tipo', PRICING_REANALYSIS_JOB_TYPE).in('status', ['pendente', 'on_hold'])
    .order('created_at', { ascending: true }).limit(5);
  if (queued.error) throw new Error('pricing_reanalysis_queue_read_failed');
  let processed = 0;
  let completed = 0;
  let deferred = 0;
  for (const job of queued.data || []) {
    if (job.status === 'on_hold' && !retryDue(job)) continue;
    const result = await runPricingReanalysisJob(job.id, {}, client);
    processed += 1;
    if (result.state === 'completo') completed += 1;
    if (result.state === 'on_hold') { deferred += 1; break; }
  }
  return { processed, completed, deferred };
}
