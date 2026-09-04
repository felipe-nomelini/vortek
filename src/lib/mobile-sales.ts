import {
  getOperationalUrgencyReasons,
  isPostDispatchOrder,
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
} from "@/lib/orders/operational-view";
import { canSelectOrderFulfillment } from "@/lib/orders/fulfillment-selection";

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function addressLines(value: unknown): string[] {
  const address = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return [
    [address.street_name, address.street_number].filter(Boolean).join(", "),
    nullableString(address.complement),
    nullableString(address.neighborhood),
    [address.city_name, address.state_id].filter(Boolean).join(" - "),
    nullableString(address.zip_code) ? `CEP ${nullableString(address.zip_code)}` : null,
  ].filter((line): line is string => Boolean(line));
}

export function mapMobileSalesOrder(row: any, delayedAfterMinutes: number) {
  const items = Array.isArray(row?.pedido_itens)
    ? row.pedido_itens.map((item: any) => ({
        title: nullableString(item?.titulo) || "Produto não informado",
        sku: nullableString(item?.seller_sku),
        quantity: Math.max(1, numberOrZero(item?.quantidade)),
        mlItemId: nullableString(item?.ml_item_id),
        unitPrice: item?.valor_unitario == null
          ? null
          : numberOrZero(item.valor_unitario),
        netTotal: item?.valor_total_liquido == null
          ? null
          : numberOrZero(item.valor_total_liquido),
      }))
    : [];
  const operationalDsliteIds = Array.isArray(row?.operational_dslite_ids)
    ? row.operational_dslite_ids
    : [row?.dslite_id];

  return {
    id: String(row?.id || row?.numero || ""),
    number: String(row?.numero || row?.ml_order_id || row?.id || ""),
    packId: nullableString(row?.ml_pack_id),
    date: nullableString(row?.data_venda || row?.data),
    customer:
      nullableString(row?.billing_nome || row?.contato_nome) || "Cliente ML",
    total: numberOrZero(row?.operational_total ?? row?.total),
    profit:
      row?.operational_lucro == null && row?.lucro == null
        ? null
        : numberOrZero(row?.operational_lucro ?? row?.lucro),
    profitPending: Boolean(row?.operational_profit_pending),
    status: nullableString(row?.situacao) || "aberto",
    items,
    supplierName: nullableString(row?.fornecedor_nome),
    dsliteIds: operationalDsliteIds
      .map((value: unknown) => nullableString(value))
      .filter((value: string | null): value is string => Boolean(value)),
    dsliteNextAction: nullableString(row?.dslite_next_action),
    dsliteNextActionLabel: nullableString(row?.dslite_next_action_label),
    dsliteLabelStatus:
      nullableString(row?.dslite_label_operational_status) || "pending",
    whatsappLabelStatus: nullableString(row?.whatsapp_label_status) || "not_sent",
    invoiceNumbers: Array.isArray(row?.operational_invoice_numbers)
      ? row.operational_invoice_numbers.map(String).filter(Boolean)
      : nullableString(row?.nota_fiscal_numero)
        ? [String(row.nota_fiscal_numero)]
        : [],
    tracking: nullableString(row?.rastreio),
    internalShipping: Boolean(row?.envio_interno_at),
    hasClaim: Boolean(row?.ml_claim_id),
    urgentReasons: getOperationalUrgencyReasons(row, delayedAfterMinutes),
  };
}

export function mapMobileSaleDetail(row: any, delayedAfterMinutes: number) {
  const sale = mapMobileSalesOrder(row, delayedAfterMinutes);
  const operationalOrderIds = Array.isArray(row?.operational_order_ids)
    ? row.operational_order_ids.map(String).filter(Boolean)
    : nullableString(row?.ml_order_id)
      ? [String(row.ml_order_id)]
      : [];
  const mlReference = sale.packId || operationalOrderIds[0] || sale.number;
  const postDispatch = isPostDispatchOrder(row);
  const singleDslitePurchase = sale.dsliteIds.length === 1
    && !Boolean(row?.has_split_fulfillment);
  const supplierPhoneAvailable = Boolean(
    String(row?.fornecedor_telefone || "").replace(/\D/g, ""),
  );
  const invalidOperationalStatus = ["cancelado", "entregue", "devolvido", "recusado"]
    .includes(sale.status);
  const hasDslite = sale.dsliteIds.length > 0;
  const internalStockAvailable = Boolean(row?.internal_stock_available);
  const fulfillmentSource = nullableString(row?.fulfillment_source);
  const nextAction = sale.dsliteNextAction;
  const hasInvoice = sale.invoiceNumbers.length > 0;

  return {
    ...sale,
    customerDocument: nullableString(row?.contato_documento || row?.billing_documento),
    deliveryAddress: addressLines(row?.billing_endereco),
    supplierPaymentAmount: row?.supplier_payment_amount == null
      ? null
      : numberOrZero(row.supplier_payment_amount),
    supplierPaymentStatus: nullableString(row?.supplier_payment_status),
    dsliteStatus: nullableString(row?.dslite_status),
    shipmentId: nullableString(row?.ml_shipment_id),
    mlOrderIds: operationalOrderIds,
    nfeStatus: nullableString(row?.nfe_status),
    fiscalReleaseAt: nullableString(row?.ml_fiscal_release_at),
    splitFulfillment: Boolean(row?.has_split_fulfillment),
    internalStockAvailable,
    fulfillmentSource,
    purchaseId: nullableString(row?.compra_id),
    supplierPixKey: nullableString(row?.supplier_pix_key),
    supplierPaymentReference: nullableString(row?.supplier_payment_reference),
    supplierPaymentNotes: nullableString(row?.supplier_payment_notes),
    hasSupplierPaymentReceipt: Boolean(row?.supplier_payment_receipt_path),
    canCreateDslite: Boolean(
      !sale.internalShipping
      && !postDispatch
      && !Boolean(row?.has_split_fulfillment)
      && !hasDslite
      && canSelectOrderFulfillment(fulfillmentSource, "supplier")
      && !invalidOperationalStatus
    ),
    canProcessInternalShipping: Boolean(
      !sale.internalShipping
      && !postDispatch
      && !Boolean(row?.has_split_fulfillment)
      && !hasDslite
      && canSelectOrderFulfillment(fulfillmentSource, "internal")
      && internalStockAvailable
      && row?.ml_shipment_id
      && !invalidOperationalStatus
    ),
    canCompleteDsliteLabel: Boolean(
      !sale.internalShipping
      && !postDispatch
      && !Boolean(row?.has_split_fulfillment)
      && hasDslite
      && nextAction === "complete_dslite_label"
    ),
    canConfirmSupplierPayment: Boolean(
      !sale.internalShipping
      && !postDispatch
      && !Boolean(row?.has_split_fulfillment)
      && hasDslite
      && row?.compra_id
      && ["confirm_supplier_payment", "send_supplier_receipt", "resume_dslite_flow"]
        .includes(nextAction || "")
    ),
    canUnlinkDslite: Boolean(
      hasDslite && /rejeitad|rejected/i.test(String(row?.dslite_status || ""))
    ),
    canOpenDanfe: hasInvoice,
    canDownloadXml: hasInvoice,
    canDownloadLabelPdf: Boolean(row?.ml_label_storage_path),
    canDownloadThermalPdf: Boolean(row?.ml_label_storage_path),
    canDownloadZpl: Boolean(row?.ml_thermal_label_storage_path),
    canSendWhatsappLabel: Boolean(
      !sale.internalShipping
      && !postDispatch
      && singleDslitePurchase
      && supplierPhoneAvailable
    ),
    canResumeDslite: Boolean(
      !sale.internalShipping
      && !postDispatch
      && singleDslitePurchase
      && row?.dslite_next_action === "resume_dslite_flow"
      && row?.supplier_payment_status === "paid"
      && row?.supplier_payment_receipt_path
      && row?.compra_id
    ),
    mlSaleUrl: `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(mlReference)}/detalhe`,
  };
}

const AUDIT_LABELS: Record<string, string> = {
  sync_snapshot_success: "Venda sincronizada",
  sync_order_snapshot_success: "Dados da venda atualizados",
  brasilnfe_invoice_ensure_success: "NF-e garantida",
  ml_invoice_upload_success: "NF-e vinculada ao Mercado Livre",
  ml_invoice_data_upload_success: "Dados fiscais enviados ao Mercado Livre",
  dslite_purchase_created_with_brasilnfe_xml: "Pedido DSLite criado",
  dslite_create_with_supplier_success: "Fornecedor informado na DSLite",
  dslite_create_without_supplier_fallback_success: "Pedido DSLite criado sem fornecedor",
  supplier_payment_confirmed_manual: "Pagamento do fornecedor confirmado",
  supplier_payment_whatsapp_sent: "Comprovante enviado ao fornecedor",
  placeholder_label_send_success: "Etiqueta genérica enviada à DSLite",
  ml_label_send_success: "Etiqueta real enviada à DSLite",
  ml_label_storage_success: "Etiqueta do Mercado Livre salva",
  whatsapp_label_send_requested: "Envio por WhatsApp solicitado",
  whatsapp_label_send_success: "Etiqueta enviada por WhatsApp",
  whatsapp_label_send_not_applicable: "WhatsApp não aplicável",
  estoque_interno_saida_estornada_cancelamento: "Estoque interno devolvido após cancelamento",
  estoque_interno_reserva_convertida_despacho: "Reserva de estoque convertida em despacho",
  nota_fiscal_cancelamento_success: "NF-e cancelada",
  ml_cancel_auto_detected: "Cancelamento detectado no Mercado Livre",
};

function auditLevel(event: string): "success" | "warning" | "error" | "info" {
  if (/(failed|timeout|blocked|rejeitado|rejected)/.test(event)) return "error";
  if (/(partial|pending|not_found|skipped)/.test(event)) return "warning";
  if (/(success|resolved|confirmed|sent)$/.test(event)) return "success";
  return "info";
}

function auditLabel(event: string): string {
  if (AUDIT_LABELS[event]) return AUDIT_LABELS[event];
  return event
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function mapMobileSaleHistoryEvent(row: any) {
  const event = nullableString(row?.evento) || "evento_operacional";
  return {
    id: String(row?.id || `${event}-${row?.created_at || ""}`),
    event,
    label: auditLabel(event),
    level: auditLevel(event),
    result: nullableString(row?.status_resultante),
    date: nullableString(row?.created_at),
  };
}

export const mapSaleHistoryEvent = mapMobileSaleHistoryEvent;

export function mapMobileSalesSummary(raw: any) {
  const statusCounts = raw?.statusCounts && typeof raw.statusCounts === "object"
    ? raw.statusCounts as Record<string, unknown>
    : {};
  const sumStatuses = (statuses: readonly string[]) => statuses.reduce(
    (total, status) => total + numberOrZero(statusCounts[status]),
    0,
  );

  return {
    counts: {
      urgent: numberOrZero(raw?.urgentCount),
      preparation: sumStatuses(PREPARATION_ORDER_STATUSES),
      shipping: sumStatuses(SHIPPING_ORDER_STATUSES),
      delivered: numberOrZero(statusCounts.entregue),
      all: numberOrZero(raw?.count),
    },
    financial: {
      total: numberOrZero(raw?.total),
      profit: numberOrZero(raw?.lucroSum),
      averageTicket: numberOrZero(raw?.ticket),
      margin: numberOrZero(raw?.margem),
    },
  };
}
