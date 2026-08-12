import { z } from "zod";
import { apiGet, apiMultipart, apiPost } from "@/api/client";

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
  internalStockAvailable: z.boolean(),
  fulfillmentSource: z.enum(["internal", "supplier"]).nullable().optional().default(null),
  purchaseId: z.string().nullable(),
  supplierPixKey: z.string().nullable(),
  supplierPaymentReference: z.string().nullable(),
  supplierPaymentNotes: z.string().nullable(),
  hasSupplierPaymentReceipt: z.boolean(),
  canCreateDslite: z.boolean(),
  canProcessInternalShipping: z.boolean(),
  canCompleteDsliteLabel: z.boolean(),
  canConfirmSupplierPayment: z.boolean(),
  canUnlinkDslite: z.boolean(),
  canOpenDanfe: z.boolean(),
  canDownloadXml: z.boolean(),
  canDownloadLabelPdf: z.boolean(),
  canDownloadThermalPdf: z.boolean(),
  canDownloadZpl: z.boolean(),
  canSendWhatsappLabel: z.boolean(),
  canResumeDslite: z.boolean(),
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

const saleActionStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["pending", "loading", "success", "error", "warning"]),
  detail: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.string().optional(),
});

const saleActionJobStateSchema = z.enum([
  "running",
  "success",
  "warning",
  "error",
  "on_hold",
]);

const saleActionStartResponseSchema = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    state: saleActionJobStateSchema,
    steps: z.array(saleActionStepSchema),
    deduplicated: z.boolean(),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

const saleActionJobResponseSchema = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    state: saleActionJobStateSchema,
    steps: z.array(saleActionStepSchema),
    result: z.unknown().nullable(),
    nextRetryAt: z.string().nullable(),
    retryAttempt: z.number(),
  }),
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
export type SaleActionKind = "whatsapp-label" | "resume-dslite" | "create-dslite";
export type SaleOperation =
  | { action: "complete_dslite_label"; duplicateAction?: "use_existing" | "reissue" }
  | { action: "process_internal_shipping"; duplicateAction?: "use_existing" | "reissue" }
  | { action: "select_dslite_shipping"; transportadoraId: string }
  | { action: "unlink_dslite" };
export type SaleActionJob = z.infer<typeof saleActionJobResponseSchema>["data"];
export type SaleActionStart = z.infer<typeof saleActionStartResponseSchema>["data"];
export type DsliteLabelFilter =
  | "real_sent"
  | "generic_sent"
  | "provider_shipping"
  | "sent_unverified"
  | "pending"
  | "failed"
  | "unknown";
export type WhatsappLabelFilter =
  | "sent"
  | "test_sent"
  | "pending"
  | "on_hold"
  | "failed"
  | "not_applicable"
  | "not_sent"
  | "unknown";
export type SalesFilters = {
  status?: SalesStatus;
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
  supplier?: string;
  dsliteLabel?: DsliteLabelFilter;
  whatsappLabel?: WhatsappLabelFilter;
  sortBy?: "numero" | "data" | "cliente" | "total" | "situacao" | "nota_fiscal_numero" | "pedido_compra" | "lucro";
  sortOrder?: "asc" | "desc";
};

function appendSalesFilters(params: URLSearchParams, filters?: SalesFilters) {
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.priceMin != null) params.set("priceMin", String(filters.priceMin));
  if (filters?.priceMax != null) params.set("priceMax", String(filters.priceMax));
  if (filters?.supplier) params.set("supplier", filters.supplier);
  if (filters?.dsliteLabel) params.set("dsliteLabel", filters.dsliteLabel);
  if (filters?.whatsappLabel) params.set("whatsappLabel", filters.whatsappLabel);
  if (filters?.sortBy) params.set("sortBy", filters.sortBy);
  if (filters?.sortOrder) params.set("sortOrder", filters.sortOrder);
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

export function createMobileIdempotencyKey(action: SaleActionKind, saleId: string) {
  const random = Math.random().toString(36).slice(2, 12);
  return `mobile:${action}:${saleId}:${Date.now()}:${random}`.slice(0, 120);
}

export async function startSaleAction(
  id: string,
  action: SaleActionKind,
  idempotencyKey: string,
): Promise<SaleActionStart> {
  const response = saleActionStartResponseSchema.parse(
    await apiPost<unknown>(
      `/api/mobile/v1/sales/${encodeURIComponent(id)}/${action}`,
      { body: {}, idempotencyKey },
    ),
  );
  return response.data;
}

export async function getSaleActionJob(
  id: string,
  action: SaleActionKind,
  jobId: string,
): Promise<SaleActionJob> {
  const response = saleActionJobResponseSchema.parse(
    await apiGet<unknown>(
      `/api/mobile/v1/sales/${encodeURIComponent(id)}/${action}?jobId=${encodeURIComponent(jobId)}`,
    ),
  );
  return response.data;
}

export async function runSaleOperation(id: string, operation: SaleOperation) {
  const response = await apiPost<{ data: unknown; error: null }>(
    `/api/mobile/v1/sales/${encodeURIComponent(id)}/operation`,
    {
      body: operation,
      idempotencyKey: createMobileIdempotencyKey(operation.action as SaleActionKind, id),
    },
  );
  return response.data;
}

export async function confirmSupplierPayment(input: {
  id: string;
  receipt?: { uri: string; name: string; mimeType: string };
  reference?: string;
  notes?: string;
  resumeOnly?: boolean;
}) {
  const form = new FormData();
  if (input.receipt) {
    form.append("receipt", {
      uri: input.receipt.uri,
      name: input.receipt.name,
      type: input.receipt.mimeType,
    } as unknown as Blob);
  }
  if (input.reference?.trim()) form.append("supplier_payment_reference", input.reference.trim());
  if (input.notes?.trim()) form.append("supplier_payment_notes", input.notes.trim());
  if (input.resumeOnly) form.append("resume_only", "true");
  form.append("idempotency_key", createMobileIdempotencyKey("resume-dslite", input.id));
  const response = await apiMultipart<{ data: Record<string, unknown>; error: null }>(
    `/api/mobile/v1/sales/${encodeURIComponent(input.id)}/supplier-payment`,
    form,
  );
  return response.data;
}

export async function getSaleDocumentUrl(id: string, kind: "danfe" | "label-pdf" | "label-zpl") {
  const path = kind === "danfe"
    ? `/api/notas-fiscais/${encodeURIComponent(id)}/pdf`
    : `/api/pedidos/${encodeURIComponent(id)}/etiqueta${kind === "label-zpl" ? "?format=zpl2" : ""}`;
  const response = await apiGet<{ url: string }>(path);
  return response.url;
}
