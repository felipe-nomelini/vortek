import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type Href, useRouter } from "expo-router";
import {
  purchaseStatusSchema,
  type Purchase,
  type PurchaseFilters,
  type PurchaseStatus,
} from "@/api/purchases";
import { LoadingScreen } from "@/components/loading-screen";
import { usePurchases, usePurchasesSummary } from "@/hooks/use-purchases";
import { colors } from "@/theme/colors";

type Period = "all" | "today" | "7d" | "30d";
const STATUSES = purchaseStatusSchema.options;
const SORTS: Array<{ key: NonNullable<PurchaseFilters["sortBy"]>; label: string }> = [
  { key: "data_criacao", label: "Data" }, { key: "dsid", label: "DSLite" },
  { key: "pedido_vendas_numero", label: "Venda" }, { key: "destinatario_nome", label: "Destinatário" },
  { key: "produto_descricao", label: "Produto" }, { key: "quantidade", label: "Quantidade" },
  { key: "valor_total", label: "Total" }, { key: "status", label: "Status" },
  { key: "nf_numero", label: "NF" },
];

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function localDate(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function periodRange(period: Period) {
  if (period === "all") return {};
  const now = new Date();
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return { dateFrom: localDate(new Date(now.getTime() - days * 86_400_000)), dateTo: localDate(now) };
}

function paymentLabel(purchase: Purchase) {
  if (purchase.paymentMode === "balance_account") return "Saldo do fornecedor";
  if (purchase.paymentMode !== "prepaid_pix") return "Pós-pago";
  if (purchase.paymentDeferred) return "PIX após etiqueta ML";
  if (purchase.paymentStatus === "paid") return "PIX pago";
  if (purchase.paymentStatus === "failed") return "PIX falhou";
  if (purchase.paymentStatus === "cancelled") return "PIX cancelado";
  return "PIX pendente";
}

function PurchaseCard({ purchase, onPress }: { purchase: Purchase; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.id}>DSLite #{purchase.dsliteId}</Text>
        <Text style={styles.total}>{currency(purchase.total)}</Text>
      </View>
      <View style={styles.rowBetween}>
        <Text numberOfLines={1} style={styles.recipient}>{purchase.recipientName || "Destinatário não informado"}</Text>
        <Text style={styles.muted}>{dateTime(purchase.createdAt)}</Text>
      </View>
      <Text numberOfLines={2} style={styles.product}>{purchase.productDescription || "Produto não informado"}</Text>
      <Text style={styles.muted}>SKU {purchase.productSku || "—"} · Qtd. {purchase.quantity}</Text>
      <View style={styles.details}>
        <Text style={styles.detailText}>Fornecedor: {purchase.supplierName || "—"}</Text>
        <Text style={styles.detailText}>Venda: {purchase.saleNumber ? `#${purchase.saleNumber}` : "—"}</Text>
        <Text style={purchase.paymentStatus === "paid" ? styles.paid : styles.payment}>{paymentLabel(purchase)}</Text>
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.status}>{purchase.status}</Text>
        <Text style={styles.open}>Abrir ›</Text>
      </View>
    </Pressable>
  );
}

export default function PurchasesScreen() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<PurchaseFilters>({});
  const [draftStatus, setDraftStatus] = useState<PurchaseStatus | undefined>();
  const [draftPeriod, setDraftPeriod] = useState<Period>("all");
  const [draftSortBy, setDraftSortBy] = useState<NonNullable<PurchaseFilters["sortBy"]>>("data_criacao");
  const [draftSortOrder, setDraftSortOrder] = useState<NonNullable<PurchaseFilters["sortOrder"]>>("desc");
  const purchases = usePurchases(search, filters);
  const summary = usePurchasesSummary(search, filters);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const rows = useMemo(() => purchases.data?.pages.flatMap((page) => page.data) || [], [purchases.data]);
  async function refresh() { await Promise.all([purchases.refetch(), summary.refetch()]); }
  function applyFilters() {
    setFilters({ status: draftStatus, ...periodRange(draftPeriod), sortBy: draftSortBy, sortOrder: draftSortOrder });
    setFiltersOpen(false);
  }
  function clearFilters() {
    setDraftStatus(undefined); setDraftPeriod("all"); setDraftSortBy("data_criacao"); setDraftSortOrder("desc"); setFilters({});
  }

  if (purchases.isPending && !rows.length) return <LoadingScreen message="Carregando compras" />;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.rowBetween}>
              <View><Text style={styles.title}>Compras DSLite</Text><Text style={styles.subtitle}>{summary.data?.total ?? "—"} compras</Text></View>
              {(purchases.isFetching || summary.isFetching) ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            <TextInput
              autoCapitalize="none" autoCorrect={false} onChangeText={setSearchInput}
              placeholder="DSLite, cliente ou produto" placeholderTextColor={colors.textMuted}
              returnKeyType="search" style={styles.search} value={searchInput}
            />
            <View style={styles.rowBetween}>
              <Pressable onPress={() => setFiltersOpen((value) => !value)} style={styles.filterButton}>
                <Text style={styles.filterButtonText}>Filtros e ordenação</Text>
              </Pressable>
              {Object.keys(filters).length ? <Pressable onPress={clearFilters}><Text style={styles.clear}>Limpar</Text></Pressable> : null}
            </View>
            {filtersOpen ? (
              <View style={styles.filterCard}>
                <Text style={styles.label}>Período</Text>
                <View style={styles.wrap}>{(["all", "today", "7d", "30d"] as const).map((value) => (
                  <Pressable key={value} onPress={() => setDraftPeriod(value)} style={[styles.chip, draftPeriod === value && styles.chipActive]}>
                    <Text style={draftPeriod === value ? styles.chipTextActive : styles.chipText}>{value === "all" ? "Todos" : value === "today" ? "Hoje" : value === "7d" ? "7 dias" : "30 dias"}</Text>
                  </Pressable>
                ))}</View>
                <Text style={styles.label}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.wrap}>
                  <Pressable onPress={() => setDraftStatus(undefined)} style={[styles.chip, !draftStatus && styles.chipActive]}><Text style={!draftStatus ? styles.chipTextActive : styles.chipText}>Todos</Text></Pressable>
                  {STATUSES.map((status) => <Pressable key={status} onPress={() => setDraftStatus(status)} style={[styles.chip, draftStatus === status && styles.chipActive]}><Text style={draftStatus === status ? styles.chipTextActive : styles.chipText}>{status}</Text></Pressable>)}
                </View></ScrollView>
                <Text style={styles.label}>Ordenar por</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.wrap}>
                  {SORTS.map((option) => <Pressable key={option.key} onPress={() => setDraftSortBy(option.key)} style={[styles.chip, draftSortBy === option.key && styles.chipActive]}><Text style={draftSortBy === option.key ? styles.chipTextActive : styles.chipText}>{option.label}</Text></Pressable>)}
                </View></ScrollView>
                <View style={styles.wrap}>{(["desc", "asc"] as const).map((order) => <Pressable key={order} onPress={() => setDraftSortOrder(order)} style={[styles.chip, draftSortOrder === order && styles.chipActive]}><Text style={draftSortOrder === order ? styles.chipTextActive : styles.chipText}>{order === "desc" ? "Decrescente" : "Crescente"}</Text></Pressable>)}</View>
                <Pressable onPress={applyFilters} style={styles.primaryButton}><Text style={styles.primaryText}>Aplicar</Text></Pressable>
              </View>
            ) : null}
            {summary.data ? <View style={styles.summary}>
              <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Pendentes</Text><Text style={[styles.summaryValue, { color: colors.warning }]}>{summary.data.pending}</Text></View>
              <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Faturadas</Text><Text style={styles.summaryValue}>{summary.data.invoiced}</Text></View>
              <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Valor total</Text><Text style={[styles.summaryValue, styles.summaryCurrency]}>{currency(summary.data.totalValue)}</Text></View>
            </View> : null}
          </View>
        )}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{purchases.isError ? "Falha ao carregar compras" : "Nenhuma compra encontrada"}</Text></View>}
        ListFooterComponent={purchases.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
        onEndReached={() => { if (purchases.hasNextPage && !purchases.isFetchingNextPage) void purchases.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        onRefresh={refresh}
        refreshing={purchases.isRefetching && !purchases.isFetchingNextPage}
        renderItem={({ item }) => <PurchaseCard purchase={item} onPress={() => router.push(`/purchases/${item.id}` as Href)} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 }, content: { gap: 12, padding: 14, paddingBottom: 36 }, header: { gap: 14, marginBottom: 4 },
  rowBetween: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" }, title: { color: colors.text, fontSize: 25, fontWeight: "800" }, subtitle: { color: colors.textMuted, fontSize: 12 },
  search: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 9, borderWidth: 1, color: colors.text, paddingHorizontal: 13, paddingVertical: 12 },
  filterButton: { borderColor: colors.primary, borderRadius: 8, borderWidth: 1, padding: 10 }, filterButtonText: { color: "#8fc2ff", fontWeight: "700" }, clear: { color: colors.danger },
  filterCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 10, borderWidth: 1, gap: 10, padding: 12 }, label: { color: colors.textMuted, fontSize: 11 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.textMuted, fontSize: 11 }, chipTextActive: { color: colors.text, fontSize: 11, fontWeight: "700" },
  primaryButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 8, padding: 12 }, primaryText: { color: colors.text, fontWeight: "700" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, summaryCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 9, borderWidth: 1, flexGrow: 1, minWidth: 95, padding: 11 }, summaryLabel: { color: colors.textMuted, fontSize: 10 }, summaryValue: { color: colors.primary, fontSize: 18, fontWeight: "800", marginTop: 3 }, summaryCurrency: { color: colors.success, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 11, borderWidth: 1, gap: 8, padding: 14 }, id: { color: colors.primary, fontWeight: "800" }, total: { color: colors.text, fontSize: 16, fontWeight: "800" }, recipient: { color: colors.text, flex: 1, fontWeight: "700" }, muted: { color: colors.textMuted, fontSize: 11 }, product: { color: colors.text, lineHeight: 19 }, details: { borderTopColor: colors.border, borderTopWidth: 1, gap: 4, paddingTop: 8 }, detailText: { color: colors.textMuted, fontSize: 12 }, payment: { color: colors.warning, fontSize: 12, fontWeight: "700" }, paid: { color: colors.success, fontSize: 12, fontWeight: "700" }, status: { color: colors.textMuted, fontSize: 11 }, open: { color: colors.primary, fontWeight: "700" }, empty: { alignItems: "center", padding: 40 }, emptyText: { color: colors.textMuted },
});
