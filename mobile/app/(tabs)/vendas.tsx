import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type Href, useRouter } from "expo-router";
import type {
  DsliteLabelFilter,
  Sale,
  SalesFilters,
  SalesStatus,
  SalesSummary,
  SalesView,
  WhatsappLabelFilter,
} from "@/api/sales";
import { LoadingScreen } from "@/components/loading-screen";
import { useSales, useSalesSummary } from "@/hooks/use-sales";
import { colors } from "@/theme/colors";

const TABS: Array<{ key: SalesView; label: string }> = [
  { key: "urgent", label: "Urgentes" },
  { key: "preparation", label: "Preparação" },
  { key: "shipping", label: "Em transporte" },
  { key: "delivered", label: "Entregues" },
  { key: "all", label: "Todos" },
];

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  pendente: "Pendente",
  preparando: "Preparando",
  pronto_envio: "Pronto p/ envio",
  etiqueta_impressa: "Etiqueta impressa",
  faturado: "Faturado",
  coletado: "Coletado",
  em_transito: "Em trânsito",
  saiu_entrega: "Saiu p/ entrega",
  dest_ausente: "Dest. ausente",
  atendido: "Atendido",
  entregue: "Entregue",
  recusado: "Recusado",
  devolvido: "Devolvido",
  cancelado: "Cancelado",
};

const FILTER_STATUSES = Object.keys(STATUS_LABELS) as SalesStatus[];
const DSLITE_LABEL_FILTERS: Array<{ key: DsliteLabelFilter; label: string }> = [
  { key: "real_sent", label: "Real enviada" },
  { key: "generic_sent", label: "Genérica enviada" },
  { key: "provider_shipping", label: "Frete DSLite" },
  { key: "sent_unverified", label: "Sem confirmação" },
  { key: "pending", label: "Pendente" },
  { key: "failed", label: "Falhou" },
  { key: "unknown", label: "Desconhecida" },
];
const WHATSAPP_LABEL_FILTERS: Array<{ key: WhatsappLabelFilter; label: string }> = [
  { key: "sent", label: "Enviada" },
  { key: "test_sent", label: "Teste enviado" },
  { key: "pending", label: "Pendente" },
  { key: "on_hold", label: "Em espera" },
  { key: "failed", label: "Falhou" },
  { key: "not_applicable", label: "Não aplicável" },
  { key: "not_sent", label: "Não enviada" },
  { key: "unknown", label: "Desconhecida" },
];
type PeriodFilter = "all" | "today" | "7d" | "30d";
const SORT_FIELDS: Array<{ key: NonNullable<SalesFilters["sortBy"]>; label: string }> = [
  { key: "data", label: "Data" },
  { key: "numero", label: "Número" },
  { key: "cliente", label: "Cliente" },
  { key: "total", label: "Total" },
  { key: "situacao", label: "Status" },
  { key: "nota_fiscal_numero", label: "NF" },
  { key: "pedido_compra", label: "Compra" },
  { key: "lucro", label: "Lucro" },
];

function saoPauloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function rangeForPeriod(period: PeriodFilter): Pick<SalesFilters, "dateFrom" | "dateTo"> {
  if (period === "all") return {};
  const now = new Date();
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return {
    dateFrom: saoPauloDate(new Date(now.getTime() - days * 86_400_000)),
    dateTo: saoPauloDate(now),
  };
}

function parsePrice(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

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
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tabCount(summary: SalesSummary | undefined, view: SalesView) {
  return summary?.counts[view] ?? 0;
}

function SaleCard({ sale, onPress }: { sale: Sale; onPress: () => void }) {
  const firstItem = sale.items[0];
  const extraItems = Math.max(0, sale.items.length - 1);

  return (
    <Pressable
      accessibilityHint="Abre os detalhes da venda"
      accessibilityRole="button"
      android_ripple={{ color: "#202020" }}
      onPress={onPress}
      style={[styles.card, sale.urgentReasons.length > 0 && styles.urgentCard]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardIdentity}>
          <Text style={styles.orderNumber}>#{sale.number}</Text>
          {sale.packId ? <Text style={styles.meta}>PACK {sale.packId}</Text> : null}
        </View>
        <Text style={styles.orderTotal}>{currency(sale.total)}</Text>
      </View>

      <View style={styles.rowBetween}>
        <Text numberOfLines={1} style={styles.customer}>{sale.customer}</Text>
        <Text style={styles.meta}>{dateTime(sale.date)}</Text>
      </View>

      <View style={styles.productBlock}>
        <Text numberOfLines={2} style={styles.productTitle}>
          {firstItem?.title || "Produto não informado"}
        </Text>
        <Text style={styles.meta}>
          {firstItem?.sku ? `SKU ${firstItem.sku} · ` : ""}
          Qtd. {firstItem?.quantity || 1}
          {extraItems ? ` · +${extraItems} produto${extraItems > 1 ? "s" : ""}` : ""}
        </Text>
      </View>

      {sale.urgentReasons.map((reason) => (
        <Text key={reason} style={styles.urgentReason}>• {reason}</Text>
      ))}

      <View style={styles.flowBlock}>
        <View style={styles.rowBetween}>
          <Text style={styles.flowLabel}>Fornecedor</Text>
          <Text numberOfLines={1} style={styles.flowValue}>
            {sale.supplierName || "Não definido"}
          </Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.flowLabel}>Próxima etapa</Text>
          <Text style={styles.flowValue}>
            {sale.dsliteNextActionLabel || (sale.internalShipping ? "Envio interno" : "—")}
          </Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.flowLabel}>DSLite / WhatsApp</Text>
          <Text style={styles.flowValue}>
            {sale.dsliteLabelStatus} / {sale.whatsappLabelStatus}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.statusPill}>
          {STATUS_LABELS[sale.status] || sale.status}
        </Text>
        <Text style={sale.profit != null && sale.profit >= 0 ? styles.profit : styles.loss}>
          {sale.profitPending
            ? "Lucro pendente"
            : sale.profit == null
              ? "Lucro —"
              : `Lucro ${currency(sale.profit)}`}
        </Text>
      </View>
    </Pressable>
  );
}

export default function SalesScreen() {
  const router = useRouter();
  const [view, setView] = useState<SalesView>("urgent");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<SalesFilters>({});
  const [draftStatus, setDraftStatus] = useState<SalesStatus | undefined>();
  const [draftPeriod, setDraftPeriod] = useState<PeriodFilter>("all");
  const [draftPriceMin, setDraftPriceMin] = useState("");
  const [draftPriceMax, setDraftPriceMax] = useState("");
  const [draftSupplier, setDraftSupplier] = useState("");
  const [draftDsliteLabel, setDraftDsliteLabel] = useState<DsliteLabelFilter | undefined>();
  const [draftWhatsappLabel, setDraftWhatsappLabel] = useState<WhatsappLabelFilter | undefined>();
  const [draftSortBy, setDraftSortBy] = useState<NonNullable<SalesFilters["sortBy"]>>("data");
  const [draftSortOrder, setDraftSortOrder] = useState<NonNullable<SalesFilters["sortOrder"]>>("desc");
  const [filterError, setFilterError] = useState<string | null>(null);
  const sales = useSales(view, search, filters);
  const summary = useSalesSummary(search, filters);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const rows = useMemo(
    () => sales.data?.pages.flatMap((page) => page.data) || [],
    [sales.data],
  );

  async function refresh() {
    await Promise.all([sales.refetch(), summary.refetch()]);
  }

  function applyFilters() {
    const priceMin = parsePrice(draftPriceMin);
    const priceMax = parsePrice(draftPriceMax);
    if (draftPriceMin.trim() && priceMin == null) {
      setFilterError("Preço mínimo inválido");
      return;
    }
    if (draftPriceMax.trim() && priceMax == null) {
      setFilterError("Preço máximo inválido");
      return;
    }
    if (priceMin != null && priceMax != null && priceMin > priceMax) {
      setFilterError("Preço mínimo não pode superar o máximo");
      return;
    }
    setFilterError(null);
    setFilters({
      status: draftStatus,
      ...rangeForPeriod(draftPeriod),
      priceMin,
      priceMax,
      supplier: draftSupplier.trim() || undefined,
      dsliteLabel: draftDsliteLabel,
      whatsappLabel: draftWhatsappLabel,
      sortBy: draftSortBy,
      sortOrder: draftSortOrder,
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setDraftStatus(undefined);
    setDraftPeriod("all");
    setDraftPriceMin("");
    setDraftPriceMax("");
    setDraftSupplier("");
    setDraftDsliteLabel(undefined);
    setDraftWhatsappLabel(undefined);
    setDraftSortBy("data");
    setDraftSortOrder("desc");
    setFilterError(null);
    setFilters({});
  }

  const activeFilterCount = Number(Boolean(filters.status))
    + Number(Boolean(filters.dateFrom || filters.dateTo))
    + Number(filters.priceMin != null)
    + Number(filters.priceMax != null)
    + Number(Boolean(filters.supplier))
    + Number(Boolean(filters.dsliteLabel))
    + Number(Boolean(filters.whatsappLabel));

  if (sales.isPending && !rows.length) {
    return <LoadingScreen message="Carregando vendas" />;
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.heading}>
              <View>
                <Text style={styles.title}>Vendas</Text>
                <Text style={styles.subtitle}>
                  {summary.data?.counts.all ?? "—"} pedidos no filtro atual
                </Text>
              </View>
              {(sales.isFetching || summary.isFetching) ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
            </View>

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchInput}
              placeholder="Pedido, pack, cliente, SKU ou produto"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              style={styles.search}
              value={searchInput}
            />

            <View style={styles.filterHeader}>
              <Pressable
                onPress={() => setFiltersOpen((current) => !current)}
                style={[styles.filterToggle, activeFilterCount > 0 && styles.filterToggleActive]}
              >
                <Text style={styles.filterToggleText}>
                  Filtros{activeFilterCount ? ` (${activeFilterCount})` : ""}
                </Text>
              </Pressable>
              {activeFilterCount ? (
                <Pressable onPress={clearFilters}>
                  <Text style={styles.clearFilters}>Limpar</Text>
                </Pressable>
              ) : null}
            </View>

            {filtersOpen ? (
              <View style={styles.filtersCard}>
                <Text style={styles.filterLabel}>Período</Text>
                <View style={styles.filterWrap}>
                  {([
                    ["all", "Todos"],
                    ["today", "Hoje"],
                    ["7d", "7 dias"],
                    ["30d", "30 dias"],
                  ] as Array<[PeriodFilter, string]>).map(([key, label]) => (
                    <Pressable
                      key={key}
                      onPress={() => setDraftPeriod(key)}
                      style={[styles.filterChip, draftPeriod === key && styles.filterChipActive]}
                    >
                      <Text style={draftPeriod === key ? styles.filterChipTextActive : styles.filterChipText}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.filterLabel}>Ordenar por</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.filterWrap}>
                    {SORT_FIELDS.map((option) => (
                      <Pressable
                        key={option.key}
                        onPress={() => setDraftSortBy(option.key)}
                        style={[styles.filterChip, draftSortBy === option.key && styles.filterChipActive]}
                      >
                        <Text style={draftSortBy === option.key ? styles.filterChipTextActive : styles.filterChipText}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={styles.filterWrap}>
                  {(["desc", "asc"] as const).map((order) => (
                    <Pressable
                      key={order}
                      onPress={() => setDraftSortOrder(order)}
                      style={[styles.filterChip, draftSortOrder === order && styles.filterChipActive]}
                    >
                      <Text style={draftSortOrder === order ? styles.filterChipTextActive : styles.filterChipText}>
                        {order === "desc" ? "Decrescente" : "Crescente"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.filterLabel}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.filterWrap}>
                    <Pressable
                      onPress={() => setDraftStatus(undefined)}
                      style={[styles.filterChip, !draftStatus && styles.filterChipActive]}
                    >
                      <Text style={!draftStatus ? styles.filterChipTextActive : styles.filterChipText}>Todos</Text>
                    </Pressable>
                    {FILTER_STATUSES.map((status) => (
                      <Pressable
                        key={status}
                        onPress={() => setDraftStatus(status)}
                        style={[styles.filterChip, draftStatus === status && styles.filterChipActive]}
                      >
                        <Text style={draftStatus === status ? styles.filterChipTextActive : styles.filterChipText}>
                          {STATUS_LABELS[status]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.filterLabel}>Faixa de valor</Text>
                <View style={styles.priceRow}>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={setDraftPriceMin}
                    placeholder="Mínimo"
                    placeholderTextColor={colors.textMuted}
                    style={styles.priceInput}
                    value={draftPriceMin}
                  />
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={setDraftPriceMax}
                    placeholder="Máximo"
                    placeholderTextColor={colors.textMuted}
                    style={styles.priceInput}
                    value={draftPriceMax}
                  />
                </View>

                <Text style={styles.filterLabel}>Fornecedor</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={100}
                  onChangeText={setDraftSupplier}
                  placeholder="Ex.: BKR1, Evolusom, Estoque Interno"
                  placeholderTextColor={colors.textMuted}
                  style={styles.filterInput}
                  value={draftSupplier}
                />

                <Text style={styles.filterLabel}>Etiqueta DSLite</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.filterWrap}>
                    <Pressable
                      onPress={() => setDraftDsliteLabel(undefined)}
                      style={[styles.filterChip, !draftDsliteLabel && styles.filterChipActive]}
                    >
                      <Text style={!draftDsliteLabel ? styles.filterChipTextActive : styles.filterChipText}>Todas</Text>
                    </Pressable>
                    {DSLITE_LABEL_FILTERS.map((option) => (
                      <Pressable
                        key={option.key}
                        onPress={() => setDraftDsliteLabel(option.key)}
                        style={[styles.filterChip, draftDsliteLabel === option.key && styles.filterChipActive]}
                      >
                        <Text style={draftDsliteLabel === option.key ? styles.filterChipTextActive : styles.filterChipText}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.filterLabel}>WhatsApp real</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.filterWrap}>
                    <Pressable
                      onPress={() => setDraftWhatsappLabel(undefined)}
                      style={[styles.filterChip, !draftWhatsappLabel && styles.filterChipActive]}
                    >
                      <Text style={!draftWhatsappLabel ? styles.filterChipTextActive : styles.filterChipText}>Todos</Text>
                    </Pressable>
                    {WHATSAPP_LABEL_FILTERS.map((option) => (
                      <Pressable
                        key={option.key}
                        onPress={() => setDraftWhatsappLabel(option.key)}
                        style={[styles.filterChip, draftWhatsappLabel === option.key && styles.filterChipActive]}
                      >
                        <Text style={draftWhatsappLabel === option.key ? styles.filterChipTextActive : styles.filterChipText}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {filterError ? <Text style={styles.filterError}>{filterError}</Text> : null}
                <Pressable onPress={applyFilters} style={styles.applyFilters}>
                  <Text style={styles.applyFiltersText}>Aplicar filtros</Text>
                </Pressable>
              </View>
            ) : null}

            {summary.data ? (
              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Faturamento</Text>
                  <Text style={styles.summaryValue}>{currency(summary.data.financial.total)}</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Lucro</Text>
                  <Text style={[styles.summaryValue, { color: colors.success }]}>
                    {currency(summary.data.financial.profit)}
                  </Text>
                </View>
              </View>
            ) : null}

            <ScrollView
              horizontal
              contentContainerStyle={styles.tabs}
              showsHorizontalScrollIndicator={false}
            >
              {TABS.map((tab) => {
                const active = view === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setView(tab.key)}
                    style={[styles.tab, active && styles.tabActive]}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>
                      {tab.label} {tabCount(summary.data, tab.key)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {sales.isError ? "Não foi possível carregar as vendas" : "Nenhuma venda encontrada"}
            </Text>
            {sales.isError ? (
              <Pressable onPress={() => sales.refetch()} style={styles.retryButton}>
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListFooterComponent={sales.isFetchingNextPage ? (
          <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
        ) : null}
        onEndReached={() => {
          if (sales.hasNextPage && !sales.isFetchingNextPage) {
            void sales.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        onRefresh={refresh}
        refreshing={sales.isRefetching && !sales.isFetchingNextPage}
        renderItem={({ item }) => (
          <SaleCard
            onPress={() => router.navigate(`/sales/${encodeURIComponent(item.number)}` as Href)}
            sale={item}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  listContent: { gap: 12, padding: 16, paddingBottom: 28 },
  header: { gap: 14, marginBottom: 2 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  filterToggle: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  filterToggleActive: { borderColor: colors.primary },
  filterToggleText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  clearFilters: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  filtersCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14,
  },
  filterLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  filterWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  filterChipActive: { backgroundColor: "#102a56", borderColor: colors.primary },
  filterChipText: { color: colors.textMuted, fontSize: 11 },
  filterChipTextActive: { color: "#8fc2ff", fontSize: 11, fontWeight: "700" },
  priceRow: { flexDirection: "row", gap: 10 },
  priceInput: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterInput: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterError: { color: colors.danger, fontSize: 12 },
  applyFilters: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 11,
  },
  applyFiltersText: { color: colors.textOnPrimary, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    padding: 12,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 12 },
  summaryValue: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  tabs: { gap: 8 },
  tab: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  tabActive: { backgroundColor: "#102a56", borderColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: "#8fc2ff" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  urgentCard: { borderColor: colors.danger },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardIdentity: { flex: 1 },
  orderNumber: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  orderTotal: { color: colors.text, fontSize: 16, fontWeight: "800" },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  customer: { color: colors.text, flex: 1, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 11 },
  productBlock: { gap: 3 },
  productTitle: { color: colors.text, fontSize: 13, lineHeight: 18 },
  urgentReason: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  flowBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 7,
    paddingTop: 10,
  },
  flowLabel: { color: colors.textMuted, fontSize: 11 },
  flowValue: { color: colors.text, flex: 1, fontSize: 11, textAlign: "right" },
  cardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusPill: {
    backgroundColor: "#172554",
    borderRadius: 5,
    color: "#93c5fd",
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  profit: { color: colors.success, fontSize: 12, fontWeight: "800" },
  loss: { color: colors.danger, fontSize: 12, fontWeight: "800" },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    padding: 24,
  },
  emptyTitle: { color: colors.textMuted, textAlign: "center" },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: colors.textOnPrimary, fontWeight: "700" },
  footerLoader: { padding: 18 },
});
