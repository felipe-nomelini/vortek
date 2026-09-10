export const PRODUCTION_SCHEDULER_CENTRAL_INTERVAL_MS = 60_000;
export const PRODUCTION_SCHEDULER_PUBLISH_INTERVAL_MS = 15_000;

type SchedulerEnvironment = Record<string, string | undefined>;

declare global {
  var __benteviProductionSchedulerStarted: boolean | undefined;
}

export function shouldStartProductionScheduler(environment: SchedulerEnvironment): boolean {
  return environment.NEXT_PHASE !== 'phase-production-build'
    && environment.VORTEK_RUNTIME_ENVIRONMENT === 'production'
    && environment.NODE_ENV === 'production';
}

function loopbackOrigin(environment: SchedulerEnvironment): string {
  const port = Number.parseInt(String(environment.PORT || '3000'), 10);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3000}`;
}

function installTimer(input: {
  name: string;
  path: string;
  body?: Record<string, unknown>;
  initialDelayMs: number;
  intervalMs: number;
  timeoutMs: number;
  origin: string;
  apiKey: string;
}) {
  let inFlight = false;

  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(new URL(input.path, input.origin), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': input.apiKey,
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      if (!response.ok) {
        console.error(`[production-scheduler] ${input.name} respondeu HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(
        `[production-scheduler] ${input.name} falhou:`,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      inFlight = false;
    }
  };

  const initial = setTimeout(() => void run(), input.initialDelayMs);
  const recurring = setInterval(() => void run(), input.intervalMs);
  initial.unref();
  recurring.unref();
}

export function startProductionScheduler(environment: SchedulerEnvironment = process.env): boolean {
  if (!shouldStartProductionScheduler(environment)) return false;
  if (global.__benteviProductionSchedulerStarted) return false;

  const apiKey = String(environment.API_SECRET_KEY || '').trim();
  if (!apiKey) {
    console.error('[production-scheduler] API_SECRET_KEY ausente; agendador não iniciado.');
    return false;
  }

  global.__benteviProductionSchedulerStarted = true;
  const origin = loopbackOrigin(environment);

  installTimer({
    name: 'central-dispatch',
    path: '/api/sync/cron-dispatch',
    initialDelayMs: 15_000,
    intervalMs: PRODUCTION_SCHEDULER_CENTRAL_INTERVAL_MS,
    timeoutMs: 180_000,
    origin,
    apiKey,
  });
  installTimer({
    name: 'ml-stock-status-publish',
    path: '/api/sync/run',
    body: { taskKey: 'sync_ml_listings_publish', limit: 20 },
    initialDelayMs: 5_000,
    intervalMs: PRODUCTION_SCHEDULER_PUBLISH_INTERVAL_MS,
    timeoutMs: 12_000,
    origin,
    apiKey,
  });

  console.warn('[production-scheduler] Agendadores produtivos iniciados no runtime Bentevi.');
  return true;
}
