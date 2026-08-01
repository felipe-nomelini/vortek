import { createServiceClient } from '@/lib/supabase';
import { releaseDomainLock } from '@/lib/sync/domain-lock';
import {
  getJobLastActivityMs,
  isJobStale as isJobStaleByActivity,
  parseJobLog,
} from '@/lib/sync/job-staleness';
import { SYNC_TASKS } from '@/lib/sync/registry';
import type { Database } from '@/types/database';

type JobRow = Database['public']['Tables']['jobs']['Row'];

export const DEFAULT_STALE_JOB_THRESHOLD_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

export function isJobStale(
  job: (
    Pick<JobRow, 'created_at' | 'finished_at' | 'status'>
    & Partial<Pick<JobRow, 'log'>>
  ) | null | undefined,
  thresholdMinutes: number = DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
): boolean {
  return isJobStaleByActivity(job, thresholdMinutes);
}

async function releaseLockOwnedByJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<{ released: boolean; reason: string | null }> {
  const { data: ownedLock, error } = await (serviceClient as any)
    .from('sync_domain_locks')
    .select('domain,owner_token')
    .eq('owner_job_id', jobId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao consultar lock do job ${jobId}: ${error.message}`);
  }
  if (!ownedLock?.domain || !ownedLock?.owner_token) {
    return { released: false, reason: 'owned_lock_not_found' };
  }

  const released = await releaseDomainLock({
    domain: String(ownedLock.domain),
    ownerToken: String(ownedLock.owner_token),
  });
  return { released, reason: released ? null : 'owned_lock_release_failed' };
}

export async function requeueStaleJob(
  job: Pick<JobRow, 'id' | 'tipo' | 'status' | 'created_at' | 'finished_at' | 'log'>,
  thresholdMinutes: number,
) {
  const serviceClient = createServiceClient();
  const log = parseJobLog(job.log);
  const requeuedAt = nowIso();

  log.push({
    event_type: 'job_requeued_stale',
    type: 'warning',
    message: 'Job interrompido recuperado e devolvido para fila',
    timestamp: requeuedAt,
    stale_threshold_minutes: thresholdMinutes,
    previous_status: job.status,
  });

  const { data: requeued, error } = await serviceClient
    .from('jobs')
    .update({
      status: 'on_hold',
      finished_at: null,
      progresso: 0,
      processados: 0,
      log,
    } as any)
    .eq('id', job.id)
    .eq('status', 'rodando')
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao devolver job stale para fila (${job.id}): ${error.message}`);
  }
  if (!requeued?.id) {
    return {
      id: job.id,
      tipo: job.tipo,
      requeued_at: null,
      domain_lock_released: false,
      domain_lock_release_skipped: 'job_no_longer_running',
    };
  }

  const lock = await releaseLockOwnedByJob(serviceClient, job.id);
  return {
    id: job.id,
    tipo: job.tipo,
    requeued_at: requeuedAt,
    domain_lock_released: lock.released,
    domain_lock_release_skipped: lock.reason,
  };
}

export async function markJobAsStale(job: Pick<JobRow, 'id' | 'tipo' | 'status' | 'created_at' | 'finished_at' | 'log'>) {
  const serviceClient = createServiceClient();
  const log = parseJobLog(job.log);
  const latestActivityMs = getJobLastActivityMs(job);
  const finishedAt = nowIso();
  let domainLockReleased = false;
  let domainLockReleaseSkipped: string | null = null;

  log.push({
    event_type: 'job_marked_stale',
    type: 'error',
    message: 'Job marcado como stale e encerrado automaticamente',
    timestamp: finishedAt,
    stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
    previous_status: job.status,
    created_at: job.created_at,
    last_activity_at: latestActivityMs ? new Date(latestActivityMs).toISOString() : null,
    age_minutes: latestActivityMs
      ? Math.round((Date.now() - latestActivityMs) / 60000)
      : null,
  });

  const { error } = await serviceClient
    .from('jobs')
    .update({
      status: 'erro',
      finished_at: finishedAt,
      progresso: 100,
      log,
    } as any)
    .eq('id', job.id)
    .in('status', ['pendente', 'rodando']);

  if (error) {
    throw new Error(`Falha ao marcar job stale (${job.id}): ${error.message}`);
  }

  const ownedLock = await releaseLockOwnedByJob(serviceClient, job.id);
  domainLockReleased = ownedLock.released;
  domainLockReleaseSkipped = ownedLock.reason;

  const task = SYNC_TASKS.find((entry) => entry.jobTipo === job.tipo);
  if (!domainLockReleased && task?.domain) {
    const createdAt = job.created_at ? new Date(job.created_at).getTime() : 0;
    const { data: lock } = await (serviceClient as any)
      .from('sync_domain_locks')
      .select('domain, owner_task, owner_token, acquired_at')
      .eq('domain', task.domain)
      .maybeSingle();

    const acquiredAt = lock?.acquired_at ? new Date(lock.acquired_at).getTime() : 0;
    const acquiredNearJobStart = Boolean(
      createdAt
      && acquiredAt
      && Math.abs(acquiredAt - createdAt) <= 5 * 60 * 1000,
    );

    if (lock?.owner_task === job.tipo && acquiredNearJobStart) {
      domainLockReleased = await releaseDomainLock({
        domain: task.domain,
        ownerToken: String(lock.owner_token || ''),
        force: true,
      });
    } else if (lock) {
      domainLockReleaseSkipped = 'lock_not_owned_by_stale_job';
    } else if (domainLockReleaseSkipped === 'owned_lock_not_found') {
      domainLockReleaseSkipped = 'lock_not_found';
    }
  }

  return {
    id: job.id,
    tipo: job.tipo,
    previous_status: job.status,
    finished_at: finishedAt,
    domain_lock_released: domainLockReleased,
    domain_lock_release_skipped: domainLockReleaseSkipped,
  };
}
