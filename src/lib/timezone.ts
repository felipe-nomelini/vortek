const SAO_PAULO_OFFSET_MINUTES = -180;
const SAO_PAULO_OFFSET_MS = SAO_PAULO_OFFSET_MINUTES * 60 * 1000;

export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/** Formata um instante para exibição operacional no horário de Brasília. */
export function formatSaoPauloDateTime(dateInput: string | Date): string | null {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BUSINESS_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function parseDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function utcFromSaoPauloLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
      SAO_PAULO_OFFSET_MS,
  );
}

export function saoPauloDayBounds(date: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const saoPauloInstant = new Date(date.getTime() + SAO_PAULO_OFFSET_MS);
  const year = saoPauloInstant.getUTCFullYear();
  const month = saoPauloInstant.getUTCMonth() + 1;
  const day = saoPauloInstant.getUTCDate();

  return {
    start: utcFromSaoPauloLocal(year, month, day, 0, 0, 0, 0),
    end: utcFromSaoPauloLocal(year, month, day, 23, 59, 59, 999),
  };
}

export function saoPauloDateParamToUtcIso(
  date: string,
  boundary: 'start' | 'end',
): string | null {
  const parts = parseDateParts(date);
  if (!parts) return null;
  const value =
    boundary === 'start'
      ? utcFromSaoPauloLocal(parts.year, parts.month, parts.day, 0, 0, 0, 0)
      : utcFromSaoPauloLocal(
          parts.year,
          parts.month,
          parts.day,
          23,
          59,
          59,
          999,
        );
  return value.toISOString();
}

export function saoPauloHour(dateInput: string | Date): number | null {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;
  const saoPauloInstant = new Date(date.getTime() + SAO_PAULO_OFFSET_MS);
  return saoPauloInstant.getUTCHours();
}

export function saoPauloDayLabel(dateInput: string | Date): string | null {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;
  const saoPauloInstant = new Date(date.getTime() + SAO_PAULO_OFFSET_MS);
  const day = String(saoPauloInstant.getUTCDate()).padStart(2, '0');
  const month = String(saoPauloInstant.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}
