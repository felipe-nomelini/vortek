import type { JobStatus } from '@/lib/jobs/contract';

export type MlJobOutcome = Extract<
  JobStatus,
  'completo' | 'completo_parcial' | 'erro' | 'failed_auth' | 'on_hold'
>;

export function resolveMlJobOutcome(input: {
  domainLockConflict: boolean;
  requestSucceeded: boolean;
  authFailure: boolean;
  retryOnFailure: boolean;
  deferred?: boolean;
}): MlJobOutcome {
  if (input.authFailure) return 'failed_auth';
  if (input.deferred) return 'on_hold';
  if (input.domainLockConflict) return input.retryOnFailure ? 'on_hold' : 'completo';
  if (input.requestSucceeded) return 'completo';
  return input.retryOnFailure ? 'on_hold' : 'erro';
}
