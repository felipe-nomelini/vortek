import { createServiceClient } from '@/lib/supabase';
import { POST as refreshCatalogSnapshot } from '@/app/api/catalogo/no-catalogo/refresh/route';
import {
  CATALOG_REFRESH_BATCH_SIZE,
  CATALOG_REFRESH_MAX_FAILURES,
  calculateCatalogRefreshOutcome,
  calculateCatalogRefreshProgress,
  getCatalogRefreshFailureStage,
  normalizeCatalogRefreshItemIds,
  splitCatalogRefreshFailures,
} from '@/lib/catalogo/refresh-batch';

const JOB_TIPO = 'catalogo_no_catalogo_refresh';
const QUEUE_INSERT_SIZE = 1000;

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

function progressEvent(input: {
  stage: string;
  message: string;
  processed?: number;
  total?: number;
  progress?: number;
  type?: 'info' | 'warning' | 'error';
  extra?: Record<string, unknown>;
}) {
  return {
    event_type: 'catalog_refresh_progress',
    type: input.type || 'info',
    stage: input.stage,
    message: input.message,
    processed: input.processed ?? null,
    total: input.total ?? null,
    progress: input.progress ?? null,
    timestamp: nowIso(),
    ...(input.extra || {}),
  };
}

async function invokeRefresh(payload: Record<string, unknown>) {
  const baseUrl = process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const request = new Request(new URL('/api/catalogo/no-catalogo/refresh', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.API_SECRET_KEY || '',
    },
    body: JSON.stringify(payload),
  });
  const response = await refreshCatalogSnapshot(request);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body?.success !== false, status: response.status, body };
}

async function markJobFailure(jobId: string, error: unknown) {
  const service = createServiceClient();
  const { data: job } = await service
    .from('jobs')
    .select('log')
    .eq('id', jobId)
    .maybeSingle();
  const logs = parseLog(job?.log);
  const lastSuccessIndex = logs.findLastIndex((entry) => entry?.event_type === 'catalog_refresh_batch_completed');
  const previousFailures = logs
    .slice(lastSuccessIndex + 1)
    .filter((entry) => entry?.event_type === 'catalog_refresh_batch_failed').length;
  const failureCount = previousFailures + 1;
  const terminal = failureCount >= CATALOG_REFRESH_MAX_FAILURES;
  const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
  const failureStage = getCatalogRefreshFailureStage(logs);

  logs.push(progressEvent({
    stage: failureStage,
    message: terminal
      ? `Refresh interrompido após ${failureCount} falhas consecutivas: ${message}`
      : `Lote adiado após falha transitória (${failureCount}/${CATALOG_REFRESH_MAX_FAILURES}): ${message}`,
    type: terminal ? 'error' : 'warning',
    extra: { event_type: 'catalog_refresh_batch_failed', failure_count: failureCount },
  }));

  await service
    .from('jobs')
    .update({
      status: terminal ? 'erro' : 'on_hold',
      log: logs,
      finished_at: terminal ? nowIso() : null,
      progresso: terminal ? 100 : undefined,
    })
    .eq('id', jobId)
    .eq('tipo', JOB_TIPO);

  return { success: false, status: terminal ? 'erro' : 'on_hold', error: message };
}

async function finalizeRefresh(input: {
  jobId: string;
  sellerId: number;
  logs: any[];
  total: number;
}) {
  const service = createServiceClient();
  const { error: staleError, count: removed } = await service
    .from('catalogo_ml_snapshot')
    .update({
      catalog_listing: false,
      related_item_id: null,
      related_permalink: null,
      buy_box_status: null,
      buy_box_winning: false,
      price_to_win: null,
      synced_at: nowIso(),
    }, { count: 'exact' })
    .eq('seller_id', input.sellerId)
    .eq('catalog_listing', true)
    .or(`refresh_job_id.is.null,refresh_job_id.neq.${input.jobId}`);

  if (staleError) throw new Error(`Falha ao finalizar snapshot: ${staleError.message}`);

  const { count: detailsUnavailableCount } = await service
    .from('catalogo_ml_refresh_items')
    .select('ml_item_id', { count: 'exact', head: true })
    .eq('job_id', input.jobId)
    .not('last_error', 'is', null);
  const competitionUnavailableCount = input.logs.reduce(
    (sum, entry) => sum + Number(entry?.competition_unavailable_count || 0),
    0,
  );
  const outcome = calculateCatalogRefreshOutcome({
    total: input.total,
    detailsUnavailable: Number(detailsUnavailableCount || 0),
    competitionUnavailable: competitionUnavailableCount,
  });
  const allDetailsUnavailable = outcome.status === 'erro';
  const partial = outcome.status === 'completo_parcial';

  input.logs.push(progressEvent({
    stage: 'fetch_related',
    message: 'Anúncios relacionados carregados durante os lotes.',
    processed: input.total,
    total: input.total,
    progress: 90,
  }));
  input.logs.push(progressEvent({
    stage: 'match_products',
    message: 'Produtos locais vinculados durante os lotes.',
    processed: input.total,
    total: input.total,
    progress: 94,
  }));
  input.logs.push(progressEvent({
    stage: 'save_snapshot',
    message: `${outcome.updated} anúncios atualizados; ${Number(removed || 0)} anúncios que saíram do catálogo foram identificados.`,
    processed: input.total,
    total: input.total,
    progress: 99,
  }));
  input.logs.push(progressEvent({
    stage: 'completed',
    message: allDetailsUnavailable
      ? 'Não foi possível atualizar os anúncios. Os dados anteriores foram preservados.'
      : partial
        ? `${outcome.updated} anúncios atualizados; ${outcome.issues} precisam de nova consulta. Os dados anteriores foram preservados.`
        : 'Catálogo atualizado com sucesso.',
    processed: input.total,
    total: input.total,
    progress: 100,
    type: allDetailsUnavailable ? 'error' : partial ? 'warning' : 'info',
    extra: {
      details_unavailable_count: outcome.detailsUnavailable,
      competition_unavailable_count: competitionUnavailableCount,
      updated_count: outcome.updated,
    },
  }));

  const status = outcome.status;
  await service
    .from('jobs')
    .update({
      status,
      progresso: 100,
      processados: input.total,
      total: input.total,
      log: input.logs,
      finished_at: nowIso(),
    })
    .eq('id', input.jobId)
    .eq('tipo', JOB_TIPO);

  return {
    success: !allDetailsUnavailable,
    status,
    processed: input.total,
    total: input.total,
    updated: outcome.updated,
    detailsUnavailable: outcome.detailsUnavailable,
    competitionUnavailable: competitionUnavailableCount,
  };
}

/** Processa somente um lote; cron e chamada local retomam jobs em on_hold. */
export async function runCatalogRefreshJobBatch(jobId: string) {
  const service = createServiceClient();
  const { data: claimed, error: claimError } = await service
    .from('jobs')
    .update({ status: 'rodando', finished_at: null })
    .eq('id', jobId)
    .eq('tipo', JOB_TIPO)
    .in('status', ['pendente', 'on_hold'])
    .select('id,status,log,total,processados,finished_at,dedupe_key')
    .maybeSingle();

  if (claimError) throw new Error(`Falha ao assumir refresh: ${claimError.message}`);
  if (!claimed?.id) return { success: true, status: 'already_running_or_finished' };

  const logs = parseLog(claimed.log);

  try {
    if (claimed.dedupe_key === 'incremental') {
      logs.push(progressEvent({
        stage: 'fetch_details',
        message: 'Atualizando lote incremental do catálogo.',
        progress: 10,
      }));
      const incremental = await invokeRefresh({ mode: 'incremental' });
      if (!incremental.ok) {
        throw new Error(incremental.body?.error || `Falha HTTP ${incremental.status} no refresh incremental`);
      }
      const detailsUnavailable = Number(incremental.body?.issues?.details_unavailable || 0);
      const competitionUnavailable = Number(incremental.body?.issues?.competition_unavailable || 0);
      const issueCount = detailsUnavailable + competitionUnavailable;
      const processed = Number(incremental.body?.processed || 0);
      const status = processed > 0 && detailsUnavailable >= processed
        ? 'erro'
        : issueCount > 0 ? 'completo_parcial' : 'completo';
      logs.push(progressEvent({
        stage: 'completed',
        message: status === 'erro'
          ? 'Não foi possível atualizar os anúncios. Os dados anteriores foram preservados.'
          : status === 'completo_parcial'
            ? `${Math.max(0, processed - detailsUnavailable)} anúncios atualizados; ${issueCount} precisam de nova consulta.`
            : `${processed} anúncios atualizados.`,
        processed,
        total: processed,
        progress: 100,
        type: status === 'erro' ? 'error' : status === 'completo_parcial' ? 'warning' : 'info',
        extra: {
          details_unavailable_count: detailsUnavailable,
          competition_unavailable_count: competitionUnavailable,
        },
      }));
      await service.from('jobs').update({
        status,
        progresso: 100,
        processados: processed,
        total: processed,
        log: logs,
        finished_at: nowIso(),
      }).eq('id', jobId);
      return { success: status !== 'erro', status, processed, total: processed };
    }

    const { count: manifestCount, error: manifestCountError } = await service
      .from('catalogo_ml_refresh_items')
      .select('ml_item_id', { count: 'exact', head: true })
      .eq('job_id', jobId);
    if (manifestCountError) throw new Error(`Falha ao consultar manifesto: ${manifestCountError.message}`);

    let total = Number(manifestCount || 0);
    let sellerId: number;

    if (total === 0) {
      logs.push(progressEvent({
        stage: 'scan_catalog',
        message: 'Listando todos os anúncios de catálogo no Mercado Livre.',
        progress: 2,
      }));
      await service.from('jobs').update({ log: logs, progresso: 2 }).eq('id', jobId);

      const manifest = await invokeRefresh({ action: 'manifest', mode: 'full' });
      if (!manifest.ok) {
        throw new Error(manifest.body?.error || `Falha HTTP ${manifest.status} ao listar catálogo`);
      }

      const itemIds = normalizeCatalogRefreshItemIds(manifest.body?.item_ids);
      sellerId = Number(manifest.body?.seller_id || 0);
      if (!sellerId || itemIds.length === 0) throw new Error('Manifesto do catálogo retornou vazio ou inválido.');

      for (let index = 0; index < itemIds.length; index += QUEUE_INSERT_SIZE) {
        const rows = itemIds.slice(index, index + QUEUE_INSERT_SIZE).map((mlItemId: string, offset: number) => ({
          job_id: jobId,
          seller_id: sellerId,
          ml_item_id: mlItemId,
          ordinal: index + offset,
        }));
        const { error } = await service
          .from('catalogo_ml_refresh_items')
          .upsert(rows, { onConflict: 'job_id,ml_item_id', ignoreDuplicates: true });
        if (error) throw new Error(`Falha ao salvar manifesto: ${error.message}`);
      }

      total = itemIds.length;
      logs.push(progressEvent({
        stage: 'scan_catalog',
        message: `${total} anúncios de catálogo encontrados.`,
        processed: total,
        total,
        progress: 10,
      }));
      logs.push(progressEvent({
        stage: 'fetch_details',
        message: 'Detalhes e preços serão processados em lotes retomáveis.',
        processed: 0,
        total,
        progress: 10,
      }));
      logs.push(progressEvent({
        stage: 'fetch_price_to_win',
        message: `Consultando detalhes e preço para ganhar: 0/${total}.`,
        processed: 0,
        total,
        progress: 32,
      }));
      await service.from('jobs').update({ log: logs, total, progresso: 32 }).eq('id', jobId);
    } else {
      const { data: sellerRow, error: sellerError } = await service
        .from('catalogo_ml_refresh_items')
        .select('seller_id')
        .eq('job_id', jobId)
        .order('ordinal', { ascending: true })
        .limit(1)
        .single();
      if (sellerError || !sellerRow?.seller_id) throw new Error(`Manifesto sem vendedor: ${sellerError?.message || 'seller_id ausente'}`);
      sellerId = Number(sellerRow.seller_id);
    }

    const { data: pendingRows, error: pendingError } = await service
      .from('catalogo_ml_refresh_items')
      .select('ml_item_id,attempts')
      .eq('job_id', jobId)
      .is('processed_at', null)
      .order('ordinal', { ascending: true })
      .limit(CATALOG_REFRESH_BATCH_SIZE);
    if (pendingError) throw new Error(`Falha ao carregar lote: ${pendingError.message}`);

    if (!pendingRows || pendingRows.length === 0) {
      return await finalizeRefresh({ jobId, sellerId, logs, total });
    }

    const itemIds = pendingRows.map((row) => row.ml_item_id);
    const attemptedAt = nowIso();
    const nextAttempts = new Map<number, string[]>();
    for (const row of pendingRows) {
      const nextAttempt = Math.max(0, Math.trunc(Number(row.attempts) || 0)) + 1;
      nextAttempts.set(nextAttempt, [...(nextAttempts.get(nextAttempt) || []), row.ml_item_id]);
    }
    for (const [nextAttempt, ids] of nextAttempts) {
      const { error } = await service
        .from('catalogo_ml_refresh_items')
        .update({ attempts: nextAttempt, updated_at: attemptedAt })
        .eq('job_id', jobId)
        .in('ml_item_id', ids);
      if (error) throw new Error(`Falha ao registrar tentativa do lote: ${error.message}`);
    }

    const batch = await invokeRefresh({
      action: 'batch',
      mode: 'full',
      itemIds,
      refreshJobId: jobId,
      totalMl: total,
    });
    if (!batch.ok) throw new Error(batch.body?.error || `Falha HTTP ${batch.status} no lote`);

    const failedIds = new Set<string>(
      Array.isArray(batch.body?.failed_item_ids)
        ? batch.body.failed_item_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [],
    );
    const successfulIds = itemIds.filter((id) => !failedIds.has(id));
    const processedAt = nowIso();

    if (successfulIds.length > 0) {
      const { error } = await service
        .from('catalogo_ml_refresh_items')
        .update({ processed_at: processedAt, last_error: null, updated_at: processedAt })
        .eq('job_id', jobId)
        .in('ml_item_id', successfulIds);
      if (error) throw new Error(`Falha ao confirmar lote: ${error.message}`);
    }

    const { retryable: retryableFailedIds, exhausted: exhaustedFailedIds } = splitCatalogRefreshFailures(
      pendingRows,
      failedIds,
    );

    if (exhaustedFailedIds.length > 0) {
      const { error } = await service
        .from('catalogo_ml_refresh_items')
        .update({ processed_at: processedAt, last_error: 'item_fetch_failed', updated_at: processedAt })
        .eq('job_id', jobId)
        .in('ml_item_id', exhaustedFailedIds);
      if (error) throw new Error(`Falha ao encerrar tentativas do lote: ${error.message}`);
    }

    if (retryableFailedIds.length > 0) {
      const { error } = await service
        .from('catalogo_ml_refresh_items')
        .update({ processed_at: null, last_error: 'item_fetch_failed', updated_at: processedAt })
        .eq('job_id', jobId)
        .in('ml_item_id', retryableFailedIds);
      if (error) throw new Error(`Falha ao preparar nova tentativa do lote: ${error.message}`);
    }

    if (failedIds.size > 0) {
      const { error } = await service
        .from('catalogo_ml_snapshot')
        .update({ refresh_job_id: jobId })
        .eq('seller_id', sellerId)
        .in('ml_item_id', Array.from(failedIds));
      if (error) throw new Error(`Falha ao preservar dados anteriores do lote: ${error.message}`);
    }

    const competitionUnavailable = Number(batch.body?.issues?.competition_unavailable || 0);
    if (competitionUnavailable > 0 || failedIds.size > 0) {
      logs.push(progressEvent({
        stage: 'fetch_price_to_win',
        message: retryableFailedIds.length > 0
          ? `${retryableFailedIds.length} anúncios serão consultados novamente; os dados anteriores foram preservados.`
          : `${exhaustedFailedIds.length + competitionUnavailable} anúncios precisam de atenção; os dados anteriores foram preservados.`,
        type: 'warning',
        extra: {
          competition_unavailable_count: competitionUnavailable,
          details_retry_count: retryableFailedIds.length,
          details_unavailable_count: exhaustedFailedIds.length,
        },
      }));
    }

    const { count: processedCount, error: processedCountError } = await service
      .from('catalogo_ml_refresh_items')
      .select('ml_item_id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .not('processed_at', 'is', null);
    if (processedCountError) throw new Error(`Falha ao contar progresso: ${processedCountError.message}`);
    const processed = Number(processedCount || 0);
    const progress = calculateCatalogRefreshProgress(processed, total);

    logs.push(progressEvent({
      stage: 'fetch_price_to_win',
      message: `Consultando detalhes e preço para ganhar: ${processed}/${total}.`,
      processed,
      total,
      progress,
      extra: { event_type: 'catalog_refresh_batch_completed' },
    }));

    if (processed >= total) {
      return await finalizeRefresh({ jobId, sellerId, logs, total });
    }

    await service
      .from('jobs')
      .update({
        status: 'on_hold',
        progresso: progress,
        processados: processed,
        total,
        log: logs,
        finished_at: null,
      })
      .eq('id', jobId)
      .eq('tipo', JOB_TIPO);

    setTimeout(() => {
      void runCatalogRefreshJobBatch(jobId).catch((error) => {
        console.error('[catalog-refresh-job] Falha ao retomar próximo lote:', error);
      });
    }, 250);

    return { success: true, status: 'on_hold', processed, total };
  } catch (error) {
    return await markJobFailure(jobId, error);
  }
}
