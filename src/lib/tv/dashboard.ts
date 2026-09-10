export const TV_LIVE_REFRESH_MS = 1_000;
export const TV_FULL_REFRESH_MS = 15_000;
export const TV_LIVE_DELAYED_AFTER_MS = 5_000;
export const TV_LIVE_OFFLINE_AFTER_MS = 30_000;

export type TvSummary = {
  orders: number;
  revenue: number;
  profit: number;
  averageTicket: number;
  statusCounts: Record<string, number>;
};

export type TvGoalValues = { day: number; week: number; month: number };

export type TvDynamicGoals = {
  profit: TvGoalValues;
  orders: TvGoalValues;
  revenue: TvGoalValues;
  basis: {
    windowDays: number;
    orders: number;
    revenue: number;
    profit: number;
    today: { orders: number; revenue: number; profit: number };
    averageProfitPerOrder: number;
    profitMargin: number;
    fallback: boolean;
  };
};

export type TvOrderSummary = {
  id: string;
  number: number;
  customer: string;
  productName: string;
  productCount: number;
  total: number;
  profit: number;
  status: string;
  date: string;
  mlOrderId: string | null;
};

export type TvQuestionSummary = {
  id: string;
  itemId: string;
  anuncio: string;
  pergunta: string;
  date: string;
  status: string;
};

export type TvMetrics = {
  generatedAt: string;
  today: TvSummary;
  week: TvSummary;
  month: TvSummary;
  trends: {
    revenueVsYesterday: number;
    ordersVsYesterday: number;
    profitVsYesterday: number;
  };
  hourlySales: Array<{
    hour: number;
    label: string;
    revenue: number;
    orders: number;
  }>;
  recentOrders: TvOrderSummary[];
  recentQuestions: TvQuestionSummary[];
  projection: {
    basis: {
      historicalDays: number;
      elapsedDays: number;
      remainingDays: number;
      daysInMonth: number;
      daysInNextMonth: number;
      dailyPace: { orders: number; revenue: number; profit: number };
    };
    currentMonth: { orders: number; revenue: number; profit: number };
    nextMonth: { orders: number; revenue: number; profit: number };
  };
  ads: {
    total: number;
    active: number;
    paused: number;
    activeCatalog: number;
    winningCatalog: number;
  };
  goals: TvDynamicGoals;
};

export type TvLiveMetrics = Pick<
  TvMetrics,
  "generatedAt" | "today" | "week" | "month" | "trends" | "recentOrders"
> & { refreshIntervalMs?: number };

export type TvConnectionState = "loading" | "live" | "delayed" | "offline";

export function tvConnectionState(
  lastSuccessAt: number | null,
  now: number,
): TvConnectionState {
  if (lastSuccessAt === null) return "loading";
  const age = Math.max(0, now - lastSuccessAt);
  if (age <= TV_LIVE_DELAYED_AFTER_MS) return "live";
  if (age <= TV_LIVE_OFFLINE_AFTER_MS) return "delayed";
  return "offline";
}

export function mergeTvLiveMetrics(
  current: TvMetrics | null,
  live: TvLiveMetrics,
): TvMetrics | null {
  if (!current) return null;
  return {
    ...current,
    generatedAt: live.generatedAt,
    today: live.today,
    week: live.week,
    month: live.month,
    trends: live.trends,
    recentOrders: live.recentOrders,
  };
}

export function dynamicTvGoals(
  goals: TvDynamicGoals | undefined,
  today: TvSummary,
): Pick<TvDynamicGoals, "orders" | "revenue" | "profit"> {
  if (!goals) {
    return {
      orders: { day: 10, week: 70, month: 300 },
      revenue: { day: 7_500, week: 52_500, month: 225_000 },
      profit: { day: 1_500, week: 10_500, month: 45_000 },
    };
  }

  const rollingOrders = Math.max(0, goals.basis.orders - goals.basis.today.orders) + today.orders;
  const rollingRevenue = Math.max(0, goals.basis.revenue - goals.basis.today.revenue) + today.revenue;
  const rollingProfit = Math.max(0, goals.basis.profit - goals.basis.today.profit) + today.profit;
  const averageProfitPerOrder = rollingOrders > 0 ? rollingProfit / rollingOrders : 0;
  const profitMargin = rollingRevenue > 0 ? rollingProfit / rollingRevenue : 0;

  if (averageProfitPerOrder <= 0 || profitMargin <= 0) return goals;

  const dailyOrders = Math.ceil(goals.profit.day / averageProfitPerOrder);
  const dailyRevenue = goals.profit.day / profitMargin;
  const daysInMonth = Math.max(1, Math.round(goals.profit.month / goals.profit.day));
  return {
    profit: goals.profit,
    orders: {
      day: dailyOrders,
      week: dailyOrders * 7,
      month: dailyOrders * daysInMonth,
    },
    revenue: {
      day: dailyRevenue,
      week: dailyRevenue * 7,
      month: dailyRevenue * daysInMonth,
    },
  };
}

export function tvTrendLabel(value: number): string {
  if (value > 0) return `+${value}% vs. ontem`;
  if (value < 0) return `${value}% vs. ontem`;
  return "igual a ontem";
}
