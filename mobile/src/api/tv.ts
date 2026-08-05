import { z } from "zod";
import { apiGet } from "@/api/client";

const summarySchema = z.object({
  orders: z.number(),
  revenue: z.number(),
  profit: z.number(),
  averageTicket: z.number(),
  statusCounts: z.record(z.string(), z.number()),
});

const orderSchema = z.object({
  id: z.string(),
  number: z.union([z.string(), z.number()]),
  customer: z.string(),
  productName: z.string(),
  productCount: z.number(),
  total: z.number(),
  profit: z.number(),
  status: z.string(),
  date: z.string().nullable(),
  mlOrderId: z.union([z.string(), z.number()]).nullable(),
});

const trendsSchema = z.object({
  revenueVsYesterday: z.number(),
  ordersVsYesterday: z.number(),
  profitVsYesterday: z.number(),
});

export const tvLiveSchema = z.object({
  generatedAt: z.string(),
  refreshIntervalMs: z.number(),
  today: summarySchema,
  week: summarySchema,
  month: summarySchema,
  trends: trendsSchema,
  recentOrders: z.array(orderSchema),
});

const goalValuesSchema = z.object({
  day: z.number(),
  week: z.number(),
  month: z.number(),
});

export const tvMetricsSchema = z.object({
  generatedAt: z.string(),
  today: summarySchema,
  week: summarySchema,
  month: summarySchema,
  trends: trendsSchema,
  goals: z.object({
    profit: goalValuesSchema,
    orders: goalValuesSchema,
    revenue: goalValuesSchema,
    basis: z.object({
      fallback: z.boolean(),
      averageProfitPerOrder: z.number(),
      profitMargin: z.number(),
    }).passthrough(),
  }),
  operations: z.object({
    activeAds: z.number(),
    activeProducts: z.number(),
    openClaims: z.number(),
    actionQueueCount: z.number(),
  }),
  marketplace: z.object({
    totalVisits: z.number(),
    totalSold: z.number(),
    estimatedListingRevenue: z.number(),
  }),
  hourlySales: z.array(
    z.object({
      hour: z.number(),
      label: z.string(),
      revenue: z.number(),
      orders: z.number(),
    }),
  ),
  recentOrders: z.array(orderSchema),
  recentQuestions: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      anuncio: z.string(),
      pergunta: z.string(),
      date: z.string(),
      status: z.string(),
    }),
  ),
  ads: z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    activeCatalog: z.number(),
    winningCatalog: z.number(),
  }),
  projection: z.object({
    currentMonth: z.object({
      orders: z.number(),
      revenue: z.number(),
      profit: z.number(),
    }),
    nextMonth: z.object({
      orders: z.number(),
      revenue: z.number(),
      profit: z.number(),
    }),
  }).passthrough(),
}).passthrough();

export type TvLive = z.infer<typeof tvLiveSchema>;
export type TvMetrics = z.infer<typeof tvMetricsSchema>;

export async function getTvLive(): Promise<TvLive> {
  return tvLiveSchema.parse(
    await apiGet<unknown>("/api/mobile/v1/tv/live"),
  );
}

export async function getTvMetrics(): Promise<TvMetrics> {
  return tvMetricsSchema.parse(
    await apiGet<unknown>("/api/mobile/v1/tv/metrics"),
  );
}
