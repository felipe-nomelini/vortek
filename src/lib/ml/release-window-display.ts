function isUtcMidnight(value: string): boolean {
  const dt = new Date(value);
  return !Number.isNaN(dt.getTime())
    && dt.getUTCHours() === 0
    && dt.getUTCMinutes() === 0
    && dt.getUTCSeconds() === 0
    && dt.getUTCMilliseconds() === 0;
}

function saoPauloMidnightFromUtcDate(value: string): Date | null {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 3, 0, 0, 0));
}

export function getMlReleaseComparableDate(value: string): Date | null {
  if (!value) return null;
  if (isUtcMidnight(value)) return saoPauloMidnightFromUtcDate(value);
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatMlReleaseWindow(value: string): { when: string; remaining: string | null } {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return { when: 'data inválida', remaining: null };

  const when = isUtcMidnight(value)
    ? `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    : dt.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace(',', '');

  const comparable = getMlReleaseComparableDate(value);
  const ms = comparable ? comparable.getTime() - Date.now() : 0;
  if (ms <= 0) return { when, remaining: null };
  const totalHours = Math.floor(ms / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { when, remaining: days > 0 ? `faltam ${days}d ${hours}h` : `faltam ${hours}h` };
}

