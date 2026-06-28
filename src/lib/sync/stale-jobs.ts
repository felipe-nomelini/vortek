import { createServiceClient } from '@/lib/supabase';
import { releaseDomainLock } from '@/lib/sync/domain-lock';
import { SYNC_TASKS } from '@/lib/sync/registry';
import type { Database } from '@/types/database';

type JobRow = Database['public']['Tables']['jobs']['Row'];

export const DEFAULT_STALE_JOB_THRESHOLD_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

function parseLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log === 'string') {
    try {
      return JSON.parse(log || '[]');
    } catch {
      return [];
    }
  }
  return [];
}

export function isJobStale(
  job: Pick<JobRow, 'created_at' | 'finished_at' | 'status'> | null | undefined,
  thresholdMinutes: number = DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
): boolean {
  if (!job?.created_at || job.finished_at) return false;
  if (!['pendente', 'rodando'].includes(String(job.status || ''))) return false;
  const ageMs = Date.now() - new Date(job.created_at).getTime();
  return ageMs > thresholdMinutes * 60 * 1000;
}

export async function markJobAsStale(job: Pick<JobRow, 'id' | 'tipo' | 'status' | 'created_at' | 'finished_at' | 'log'>) {
  const serviceClient = createServiceClient();
  const log = parseLog(job.log);
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
    age_minutes: Math.round((Date.now() - new Date(job.created_at).getTime()) / 60000),
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

  const task = SYNC_TASKS.find((entry) => entry.jobTipo === job.tipo);
  if (task?.domain) {
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
    } else {
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
