export const CRITICAL_JOB_TIMEOUT_GRACE_MS = 15 * 60 * 1000;

type CriticalJobRootLog = {
  event_type?: string | null;
  message?: string | null;
};

type CriticalJobAlertDecisionInput = {
  status?: string | null;
  occurrences: number;
  finishedAt?: string | null;
  recoveredAt?: string | null;
  rootLog?: CriticalJobRootLog | null;
  nowMs?: number;
  timeoutGraceMs?: number;
};

export type CriticalJobAlertDecision =
  | "alert"
  | "skip_transient"
  | "skip_recovered"
  | "defer_timeout";

function timestampMs(value?: string | null): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isJobTimeoutAbort(rootLog?: CriticalJobRootLog | null): boolean {
  const eventType = String(rootLog?.event_type || "").toLowerCase();
  const message = String(rootLog?.message || "").toLowerCase();
  return (
    eventType === "job_start_failed" &&
    (message.includes("operation was aborted") ||
      message.includes("aborterror") ||
      message.includes("tempo limite"))
  );
}

/**
 * Evita alertar falhas já recuperadas e dá tempo para jobs abortados pelo
 * controlador HTTP terminarem ou serem retomados antes de classificá-los
 * como críticos.
 */
export function decideCriticalJobAlert(
  input: CriticalJobAlertDecisionInput,
): CriticalJobAlertDecision {
  const finishedAtMs = timestampMs(input.finishedAt);
  const recoveredAtMs = timestampMs(input.recoveredAt);

  if (
    finishedAtMs !== null &&
    recoveredAtMs !== null &&
    recoveredAtMs > finishedAtMs
  ) {
    return "skip_recovered";
  }

  const authFailure = String(input.status || "") === "failed_auth";
  if (authFailure) return "alert";
  if (input.occurrences < 2) return "skip_transient";

  if (isJobTimeoutAbort(input.rootLog) && finishedAtMs !== null) {
    const nowMs = input.nowMs ?? Date.now();
    const graceMs = input.timeoutGraceMs ?? CRITICAL_JOB_TIMEOUT_GRACE_MS;
    if (nowMs - finishedAtMs < graceMs) return "defer_timeout";
  }

  return "alert";
}
