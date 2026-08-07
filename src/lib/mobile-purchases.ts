function stringOrNull(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapMobilePurchase(row: any) {
  const paymentMode = stringOrNull(row?.supplier_payment_mode);
  const paymentStatus = stringOrNull(row?.supplier_payment_status);
  const deferred = Boolean(row?.bkr1_pix_deferred);
  return {
    id: String(row?.id || ""),
    dsliteId: String(row?.dsid || ""),
    saleNumber: stringOrNull(row?.pedido_vendas_numero),
    createdAt: stringOrNull(row?.data_criacao),
    status: stringOrNull(row?.status) || "Iniciado",
    dsliteStatus: stringOrNull(row?.status_dslite),
    invoiceNumber: stringOrNull(row?.nf_numero),
    invoiceKey: stringOrNull(row?.nf_chave),
    total: numberOrZero(row?.valor_total),
    freight: numberOrZero(row?.valor_frete),
    tracking: stringOrNull(row?.rastreio),
    supplierName: stringOrNull(row?.fornecedor_nome),
    supplierId: stringOrNull(row?.fornecedor_id),
    recipientName: stringOrNull(row?.destinatario_nome),
    recipientDocument: stringOrNull(row?.destinatario_documento),
    productDescription: stringOrNull(row?.produto_descricao),
    productSku: stringOrNull(row?.produto_sku),
    quantity: Math.max(1, numberOrZero(row?.quantidade)),
    paymentMode,
    paymentStatus,
    paymentAmount: row?.supplier_payment_amount == null
      ? null
      : numberOrZero(row.supplier_payment_amount),
    paymentReference: stringOrNull(row?.supplier_payment_reference),
    paymentNotes: stringOrNull(row?.supplier_payment_notes),
    supplierPixKey: stringOrNull(row?.supplier_pix_key),
    hasPaymentReceipt: Boolean(
      row?.supplier_payment_receipt_path || row?.supplier_payment_receipt_url,
    ),
    paymentDeferred: deferred,
    canConfirmPayment: Boolean(
      paymentMode === "prepaid_pix"
      && paymentStatus !== "cancelled"
      && !deferred
    ),
  };
}

export function mapMobilePurchasesSummary(row: any) {
  return {
    total: numberOrZero(row?.total),
    pending: numberOrZero(row?.pendentes),
    invoiced: numberOrZero(row?.faturado),
    waitingInformation: numberOrZero(row?.aguardando_informacoes),
    cancelled: numberOrZero(row?.cancelado),
    review: numberOrZero(row?.revisao),
    totalValue: numberOrZero(row?.valor_total),
  };
}
