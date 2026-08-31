export const JOB_STATUSES = [
  'pendente',
  'rodando',
  'on_hold',
  'completo',
  'completo_parcial',
  'erro',
  'failed_auth',
  'cancelado',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTIVE_JOB_STATUSES = ['pendente', 'rodando', 'on_hold'] as const satisfies readonly JobStatus[];
export const SUCCESS_JOB_STATUSES = ['completo', 'completo_parcial'] as const satisfies readonly JobStatus[];
export const FAILURE_JOB_STATUSES = ['erro', 'failed_auth'] as const satisfies readonly JobStatus[];
export const TERMINAL_JOB_STATUSES = [
  ...SUCCESS_JOB_STATUSES,
  ...FAILURE_JOB_STATUSES,
  'cancelado',
] as const satisfies readonly JobStatus[];

export const JOB_PROGRESS_UNITS = ['execucao', 'itens', 'etapas'] as const;

export type JobProgressUnit = (typeof JOB_PROGRESS_UNITS)[number];

export function isActiveJobStatus(value: unknown): value is (typeof ACTIVE_JOB_STATUSES)[number] {
  return ACTIVE_JOB_STATUSES.includes(value as (typeof ACTIVE_JOB_STATUSES)[number]);
}

export function isTerminalJobStatus(value: unknown): value is (typeof TERMINAL_JOB_STATUSES)[number] {
  return TERMINAL_JOB_STATUSES.includes(value as (typeof TERMINAL_JOB_STATUSES)[number]);
}
