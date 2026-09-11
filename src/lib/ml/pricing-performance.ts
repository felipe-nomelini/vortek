export const PRICING_PERFORMANCE_TIME_ZONE = 'America/Sao_Paulo';
export const PRICING_PERFORMANCE_WINDOWS = [30, 90, 150] as const;
export type PricingPerformanceWindowDays = (typeof PRICING_PERFORMANCE_WINDOWS)[number];

export type MlVisitPoint = {
  itemId: string;
  date: string;
  visits: number;
};

export type VisitCoverage = {
  itemId: string;
  complete: boolean;
  start: string | null;
  end: string | null;
};

export type PerformanceSale = {
  orderId: string;
  itemId: string;
  soldAt: string;
  quantity: number;
  revenueCents: number;
  buyerId: string | null;
};

export type PricingPerformanceWindow = {
  days: PricingPerformanceWindowDays;
  status: 'DISPONIVEL' | 'SEM_AMOSTRA';
  periodStart: string;
  periodEnd: string;
  timezone: typeof PRICING_PERFORMANCE_TIME_ZONE;
  visits: number | null;
  sales: number | null;
  units: number | null;
  revenueCents: number | null;
  uniqueBuyers: number | null;
  repeatBuyers: number | null;
  conversionRate: number | null;
  recurrenceRate: number | null;
  coverage: {
    visits: 'COMPLETA' | 'PARCIAL' | 'INDISPONIVEL';
    sales: 'COMPLETA' | 'PARCIAL' | 'INDISPONIVEL';
  };
};

function dateKey(value: unknown): string | null {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function saoPauloDateKey(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: PRICING_PERFORMANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function shiftDateKey(value: string, days: number): string {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('performance_date_invalid');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function offsetMinutesAt(dateKeyValue: string, timeZone: string): number {
  const reference = new Date(`${dateKeyValue}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(reference);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

export function zonedMidnightIso(dateKeyValue: string): string {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) throw new Error('performance_date_invalid');
  const localAsUtc = Date.UTC(year, month - 1, day);
  const offset = offsetMinutesAt(dateKeyValue, PRICING_PERFORMANCE_TIME_ZONE);
  return new Date(localAsUtc - offset * 60_000).toISOString();
}

export function performancePeriod(days: PricingPerformanceWindowDays, endDate: string) {
  const startDate = shiftDateKey(endDate, -days);
  return {
    startDate,
    endDate,
    periodStart: zonedMidnightIso(startDate),
    periodEnd: zonedMidnightIso(endDate),
  };
}

export function parseMlVisitWindow(input: {
  itemId: string;
  payload: unknown;
  expectedStart: string;
  expectedEnd: string;
}): { complete: boolean; start: string | null; end: string | null; points: MlVisitPoint[] } {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload as Record<string, any> : {};
  const start = dateKey(payload.date_from);
  const end = dateKey(payload.date_to);
  const expectedInclusiveEnd = shiftDateKey(input.expectedEnd, -1);
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const observed = new Map<string, number>();
  const total = Number(payload.total_visits);
  let valid = String(payload.item_id || '') === input.itemId
    && payload.unit === 'day'
    && Number(payload.last) === 149
    && Number.isSafeInteger(total)
    && total >= 0;

  for (const row of rows) {
    const day = dateKey(row?.date);
    const total = Number(row?.total);
    if (!day || day < input.expectedStart || day >= input.expectedEnd
      || !Number.isSafeInteger(total) || total < 0 || observed.has(day)) {
      valid = false;
      continue;
    }
    observed.set(day, total);
  }

  const envelopeComplete = start === input.expectedStart && end === expectedInclusiveEnd;
  const points: MlVisitPoint[] = [];
  for (let day = input.expectedStart; day < input.expectedEnd; day = shiftDateKey(day, 1)) {
    points.push({ itemId: input.itemId, date: day, visits: observed.get(day) ?? 0 });
  }
  const inEnvelopeTotal = points.reduce((sum, point) => sum + point.visits, 0);
  if (inEnvelopeTotal !== total) valid = false;

  return {
    complete: valid && envelopeComplete && points.length === 150,
    start,
    end,
    points,
  };
}

function coverageState(input: {
  itemIds: string[];
  coverages: VisitCoverage[];
  points: MlVisitPoint[];
  startDate: string;
  endDate: string;
}): PricingPerformanceWindow['coverage']['visits'] {
  if (!input.coverages.length) return 'INDISPONIVEL';
  const completeCoverage = input.itemIds.every((itemId) => input.coverages.some((coverage) => (
    coverage.itemId === itemId
    && coverage.complete
    && coverage.start !== null
    && coverage.end !== null
    && coverage.start <= input.startDate
    && coverage.end >= input.endDate
  )));
  if (!completeCoverage) return 'PARCIAL';
  const expected = (new Date(`${input.endDate}T00:00:00.000Z`).getTime()
    - new Date(`${input.startDate}T00:00:00.000Z`).getTime()) / 86_400_000 * input.itemIds.length;
  const unique = new Set(input.points
    .filter((point) => input.itemIds.includes(point.itemId) && point.date >= input.startDate && point.date < input.endDate)
    .map((point) => `${point.itemId}:${point.date}`));
  return unique.size === expected ? 'COMPLETA' : 'PARCIAL';
}

export function buildPricingPerformanceWindows(input: {
  endDate: string;
  itemIds: string[];
  visitPoints: MlVisitPoint[];
  visitCoverages: VisitCoverage[];
  sales: PerformanceSale[];
  salesCoverageStart: string | null;
  salesDataComplete?: boolean;
}): PricingPerformanceWindow[] {
  const itemIds = [...new Set(input.itemIds)];
  const allowedItems = new Set(itemIds);
  return PRICING_PERFORMANCE_WINDOWS.map((days) => {
    const period = performancePeriod(days, input.endDate);
    const visitsCoverage = coverageState({
      itemIds,
      coverages: input.visitCoverages,
      points: input.visitPoints,
      startDate: period.startDate,
      endDate: period.endDate,
    });
    const salesCoverage = !input.salesCoverageStart
      ? 'INDISPONIVEL'
      : input.salesDataComplete === false || input.salesCoverageStart > period.startDate
        ? 'PARCIAL'
        : 'COMPLETA';
    const available = visitsCoverage === 'COMPLETA' && salesCoverage === 'COMPLETA';
    const windowPoints = input.visitPoints.filter((point) => (
      allowedItems.has(point.itemId) && point.date >= period.startDate && point.date < period.endDate
    ));
    const windowSales = input.sales.filter((sale) => {
      const soldDate = dateKey(sale.soldAt);
      return allowedItems.has(sale.itemId)
        && soldDate !== null
        && soldDate >= period.startDate
        && soldDate < period.endDate;
    });
    const visits = windowPoints.reduce((sum, point) => sum + point.visits, 0);
    const orderIds = new Set(windowSales.map((sale) => sale.orderId));
    const buyerOrders = new Map<string, Set<string>>();
    const buyersComplete = windowSales.every((sale) => sale.buyerId !== null);
    for (const sale of windowSales) {
      if (!sale.buyerId) continue;
      const orders = buyerOrders.get(sale.buyerId) || new Set<string>();
      orders.add(sale.orderId);
      buyerOrders.set(sale.buyerId, orders);
    }
    const sales = orderIds.size;
    const uniqueBuyers = buyersComplete ? buyerOrders.size : null;
    const repeatBuyers = buyersComplete
      ? [...buyerOrders.values()].filter((orders) => orders.size >= 2).length
      : null;
    const units = windowSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const revenueCents = windowSales.reduce((sum, sale) => sum + sale.revenueCents, 0);

    return {
      days,
      status: available ? 'DISPONIVEL' : 'SEM_AMOSTRA',
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      timezone: PRICING_PERFORMANCE_TIME_ZONE,
      visits: available ? visits : null,
      sales: available ? sales : null,
      units: available ? units : null,
      revenueCents: available ? revenueCents : null,
      uniqueBuyers: available ? uniqueBuyers : null,
      repeatBuyers: available ? repeatBuyers : null,
      conversionRate: available && visits > 0 ? sales / visits : null,
      recurrenceRate: available && uniqueBuyers !== null && repeatBuyers !== null && uniqueBuyers > 0
        ? repeatBuyers / uniqueBuyers
        : null,
      coverage: { visits: visitsCoverage, sales: salesCoverage },
    };
  });
}
