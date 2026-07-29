export type RetryableMlLabelResult = {
  file: Buffer | null;
  retryable?: boolean;
  error?: string;
  reason?: string;
  statusCode?: number;
};

type RetryMlLabelDownloadOptions = {
  intervalMs: number;
  timeoutMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (context: {
    attempt: number;
    elapsedMs: number;
  }) => Promise<void> | void;
  onRetry?: (context: {
    attempt: number;
    elapsedMs: number;
    retryInMs: number;
    result: RetryableMlLabelResult;
  }) => Promise<void> | void;
};

export async function retryMlLabelDownload<
  T extends RetryableMlLabelResult,
>(
  download: () => Promise<T>,
  options: RetryMlLabelDownloadOptions,
): Promise<{
  result: T;
  attempts: number;
  elapsedMs: number;
  timedOut: boolean;
}> {
  const now = options.now || Date.now;
  const sleep =
    options.sleep ||
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    const elapsedMs = now() - startedAt;
    await options.onAttempt?.({ attempt: attempts, elapsedMs });

    const result = await download();
    const elapsedAfterDownload = now() - startedAt;
    if (result.file) {
      return {
        result,
        attempts,
        elapsedMs: elapsedAfterDownload,
        timedOut: false,
      };
    }

    const canRetry = Boolean(result.retryable);
    const wouldExceed =
      elapsedAfterDownload + options.intervalMs > options.timeoutMs;
    if (!canRetry || wouldExceed) {
      return {
        result,
        attempts,
        elapsedMs: elapsedAfterDownload,
        timedOut: canRetry && wouldExceed,
      };
    }

    await options.onRetry?.({
      attempt: attempts,
      elapsedMs: elapsedAfterDownload,
      retryInMs: options.intervalMs,
      result,
    });
    await sleep(options.intervalMs);
  }
}
