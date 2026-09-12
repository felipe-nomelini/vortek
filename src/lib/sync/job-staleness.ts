export type JobStalenessInput = {
  created_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
  log?: unknown;
};

export function parseJobLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
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

export function getJobLastActivityMs(
  job: Pick<JobStalenessInput, 'created_at' | 'finished_at' | 'log'>,
): number {
  const createdAtMs = job.created_at ? new Date(job.created_at).getTime() : 0;
  const finishedAtMs = job.finished_at ? new Date(job.finished_at).getTime() : 0;
  return parseJobLog(job.log).reduce((latest, entry) => {
    const raw = String(entry?.at || entry?.timestamp || '').trim();
    const parsed = raw ? new Date(raw).getTime() : Number.NaN;
    return Number.isFinite(parsed) && parsed > latest ? parsed : latest;
  }, Math.max(
    Number.isFinite(createdAtMs) ? createdAtMs : 0,
    Number.isFinite(finishedAtMs) ? finishedAtMs : 0,
  ));
}

export function isJobStale(
  job: JobStalenessInput | null | undefined,
  thresholdMinutes: number,
  at = Date.now(),
): boolean {
  if (!job?.created_at || job.finished_at) return false;
  if (!['pendente', 'rodando'].includes(String(job.status || ''))) return false;
  const latestActivityMs = getJobLastActivityMs(job);
  return latestActivityMs > 0
    && at - latestActivityMs > thresholdMinutes * 60 * 1000;
}
