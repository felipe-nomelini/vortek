import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { SaleHistoryEvent } from "@/api/sales";
import { LoadingScreen } from "@/components/loading-screen";
import { Screen } from "@/components/screen";
import { useSaleDetail, useSaleTracking } from "@/hooks/use-sales";
import { colors } from "@/theme/colors";

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function displayStatus(value: string | null) {
  if (!value) return "—";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text selectable style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function HistoryRow({ item }: { item: SaleHistoryEvent }) {
  const dotColor = item.level === "success"
    ? colors.success
    : item.level === "warning"
      ? colors.warning
      : item.level === "error"
        ? colors.danger
        : colors.primary;
  return (
    <View style={styles.historyRow}>
      <View style={[styles.historyDot, { backgroundColor: dotColor }]} />
      <View style={styles.historyContent}>
        <Text style={styles.historyLabel}>{item.label}</Text>
        {item.result ? <Text style={styles.historyResult}>{displayStatus(item.result)}</Text> : null}
        <Text style={styles.historyDate}>{dateTime(item.date)}</Text>
      </View>
    </View>
  );
}

export default function SaleDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] || "" : params.id || "";
  const detail = useSaleDetail(id);
  const detailSale = detail.data?.sale;
  const trackingEnabled = Boolean(detailSale?.shipmentId || detailSale?.hasClaim);
  const tracking = useSaleTracking(detailSale?.id || "", trackingEnabled);
  const [linkError, setLinkError] = useState(false);

  if (detail.isPending) return <LoadingScreen message="Carregando venda" />;

  if (!detail.data) {
    return (
      <Screen>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Não foi possível carregar a venda.</Text>
          <Pressable onPress={() => detail.refetch()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const { sale, history } = detail.data;

  async function openUrl(url: string) {
    setLinkError(false);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(true);
    }
  }

  async function refresh() {
    await Promise.all([
      detail.refetch(),
      ...(trackingEnabled ? [tracking.refetch()] : []),
    ]);
  }

  return (
    <Screen
      onRefresh={refresh}
      refreshing={detail.isRefetching || tracking.isRefetching}
    >
      <View style={styles.hero}>
        <View style={styles.rowBetween}>
          <Text style={styles.orderNumber}>#{sale.number}</Text>
          <Text style={styles.total}>{currency(sale.total)}</Text>
        </View>
        <Text style={styles.customer}>{sale.customer}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.status}>{displayStatus(sale.status)}</Text>
          <Text style={sale.profit != null && sale.profit >= 0 ? styles.profit : styles.loss}>
            {sale.profitPending
              ? "Lucro pendente"
              : sale.profit == null
                ? "Lucro —"
                : `Lucro ${currency(sale.profit)}`}
          </Text>
        </View>
        <Text style={styles.muted}>{dateTime(sale.date)}</Text>
      </View>

      {sale.urgentReasons.length ? (
        <View style={styles.urgentCard}>
          <Text style={styles.urgentTitle}>Precisa de atenção</Text>
          {sale.urgentReasons.map((reason) => (
            <Text key={reason} style={styles.urgentText}>• {reason}</Text>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Produtos</Text>
        {sale.items.map((item, index) => (
          <View key={`${item.mlItemId || item.sku || item.title}-${index}`} style={styles.item}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.muted}>
              SKU {item.sku || "—"} · Qtd. {item.quantity}
            </Text>
            {item.netTotal != null ? (
              <Text style={styles.itemValue}>{currency(item.netTotal)}</Text>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Entrega</Text>
        <Field label="Cliente" value={sale.customer} />
        <Field label="Documento" value={sale.customerDocument || "—"} />
        <Field
          label="Endereço"
          value={sale.deliveryAddress.length ? sale.deliveryAddress.join("\n") : "Ainda não sincronizado"}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {sale.internalShipping ? "Envio interno" : "Compra e fornecedor"}
        </Text>
        <Field label="Fornecedor" value={sale.supplierName || "Não definido"} />
        <Field label="Pedido DSLite" value={sale.dsliteIds.join(", ") || "Não criado"} />
        <Field label="Status DSLite" value={displayStatus(sale.dsliteStatus)} />
        <Field label="Próxima etapa" value={sale.dsliteNextActionLabel || "—"} />
        <Field
          label="Pagamento"
          value={sale.supplierPaymentAmount == null
            ? "—"
            : `${currency(sale.supplierPaymentAmount)} · ${displayStatus(sale.supplierPaymentStatus)}`}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Logística e fiscal</Text>
        <Field label="Pedido ML" value={sale.mlOrderIds.join(", ") || sale.number} />
        <Field label="Envio ML" value={sale.shipmentId || "—"} />
        <Field label="Rastreio" value={sale.tracking || "—"} />
        <Field label="NF-e" value={sale.invoiceNumbers.join(", ") || "Não emitida"} />
        <Field label="Status NF-e" value={displayStatus(sale.nfeStatus)} />
        {sale.splitFulfillment ? (
          <Text style={styles.warningText}>Fluxo dividido em múltiplos pedidos DSLite/NFs.</Text>
        ) : null}
        <Pressable onPress={() => openUrl(sale.mlSaleUrl)} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Abrir no Mercado Livre</Text>
        </Pressable>
        {linkError ? <Text style={styles.errorText}>Não foi possível abrir o link.</Text> : null}
      </View>

      {trackingEnabled ? (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Rastreio detalhado</Text>
            <Pressable onPress={() => tracking.refetch()}>
              <Text style={styles.refreshLink}>Atualizar</Text>
            </Pressable>
          </View>
          {tracking.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : tracking.data ? (
            <>
              <Field label="Situação atual" value={displayStatus(tracking.data.currentSubstatus || tracking.data.currentStatus)} />
              <Field label="Código" value={tracking.data.rastreio || sale.tracking || "—"} />
              <Field label="Transportadora" value={tracking.data.carrier?.name || "—"} />
              {tracking.data.carrier?.trackingUrl ? (
                <Pressable
                  onPress={() => openUrl(tracking.data!.carrier!.trackingUrl!)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Abrir rastreio da transportadora</Text>
                </Pressable>
              ) : null}
              {tracking.data.claim ? (
                <View style={styles.claimCard}>
                  <Text style={styles.claimTitle}>Reclamação / devolução</Text>
                  <Text style={styles.fieldValue}>{tracking.data.claim.reason}</Text>
                  <Text style={styles.muted}>
                    {displayStatus(tracking.data.claim.status)} · {displayStatus(tracking.data.claim.stage)}
                  </Text>
                </View>
              ) : null}
              {tracking.data.history.length ? (
                <View style={styles.trackingHistory}>
                  <Text style={styles.fieldLabel}>Caminho da entrega</Text>
                  {tracking.data.history.map((event, index) => (
                    <View key={`${event.date}-${event.status}-${index}`} style={styles.trackingEvent}>
                      <View style={styles.trackingDot} />
                      <View style={styles.historyContent}>
                        <Text style={styles.historyLabel}>{event.description || displayStatus(event.substatus || event.status)}</Text>
                        <Text style={styles.historyDate}>{dateTime(event.date)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {tracking.data.returnHistory.length ? (
                <View style={styles.trackingHistory}>
                  <Text style={styles.fieldLabel}>Caminho da devolução</Text>
                  {tracking.data.returnHistory.map((event, index) => (
                    <View key={`${event.shipmentId}-${event.date}-${index}`} style={styles.trackingEvent}>
                      <View style={[styles.trackingDot, { backgroundColor: colors.warning }]} />
                      <View style={styles.historyContent}>
                        <Text style={styles.historyLabel}>{event.description || displayStatus(event.substatus || event.status)}</Text>
                        <Text style={styles.historyDate}>{dateTime(event.date)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.trackingError}>
              <Text style={styles.errorText}>Não foi possível carregar o rastreio.</Text>
              <Pressable onPress={() => tracking.refetch()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Tentar novamente</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Histórico operacional</Text>
        {history.length ? history.map((item) => (
          <HistoryRow item={item} key={item.id} />
        )) : (
          <Text style={styles.muted}>Nenhum evento auditado nesta venda.</Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  orderNumber: { color: colors.primary, fontSize: 18, fontWeight: "800" },
  total: { color: colors.text, fontSize: 19, fontWeight: "800" },
  customer: { color: colors.text, fontSize: 16, fontWeight: "700" },
  status: {
    backgroundColor: "#172554",
    borderRadius: 5,
    color: "#93c5fd",
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  profit: { color: colors.success, fontWeight: "800" },
  loss: { color: colors.danger, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  urgentCard: {
    backgroundColor: "#2a1113",
    borderColor: colors.danger,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  urgentTitle: { color: colors.danger, fontSize: 15, fontWeight: "800" },
  urgentText: { color: "#ff9c9d", fontSize: 12 },
  item: { borderTopColor: colors.border, borderTopWidth: 1, gap: 4, paddingTop: 10 },
  itemTitle: { color: colors.text, lineHeight: 20 },
  itemValue: { color: colors.text, fontWeight: "700" },
  field: { gap: 3 },
  fieldLabel: { color: colors.textMuted, fontSize: 11 },
  fieldValue: { color: colors.text, lineHeight: 20 },
  warningText: { color: colors.warning, fontSize: 12 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 12,
  },
  primaryButtonText: { color: colors.text, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    padding: 11,
  },
  secondaryButtonText: { color: "#8fc2ff", fontWeight: "700" },
  refreshLink: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: 12, textAlign: "center" },
  trackingError: { gap: 10 },
  trackingHistory: { gap: 9 },
  trackingEvent: { flexDirection: "row", gap: 10 },
  trackingDot: {
    backgroundColor: colors.primary,
    borderRadius: 5,
    height: 10,
    marginTop: 5,
    width: 10,
  },
  claimCard: {
    backgroundColor: "#2a2111",
    borderColor: colors.warning,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  claimTitle: { color: colors.warning, fontWeight: "800" },
  historyRow: { flexDirection: "row", gap: 10 },
  historyDot: { borderRadius: 5, height: 10, marginTop: 5, width: 10 },
  historyContent: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flex: 1,
    gap: 3,
    paddingBottom: 10,
  },
  historyLabel: { color: colors.text, fontWeight: "700" },
  historyResult: { color: colors.textMuted, fontSize: 12 },
  historyDate: { color: colors.textMuted, fontSize: 11 },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  errorTitle: { color: colors.danger, fontSize: 17, fontWeight: "700" },
});
