import { z } from "zod";
import { apiGet } from "@/api/client";

export const salesViewSchema = z.enum([
  "urgent",
  "preparation",
  "shipping",
  "delivered",
  "all",
]);

export const salesStatusSchema = z.enum([
  "aberto",
  "pendente",
  "preparando",
  "pronto_envio",
  "etiqueta_impressa",
  "faturado",
  "coletado",
  "em_transito",
  "saiu_entrega",
  "dest_ausente",
  "atendido",
  "entregue",
  "recusado",
  "devolvido",
  "cancelado",
]);

const salesItemSchema = z.object({
  title: z.string(),
  sku: z.string().nullable(),
  quantity: z.number(),
  mlItemId: z.string().nullable(),
  unitPrice: z.number().nullable(),
  netTotal: z.number().nullable(),
});

export const saleSchema = z.object({
  id: z.string(),
  number: z.string(),
  packId: z.string().nullable(),
  date: z.string().nullable(),
  customer: z.string(),
  total: z.number(),
  profit: z.number().nullable(),
  profitPending: z.boolean(),
  status: z.string(),
  items: z.array(salesItemSchema),
  supplierName: z.string().nullable(),
  dsliteIds: z.array(z.string()),
  dsliteNextAction: z.string().nullable(),
  dsliteNextActionLabel: z.string().nullable(),
  dsliteLabelStatus: z.string(),
  whatsappLabelStatus: z.string(),
  invoiceNumbers: z.array(z.string()),
  tracking: z.string().nullable(),
  internalShipping: z.boolean(),
  hasClaim: z.boolean(),
  urgentReasons: z.array(z.string()),
});

const salesResponseSchema = z.object({
  data: z.array(saleSchema),
  error: z.null(),
  meta: z.object({
    requestId: z.string(),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
});

const salesSummaryResponseSchema = z.object({
  data: z.object({
    counts: z.object({
      urgent: z.number(),
      preparation: z.number(),
      shipping: z.number(),
      delivered: z.number(),
      all: z.number(),
    }),
    financial: z.object({
      total: z.number(),
      profit: z.number(),
      averageTicket: z.number(),
      margin: z.number(),
    }),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

const saleHistoryEventSchema = z.object({
  id: z.string(),
  event: z.string(),
  label: z.string(),
  level: z.enum(["success", "warning", "error", "info"]),
  result: z.string().nullable(),
  date: z.string().nullable(),
});

export const saleDetailSchema = saleSchema.extend({
  customerDocument: z.string().nullable(),
  deliveryAddress: z.array(z.string()),
  supplierPaymentAmount: z.number().nullable(),
  supplierPaymentStatus: z.string().nullable(),
  dsliteStatus: z.string().nullable(),
  shipmentId: z.string().nullable(),
  mlOrderIds: z.array(z.string()),
  nfeStatus: z.string().nullable(),
  fiscalReleaseAt: z.string().nullable(),
  splitFulfillment: z.boolean(),
  mlSaleUrl: z.string().url(),
});

const saleDetailResponseSchema = z.object({
  data: z.object({
    sale: saleDetailSchema,
    history: z.array(saleHistoryEventSchema),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

const trackingEventSchema = z.object({
  status: z.string(),
  substatus: z.string(),
  date: z.string(),
  description: z.string(),
});

export const saleTrackingSchema = z.object({
  currentStatus: z.string(),
  currentSubstatus: z.string().nullable(),
  carrier: z.object({
    name: z.string(),
    trackingUrl: z.string().url().nullable(),
  }).nullable(),
  history: z.array(trackingEventSchema),
  returnHistory: z.array(trackingEventSchema.extend({ shipmentId: z.string() })),
  returnShipments: z.array(z.object({
    shipmentId: z.string(),
    status: z.string(),
    trackingNumber: z.string().nullable(),
    type: z.string(),
    destination: z.string(),
  })),
  claim: z.object({
    id: z.string(),
    status: z.string(),
    type: z.string(),
    stage: z.string(),
    reason: z.string(),
  }).nullable(),
  rastreio: z.string().nullable(),
});

const saleTrackingResponseSchema = z.object({
  data: saleTrackingSchema,
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

export type Sale = z.infer<typeof saleSchema>;
export type SalesView = z.infer<typeof salesViewSchema>;
export type SalesStatus = z.infer<typeof salesStatusSchema>;
export type SalesPage = z.infer<typeof salesResponseSchema>;
export type SalesSummary = z.infer<typeof salesSummaryResponseSchema>["data"];
export type SaleDetail = z.infer<typeof saleDetailSchema>;
export type SaleHistoryEvent = z.infer<typeof saleHistoryEventSchema>;
export type SaleTracking = z.infer<typeof saleTrackingSchema>;
export type SalesFilters = {
  status?: SalesStatus;
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
};

function appendSalesFilters(params: URLSearchParams, filters?: SalesFilters) {
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.priceMin != null) params.set("priceMin", String(filters.priceMin));
  if (filters?.priceMax != null) params.set("priceMax", String(filters.priceMax));
}

export async function getSales(input: {
  view: SalesView;
  page: number;
  pageSize?: number;
  search?: string;
  filters?: SalesFilters;
}): Promise<SalesPage> {
  const params = new URLSearchParams({
    view: input.view,
    page: String(input.page),
    pageSize: String(input.pageSize || 20),
  });
  if (input.search) params.set("search", input.search);
  appendSalesFilters(params, input.filters);

  return salesResponseSchema.parse(
    await apiGet<unknown>(`/api/mobile/v1/sales?${params.toString()}`),
  );
}

export async function getSalesSummary(
  search = "",
  filters?: SalesFilters,
): Promise<SalesSummary> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  appendSalesFilters(params, filters);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = salesSummaryResponseSchema.parse(
    await apiGet<unknown>(`/api/mobile/v1/sales/summary${suffix}`),
  );
  return response.data;
}

export async function getSaleDetail(id: string): Promise<{
  sale: SaleDetail;
  history: SaleHistoryEvent[];
}> {
  const response = saleDetailResponseSchema.parse(
    await apiGet<unknown>(`/api/mobile/v1/sales/${encodeURIComponent(id)}`),
  );
  return response.data;
}

export async function getSaleTracking(id: string): Promise<SaleTracking> {
  const response = saleTrackingResponseSchema.parse(
    await apiGet<unknown>(`/api/mobile/v1/sales/${encodeURIComponent(id)}/tracking`),
  );
  return response.data;
}
