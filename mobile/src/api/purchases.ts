import { z } from "zod";
import { apiGet, apiMultipart } from "@/api/client";

export const purchaseStatusSchema = z.enum([
  "Aguardando Informações",
  "Aguardando Pagamento Fornecedor",
  "Iniciado",
  "Aguardando Etiqueta",
  "Solicitado",
  "Confirmado",
  "Faturado",
  "Cancelado",
  "Revisão",
]);

export const purchaseSchema = z.object({
  id: z.string().uuid(),
  dsliteId: z.string(),
  saleNumber: z.string().nullable(),
  createdAt: z.string().nullable(),
  status: z.string(),
  dsliteStatus: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceKey: z.string().nullable(),
  total: z.number(),
  freight: z.number(),
  tracking: z.string().nullable(),
  supplierName: z.string().nullable(),
  supplierId: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientDocument: z.string().nullable(),
  productDescription: z.string().nullable(),
  productSku: z.string().nullable(),
  quantity: z.number(),
  paymentMode: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  paymentAmount: z.number().nullable(),
  paymentReference: z.string().nullable(),
  paymentNotes: z.string().nullable(),
  supplierPixKey: z.string().nullable(),
  hasPaymentReceipt: z.boolean(),
  paymentDeferred: z.boolean(),
  canConfirmPayment: z.boolean(),
});

const purchasesPageSchema = z.object({
  data: z.array(purchaseSchema),
  error: z.null(),
  meta: z.object({
    requestId: z.string(), page: z.number(), pageSize: z.number(), total: z.number(),
  }),
});

const summarySchema = z.object({
  data: z.object({
    total: z.number(), pending: z.number(), invoiced: z.number(),
    waitingInformation: z.number(), cancelled: z.number(), review: z.number(), totalValue: z.number(),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

const detailSchema = z.object({
  data: z.object({
    purchase: purchaseSchema.extend({
      saleStatus: z.string().nullable(),
      shipmentId: z.string().nullable(),
      saleUrl: z.string().url().nullable(),
      trackingUrl: z.string().url().nullable(),
    }),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string() }),
});

export type Purchase = z.infer<typeof purchaseSchema>;
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;
export type PurchaseSummary = z.infer<typeof summarySchema>["data"];
export type PurchaseDetail = z.infer<typeof detailSchema>["data"]["purchase"];
export type PurchaseFilters = {
  status?: PurchaseStatus;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "dsid" | "pedido_vendas_numero" | "data_criacao" | "destinatario_nome" | "produto_descricao" | "quantidade" | "valor_total" | "status" | "nf_numero";
  sortOrder?: "asc" | "desc";
};

function appendFilters(params: URLSearchParams, filters?: PurchaseFilters) {
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.sortBy) params.set("sortBy", filters.sortBy);
  if (filters?.sortOrder) params.set("sortOrder", filters.sortOrder);
}

export async function getPurchases(input: {
  page: number; pageSize?: number; search?: string; filters?: PurchaseFilters;
}) {
  const params = new URLSearchParams({
    page: String(input.page), pageSize: String(input.pageSize || 20),
  });
  if (input.search) params.set("search", input.search);
  appendFilters(params, input.filters);
  return purchasesPageSchema.parse(await apiGet<unknown>(`/api/mobile/v1/purchases?${params}`));
}

export async function getPurchasesSummary(search = "", filters?: PurchaseFilters): Promise<PurchaseSummary> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  appendFilters(params, filters);
  params.delete("sortBy");
  params.delete("sortOrder");
  const suffix = params.size ? `?${params}` : "";
  return summarySchema.parse(await apiGet<unknown>(`/api/mobile/v1/purchases/summary${suffix}`)).data;
}

export async function getPurchaseDetail(id: string): Promise<PurchaseDetail> {
  return detailSchema.parse(await apiGet<unknown>(`/api/mobile/v1/purchases/${encodeURIComponent(id)}`)).data.purchase;
}

export async function confirmPurchasePayment(input: {
  id: string;
  receipt?: { uri: string; name: string; mimeType: string };
  reference?: string;
  notes?: string;
}) {
  const form = new FormData();
  if (input.receipt) {
    form.append("receipt", {
      uri: input.receipt.uri, name: input.receipt.name, type: input.receipt.mimeType,
    } as unknown as Blob);
  }
  if (input.reference?.trim()) form.append("supplier_payment_reference", input.reference.trim());
  if (input.notes?.trim()) form.append("supplier_payment_notes", input.notes.trim());
  return apiMultipart<Record<string, unknown>>(
    `/api/compras/${encodeURIComponent(input.id)}/confirmar-pagamento`,
    form,
  );
}
