import { POST as syncObservedListings } from '@/app/api/sync/anuncios/route';
import { createServiceClient } from '@/lib/supabase';
import {
  ML_OBSERVED_BATCH_SIZE,
  ML_OBSERVED_MANIFEST_EVENT,
  ML_OBSERVED_MAX_FAILURES,
  calculateMlObservedProgress,
  hasCompletedMlObservedManifest,
  isMlObservedItemFailureTerminal,
  normalizeMlObservedItemIds,
} from '@/lib/ml/observed-scan-batch';
import type { MlJobOutcome } from '@/lib/sync/job-outcome';

const JOB_TIPO = 'sync_ml_listings_observed';
const MANIFEST_INSERT_SIZE = 1000;

type ObservedJobResult = {
  success: boolean;
  status: MlJobOutcome;
  processados: number;
  total: number;
};

function nowIso() {
  return new Date().toISOString();
}

function parseLog(log: unknown): any[] {
  if (Array.isArray(log)) return [...log];
  if (typeof log === 'string') {
    try {
      const parsed = JSON.parse(log || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function event(eventType: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    event_type: eventType,
    type: eventType.endsWith('_failed') ? 'error' : 'info',
    message,
    timestamp: nowIso(),
    ...extra,
  };
}

async function invokeObserved(payload: Record<string, unknown>) {
  const baseUrl = process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const request = new Request(new URL('/api/sync/anuncios', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.API_SECRET_KEY || '',
    },
    body: JSON.stringify(payload),
  });
  const response = await syncObservedListings(request);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body?.success !== false, status: response.status, body };
}

function getManifestMetadata(logs: any[]) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const entry = logs[index];
    if (entry?.event_type !== ML_OBSERVED_MANIFEST_EVENT) continue;
    return {
      sellerId: Number(entry?.seller_id || 0),
      total: Math.max(0, Number(entry?.total || 0)),
    };
  }
  return null;
}

async function finishJob(input: {
  jobId: string;
  logs: any[];
  total: number;
}) : Promise<ObservedJobResult> {
  const service = createServiceClient();
  const { count: failedCount, error: failedCountError } = await service
    .from('ml_listings_observed_items')
    .select('ml_item_id', { count: 'exact', head: true })
    .eq('job_id', input.jobId)
    .not('last_error', 'is', null);
  if (failedCountError) throw new Error(`Falha ao contar itens parciais: ${failedCountError.message}`);

  const partial = Number(failedCount || 0) > 0;
  const status: MlJobOutcome = partial ? 'completo_parcial' : 'completo';
  input.logs.push(event(
    'ml_observed_job_completed',
    partial
      ? `Sincronização observada concluída com ${Number(failedCount)} item(ns) não processado(s).`
      : 'Sincronização observada concluída.',
    { total: input.total, failed_items_count: Number(failedCount || 0), type: partial ? 'warning' : 'info' },
  ));

  const { error: finishError } = await service.from('jobs').update({
    status,
    progresso: 100,
    processados: input.total,
    total: input.total,
    log: input.logs,
    finished_at: nowIso(),
  }).eq('id', input.jobId).eq('tipo', JOB_TIPO);
  if (finishError) throw new Error(`Falha ao finalizar job: ${finishError.message}`);

  // O job terminal é a evidência durável. O manifesto volumoso já não é necessário.
  const { error: cleanupError } = await service
    .from('ml_listings_observed_items')
    .delete()
    .eq('job_id', input.jobId);
  if (cleanupError) console.error('[ml-listings-observed-job] Falha ao limpar manifesto concluído:', cleanupError.message);

  return { success: true, status, processados: input.total, total: input.total };
}

async function markFailure(jobId: string, error: unknown): Promise<ObservedJobResult> {
  const service = createServiceClient();
  const { data: job } = await service.from('jobs').select('log,total,processados').eq('id', jobId).maybeSingle();
  const logs = parseLog(job?.log);
  const lastSuccessIndex = logs.findLastIndex((entry) => entry?.event_type === 'ml_observed_batch_completed');
  const previousFailures = logs
    .slice(lastSuccessIndex + 1)
    .filter((entry) => entry?.event_type === 'ml_observed_batch_failed' && entry?.lock_conflict !== true).length;
  const failureCount = previousFailures + 1;
  const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
  const authFailure = message.startsWith('auth_fatal:');
  const lockConflict = message.startsWith('domain_lock_conflict:');
  const terminal = authFailure || (!lockConflict && failureCount >= ML_OBSERVED_MAX_FAILURES);
  const status: MlJobOutcome = authFailure ? 'failed_auth' : terminal ? 'erro' : 'on_hold';

  logs.push(event('ml_observed_batch_failed', message.replace(/^[^:]+:\s*/, ''), {
    type: terminal ? 'error' : 'warning',
    failure_count: lockConflict ? previousFailures : failureCount,
    lock_conflict: lockConflict,
  }));

  await service.from('jobs').update({
    status,
    log: logs,
    finished_at: terminal ? nowIso() : null,
    progresso: terminal ? 100 : undefined,
  }).eq('id', jobId).eq('tipo', JOB_TIPO);

  return {
    success: false,
    status,
    processados: Number(job?.processados || 0),
    total: Number(job?.total || 0),
  };
}

/** Executa um único lote retomável do scan observado do Mercado Livre. */
export async function runMlListingsObservedJobBatch(jobId: string): Promise<ObservedJobResult> {
  const service = createServiceClient();
  const { data: claimed, error: claimError } = await service
    .from('jobs')
    .update({ status: 'rodando', finished_at: null })
    .eq('id', jobId)
    .eq('tipo', JOB_TIPO)
    .in('status', ['pendente', 'on_hold'])
    .select('id,status,log,total,processados')
    .maybeSingle();

  if (claimError) throw new Error(`Falha ao assumir job observado: ${claimError.message}`);
  if (!claimed?.id) {
    const { data: current } = await service.from('jobs').select('status,total,processados').eq('id', jobId).maybeSingle();
    const currentStatus = String(current?.status || 'on_hold');
    const status: MlJobOutcome = currentStatus === 'completo_parcial'
      ? 'completo_parcial'
      : currentStatus === 'completo'
        ? 'completo'
        : currentStatus === 'failed_auth'
          ? 'failed_auth'
          : currentStatus === 'erro'
            ? 'erro'
            : 'on_hold';
    return { success: ['completo', 'completo_parcial'].includes(status), status, processados: Number(current?.processados || 0), total: Number(current?.total || 0) };
  }

  const logs = parseLog(claimed.log);

  try {
    let metadata = getManifestMetadata(logs);
    if (!hasCompletedMlObservedManifest(logs)) {
      logs.push(event('ml_observed_scan_started', 'Iniciando scan único dos anúncios do Mercado Livre.'));
      await service.from('jobs').update({ log: logs, progresso: 2 }).eq('id', jobId);

      const manifest = await invokeObserved({ action: 'manifest', syncJobId: jobId });
      if (!manifest.ok) {
        if (manifest.status === 401 || manifest.body?.failure_reason === 'auth_fatal') throw new Error('auth_fatal: integração ML requer reconexão');
        if (manifest.status === 409) throw new Error('domain_lock_conflict: domínio de anúncios ocupado');
        throw new Error(manifest.body?.errors?.[0]?.message || `Falha HTTP ${manifest.status} ao criar manifesto`);
      }

      const sellerId = Number(manifest.body?.seller_id || 0);
      const itemIds = normalizeMlObservedItemIds(manifest.body?.item_ids);
      if (!sellerId) throw new Error('Manifesto observado sem seller_id válido.');

      const { error: clearError } = await service.from('ml_listings_observed_items').delete().eq('job_id', jobId);
      if (clearError) throw new Error(`Falha ao reiniciar manifesto parcial: ${clearError.message}`);

      for (let index = 0; index < itemIds.length; index += MANIFEST_INSERT_SIZE) {
        const rows = itemIds.slice(index, index + MANIFEST_INSERT_SIZE).map((mlItemId, offset) => ({
          job_id: jobId,
          seller_id: sellerId,
          ml_item_id: mlItemId,
          ordinal: index + offset,
        }));
        const { error } = await service.from('ml_listings_observed_items').insert(rows);
        if (error) throw new Error(`Falha ao salvar manifesto observado: ${error.message}`);
      }

      metadata = { sellerId, total: itemIds.length };
      logs.push(event(ML_OBSERVED_MANIFEST_EVENT, `${itemIds.length} anúncio(s) registrado(s) para processamento retomável.`, {
        seller_id: sellerId,
        total: itemIds.length,
        scan_pages_fetched: Number(manifest.body?.scan_pages_fetched || 0),
        retries_transient: Number(manifest.body?.retries_transient || 0),
      }));
      await service.from('jobs').update({ log: logs, total: itemIds.length, processados: 0, progresso: 10 }).eq('id', jobId);
    }

    if (!metadata?.sellerId) throw new Error('Metadados do manifesto observado ausentes.');
    const total = metadata.total;
    if (total === 0) return await finishJob({ jobId, logs, total });

    const { data: pendingRows, error: pendingError } = await service
      .from('ml_listings_observed_items')
      .select('ml_item_id,attempts')
      .eq('job_id', jobId)
      .is('processed_at', null)
      .order('ordinal', { ascending: true })
      .limit(ML_OBSERVED_BATCH_SIZE);
    if (pendingError) throw new Error(`Falha ao carregar lote observado: ${pendingError.message}`);
    if (!pendingRows || pendingRows.length === 0) return await finishJob({ jobId, logs, total });

    const itemIds = pendingRows.map((row) => row.ml_item_id);
    for (const attempts of Array.from(new Set(pendingRows.map((row) => Number(row.attempts || 0))))) {
      const ids = pendingRows.filter((row) => Number(row.attempts || 0) === attempts).map((row) => row.ml_item_id);
      const { error } = await service.from('ml_listings_observed_items')
        .update({ attempts: attempts + 1, updated_at: nowIso() })
        .eq('job_id', jobId)
        .in('ml_item_id', ids);
      if (error) throw new Error(`Falha ao registrar tentativa do lote: ${error.message}`);
    }

    const batch = await invokeObserved({ action: 'batch', itemIds, totalMl: total, syncJobId: jobId });
    if (!batch.ok) {
      if (batch.status === 401 || batch.body?.failure_reason === 'auth_fatal') throw new Error('auth_fatal: integração ML requer reconexão');
      if (batch.status === 409) throw new Error('domain_lock_conflict: domínio de anúncios ocupado');
      throw new Error(batch.body?.errors?.[0]?.message || `Falha HTTP ${batch.status} no lote observado`);
    }

    const failedIds = new Set(normalizeMlObservedItemIds(batch.body?.failed_item_ids).filter((id) => itemIds.includes(id)));
    const successfulIds = itemIds.filter((id) => !failedIds.has(id));
    const processedAt = nowIso();

    if (successfulIds.length > 0) {
      const { error } = await service.from('ml_listings_observed_items')
        .update({ processed_at: processedAt, last_error: null, updated_at: processedAt })
        .eq('job_id', jobId)
        .in('ml_item_id', successfulIds);
      if (error) throw new Error(`Falha ao confirmar itens observados: ${error.message}`);
    }

    for (const failedId of failedIds) {
      const previousAttempts = Number(pendingRows.find((row) => row.ml_item_id === failedId)?.attempts || 0);
      const terminalItem = isMlObservedItemFailureTerminal(previousAttempts + 1);
      const { error } = await service.from('ml_listings_observed_items')
        .update({
          processed_at: terminalItem ? processedAt : null,
          last_error: 'ml_item_fetch_failed',
          updated_at: processedAt,
        })
        .eq('job_id', jobId)
        .eq('ml_item_id', failedId);
      if (error) throw new Error(`Falha ao registrar item observado com erro: ${error.message}`);
    }

    const { count: processedCount, error: countError } = await service
      .from('ml_listings_observed_items')
      .select('ml_item_id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .not('processed_at', 'is', null);
    if (countError) throw new Error(`Falha ao contar progresso observado: ${countError.message}`);

    const processed = Number(processedCount || 0);
    const progress = calculateMlObservedProgress(processed, total);
    logs.push(event('ml_observed_batch_completed', `Lote observado concluído: ${processed}/${total}.`, {
      processed,
      total,
      progress,
      batch_size: itemIds.length,
      failed_items_count: failedIds.size,
      warnings_count: Array.isArray(batch.body?.warnings) ? batch.body.warnings.length : 0,
    }));

    if (processed >= total) return await finishJob({ jobId, logs, total });

    await service.from('jobs').update({
      status: 'on_hold',
      progresso: progress,
      processados: processed,
      total,
      log: logs,
      finished_at: null,
    }).eq('id', jobId).eq('tipo', JOB_TIPO);

    setTimeout(() => {
      void runMlListingsObservedJobBatch(jobId).catch((error) => {
        console.error('[ml-listings-observed-job] Falha ao retomar lote:', error);
      });
    }, 250);

    return { success: true, status: 'on_hold', processados: processed, total };
  } catch (error) {
    return await markFailure(jobId, error);
  }
}
