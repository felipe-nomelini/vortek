export type MobileDsliteLabelFilter =
  | "real_sent"
  | "generic_sent"
  | "provider_shipping"
  | "sent_unverified"
  | "pending"
  | "failed"
  | "unknown";

export type MobileWhatsappLabelFilter =
  | "sent"
  | "test_sent"
  | "pending"
  | "on_hold"
  | "failed"
  | "not_applicable"
  | "not_sent"
  | "unknown";

export const MOBILE_DSLITE_LABEL_FILTERS = [
  "real_sent",
  "generic_sent",
  "provider_shipping",
  "sent_unverified",
  "pending",
  "failed",
  "unknown",
] as const satisfies readonly MobileDsliteLabelFilter[];

export const MOBILE_WHATSAPP_LABEL_FILTERS = [
  "sent",
  "test_sent",
  "pending",
  "on_hold",
  "failed",
  "not_applicable",
  "not_sent",
  "unknown",
] as const satisfies readonly MobileWhatsappLabelFilter[];

export type MobileSalesAdvancedFilters = {
  supplier?: string;
  dsliteLabel?: MobileDsliteLabelFilter;
  whatsappLabel?: MobileWhatsappLabelFilter;
};

function normalizedText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function hasMobileSalesAdvancedFilters(
  filters: MobileSalesAdvancedFilters,
): boolean {
  return Boolean(
    normalizedText(filters.supplier)
      || filters.dsliteLabel
      || filters.whatsappLabel,
  );
}

export function matchesMobileSalesAdvancedFilters(
  row: Record<string, unknown>,
  filters: MobileSalesAdvancedFilters,
): boolean {
  const supplier = normalizedText(filters.supplier);
  if (supplier && !normalizedText(row.fornecedor_nome).includes(supplier)) {
    return false;
  }
  if (
    filters.dsliteLabel
    && String(row.dslite_label_operational_status || "pending") !== filters.dsliteLabel
  ) {
    return false;
  }
  if (
    filters.whatsappLabel
    && String(row.whatsapp_label_status || "not_sent") !== filters.whatsappLabel
  ) {
    return false;
  }
  return true;
}

export function buildMobileSalesFilteredSummary(
  rows: any[],
  isUrgent: (row: any) => boolean = () => false,
) {
  const statusCounts: Record<string, number> = {};
  let total = 0;
  let profit = 0;
  let financialSales = 0;

  for (const row of rows) {
    const status = String(row?.situacao || "aberto").trim() || "aberto";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === "cancelado") continue;
    total += Number(row?.operational_total ?? row?.total ?? 0) || 0;
    profit += Number(row?.operational_lucro ?? row?.lucro ?? 0) || 0;
    financialSales += 1;
  }

  return {
    count: rows.length,
    total,
    lucroSum: profit,
    ticket: financialSales ? total / financialSales : 0,
    margem: total ? (profit / total) * 100 : 0,
    statusCounts,
    urgentCount: rows.filter(isUrgent).length,
  };
}
