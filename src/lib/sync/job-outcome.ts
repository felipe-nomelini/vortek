export type MlJobOutcome = 'completo' | 'erro' | 'failed_auth' | 'on_hold';

export function resolveMlJobOutcome(input: {
  domainLockConflict: boolean;
  requestSucceeded: boolean;
  authFailure: boolean;
  retryOnFailure: boolean;
}): MlJobOutcome {
  if (input.authFailure) return 'failed_auth';
  if (input.domainLockConflict) return input.retryOnFailure ? 'on_hold' : 'completo';
  if (input.requestSucceeded) return 'completo';
  return input.retryOnFailure ? 'on_hold' : 'erro';
}
