import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  createMobileIdempotencyKey,
  getSaleDocumentUrl,
  type SaleActionKind,
  type SaleHistoryEvent,
  type SaleOperation,
} from "@/api/sales";
import { getApiDownloadHeaders } from "@/api/client";
import { env } from "@/config/env";
import { LoadingScreen } from "@/components/loading-screen";
import { Screen } from "@/components/screen";
import {
  useSaleActionJob,
  useSaleOperation,
  useConfirmSupplierPayment,
  useSaleDetail,
  useSaleTracking,
  useStartSaleAction,
} from "@/hooks/use-sales";
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
  const startAction = useStartSaleAction();
  const operation = useSaleOperation();
  const confirmPayment = useConfirmSupplierPayment();
  const [activeAction, setActiveAction] = useState<SaleActionKind | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<{
    action: SaleActionKind;
    key: string;
    jobId: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshedJobId, setRefreshedJobId] = useState<string | null>(null);
  const actionJob = useSaleActionJob(
    detailSale?.id || "",
    activeAction,
    activeJobId,
  );
  const [linkError, setLinkError] = useState(false);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [shippingOptions, setShippingOptions] = useState<Array<{ transportadoraId: string; name: string; price: number }>>([]);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [receipt, setReceipt] = useState<{ uri: string; name: string; mimeType: string } | null>(null);

  useEffect(() => {
    const state = actionJob.data?.state;
    if (
      !state
      || state === "running"
      || state === "on_hold"
      || !activeJobId
      || refreshedJobId === activeJobId
    ) return;
    setRefreshedJobId(activeJobId);
    void detail.refetch();
  }, [actionJob.data?.state, activeJobId, detail, refreshedJobId]);

  useEffect(() => {
    const result = actionJob.data?.result as Record<string, any> | null | undefined;
    if (!result || actionJob.data?.state === "running") return;
    if (
      result.actionRequired === "choose_dslite_shipping"
      && Array.isArray(result.shippingOptions)
    ) {
      setShippingOptions(result.shippingOptions.map((item: any) => ({
        transportadoraId: String(item.transportadoraId || item.id || ""),
        name: String(item.name || item.nome || item.transportadora || "Transportadora"),
        price: Number(item.price || item.valor || 0),
      })).filter((item: { transportadoraId: string }) => item.transportadoraId));
      setOperationMessage("Escolha o frete DSLite para continuar.");
    } else if (result.stage === "await_supplier_payment") {
      setOperationMessage("Pedido criado. Confirme o PIX do fornecedor para continuar.");
    }
  }, [actionJob.data?.result, actionJob.data?.state]);

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

  async function executeAction(action: SaleActionKind) {
    const key = pendingAttempt?.action === action && !pendingAttempt.jobId
      ? pendingAttempt.key
      : createMobileIdempotencyKey(action, sale.id);
    setPendingAttempt({ action, key, jobId: null });
    setActiveAction(action);
    setActiveJobId(null);
    setActionError(null);
    try {
      const started = await startAction.mutateAsync({
        id: sale.id,
        action,
        idempotencyKey: key,
      });
      setPendingAttempt({ action, key, jobId: started.jobId });
      setActiveJobId(started.jobId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha ao iniciar ação");
    }
  }

  async function executeOperation(value: SaleOperation) {
    setActionError(null);
    setOperationMessage(null);
    try {
      const result = await operation.mutateAsync({ id: sale.id, operation: value }) as Record<string, any>;
      if (result?.actionRequired === "choose_dslite_shipping") {
        setShippingOptions((Array.isArray(result.shippingOptions) ? result.shippingOptions : []).map((item: any) => ({
          transportadoraId: String(item.transportadoraId || item.id || ""),
          name: String(item.name || item.nome || item.transportadora || "Transportadora"),
          price: Number(item.price || item.valor || 0),
        })).filter((item: { transportadoraId: string }) => item.transportadoraId));
        setOperationMessage("Escolha o frete DSLite para continuar.");
        return;
      }
      if (result?.actionRequired === "choose_existing_or_reissue") {
        Alert.alert(
          "NF-e já encontrada",
          "Use a NF-e existente ou reemita somente se a nota encontrada estiver incorreta.",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Usar existente", onPress: () => void executeOperation({ ...value, duplicateAction: "use_existing" } as SaleOperation) },
            { text: "Reemitir", style: "destructive", onPress: () => void executeOperation({ ...value, duplicateAction: "reissue" } as SaleOperation) },
          ],
        );
        return;
      }
      setOperationMessage(String(result?.message || "Operação concluída."));
      setShippingOptions([]);
      await detail.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha na operação");
    }
  }

  function confirmOperation(value: SaleOperation, title: string, description: string) {
    Alert.alert(title, description, [
      { text: "Cancelar", style: "cancel" },
      { text: "Continuar", onPress: () => void executeOperation(value) },
    ]);
  }

  async function pickReceipt() {
    const selected = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!selected.canceled && selected.assets[0]) {
      const asset = selected.assets[0];
      setReceipt({
        uri: asset.uri,
        name: asset.name || "comprovante",
        mimeType: asset.mimeType || "application/octet-stream",
      });
    }
  }

  async function submitPayment() {
    setActionError(null);
    try {
      const result = await confirmPayment.mutateAsync({
        id: sale.id,
        receipt: receipt || undefined,
        reference: paymentReference,
        notes: paymentNotes,
        resumeOnly: sale.hasSupplierPaymentReceipt && sale.supplierPaymentStatus === "paid" && !receipt,
      });
      const jobId = typeof result.jobId === "string" ? result.jobId : null;
      if (jobId) {
        setActiveAction("resume-dslite");
        setActiveJobId(jobId);
      }
      setReceipt(null);
      setOperationMessage("Pagamento confirmado e fluxo retomado.");
      await detail.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha ao confirmar PIX");
    }
  }

  async function openSignedDocument(kind: "danfe" | "label-pdf" | "label-zpl") {
    setActionError(null);
    try {
      await openUrl(await getSaleDocumentUrl(sale.id, kind));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Documento indisponível");
    }
  }

  async function downloadAndShare(path: string, filename: string) {
    setActionError(null);
    try {
      const target = `${FileSystem.cacheDirectory}${filename}`;
      const downloaded = await FileSystem.downloadAsync(`${env.apiUrl}${path}`, target, {
        headers: await getApiDownloadHeaders(),
      });
      if (downloaded.status < 200 || downloaded.status >= 300) throw new Error("Falha ao baixar documento");
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(downloaded.uri);
      else setOperationMessage(`Arquivo salvo em ${downloaded.uri}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha ao baixar documento");
    }
  }

  function confirmAction(action: SaleActionKind) {
    const whatsapp = action === "whatsapp-label";
    const createDslite = action === "create-dslite";
    Alert.alert(
      whatsapp ? "Reenviar etiqueta real?" : createDslite ? "Enviar pelo fornecedor DSLite?" : "Retomar fluxo DSLite?",
      whatsapp
        ? `A etiqueta real será enviada ao WhatsApp cadastrado de ${sale.supplierName || "fornecedor"}.`
        : createDslite
          ? "Esta venda ficará vinculada ao fornecedor. O sistema emitirá a NF-e e criará uma única compra DSLite."
        : "O sistema continuará etiqueta e transportadora no pedido DSLite já pago.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: whatsapp ? "Enviar" : createDslite ? "Usar fornecedor" : "Retomar",
          onPress: () => void executeAction(action),
        },
      ],
    );
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
        {sale.canSendWhatsappLabel || sale.canResumeDslite || sale.canCreateDslite
          || sale.canProcessInternalShipping || sale.canCompleteDsliteLabel
          || sale.canConfirmSupplierPayment || sale.canUnlinkDslite ? (
          <View style={styles.actionsArea}>
            <Text style={styles.fieldLabel}>Ações da venda</Text>
            {sale.canCreateDslite ? (
              <Pressable
                disabled={startAction.isPending}
                onPress={() => confirmAction("create-dslite")}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Enviar pelo fornecedor (DSLite)</Text>
              </Pressable>
            ) : null}
            {sale.canProcessInternalShipping ? (
              <Pressable
                disabled={operation.isPending}
                onPress={() => confirmOperation(
                  { action: "process_internal_shipping" },
                  "Enviar pelo estoque interno?",
                  "Esta venda ficará vinculada ao estoque interno. O sistema emitirá/vinculará a NF-e, reservará o saldo e preparará a etiqueta.",
                )}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Enviar pelo estoque interno</Text>
              </Pressable>
            ) : null}
            {sale.canCompleteDsliteLabel ? (
              <Pressable
                disabled={operation.isPending}
                onPress={() => confirmOperation(
                  { action: "complete_dslite_label" },
                  "Completar etiqueta DSLite?",
                  "O sistema verificará a NF-e, baixará a etiqueta real e a enviará à DSLite.",
                )}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Completar etiqueta DSLite</Text>
              </Pressable>
            ) : null}
            {sale.canSendWhatsappLabel ? (
              <Pressable
                disabled={startAction.isPending || actionJob.data?.state === "running"}
                onPress={() => confirmAction("whatsapp-label")}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (pressed || startAction.isPending) && styles.disabledButton,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Reenviar etiqueta por WhatsApp</Text>
              </Pressable>
            ) : null}
            {sale.canResumeDslite ? (
              <Pressable
                disabled={startAction.isPending || actionJob.data?.state === "running"}
                onPress={() => confirmAction("resume-dslite")}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || startAction.isPending) && styles.disabledButton,
                ]}
              >
                <Text style={styles.primaryButtonText}>Retomar fluxo DSLite</Text>
              </Pressable>
            ) : null}
            {sale.canConfirmSupplierPayment ? (
              <View style={styles.formArea}>
                <Text style={styles.fieldValue}>PIX do fornecedor</Text>
                <Field label="Chave PIX" value={sale.supplierPixKey || "Não cadastrada"} />
                <TextInput
                  onChangeText={setPaymentReference}
                  placeholder="Referência do PIX (opcional)"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  value={paymentReference}
                />
                <TextInput
                  multiline
                  onChangeText={setPaymentNotes}
                  placeholder="Observações (opcional)"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.notesInput]}
                  value={paymentNotes}
                />
                {!(sale.hasSupplierPaymentReceipt && sale.supplierPaymentStatus === "paid") ? (
                  <Pressable onPress={() => void pickReceipt()} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>{receipt ? receipt.name : "Anexar comprovante"}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  disabled={confirmPayment.isPending}
                  onPress={() => void submitPayment()}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {sale.hasSupplierPaymentReceipt && sale.supplierPaymentStatus === "paid"
                      ? "Retomar fluxo" : "Confirmar PIX e continuar"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {sale.canUnlinkDslite ? (
              <Pressable
                disabled={operation.isPending}
                onPress={() => confirmOperation(
                  { action: "unlink_dslite" },
                  "Desvincular compra DSLite?",
                  "Remove somente o vínculo local. Nada será apagado na DSLite.",
                )}
                style={styles.dangerButton}
              >
                <Text style={styles.dangerButtonText}>Desvincular compra rejeitada</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {startAction.isPending || operation.isPending || confirmPayment.isPending ? <ActivityIndicator color={colors.primary} /> : null}
        {operationMessage ? <Text style={styles.successText}>{operationMessage}</Text> : null}
        {shippingOptions.length ? (
          <View style={styles.formArea}>
            <Text style={styles.fieldLabel}>Escolha o frete DSLite</Text>
            {shippingOptions.map((option) => (
              <Pressable
                key={option.transportadoraId}
                disabled={operation.isPending}
                onPress={() => void executeOperation({
                  action: "select_dslite_shipping",
                  transportadoraId: option.transportadoraId,
                })}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>{option.name} · {currency(option.price)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
        {activeJobId ? (
          <View style={styles.jobCard}>
            <Text style={styles.jobTitle}>
              {activeAction === "whatsapp-label" ? "Envio WhatsApp" : "Fluxo DSLite"}
              {` · ${displayStatus(actionJob.data?.state || "running")}`}
            </Text>
            {actionJob.isPending ? <ActivityIndicator color={colors.primary} /> : null}
            {actionJob.data?.steps.map((step) => (
              <Text key={step.key} style={styles.jobStep}>
                {step.status === "success" ? "✓" : step.status === "error" ? "✕" : step.status === "warning" ? "!" : "•"}
                {` ${step.label}`}
                {step.error ? ` — ${step.error}` : ""}
              </Text>
            ))}
            {actionJob.data?.state === "on_hold" ? (
              <Text style={styles.warningText}>Fila aguardando nova tentativa automática.</Text>
            ) : null}
            {actionJob.isError ? (
              <Text style={styles.errorText}>Falha ao consultar andamento do job.</Text>
            ) : null}
          </View>
        ) : null}
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
        {sale.canOpenDanfe ? (
          <Pressable onPress={() => void openSignedDocument("danfe")} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Abrir DANFE</Text>
          </Pressable>
        ) : null}
        {sale.canDownloadXml ? (
          <Pressable
            onPress={() => void downloadAndShare(
              `/api/notas-fiscais/${encodeURIComponent(sale.id)}/xml`,
              `nfe_${sale.number}.xml`,
            )}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Baixar XML</Text>
          </Pressable>
        ) : null}
        {sale.canDownloadThermalPdf ? (
          <Pressable
            onPress={() => void downloadAndShare(
              `/api/pedidos/${encodeURIComponent(sale.id)}/etiqueta?format=thermal_pdf`,
              `etiqueta_${sale.number}_100x150.pdf`,
            )}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Baixar etiqueta térmica PDF</Text>
          </Pressable>
        ) : null}
        {sale.canDownloadLabelPdf ? (
          <Pressable onPress={() => void openSignedDocument("label-pdf")} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Abrir etiqueta PDF</Text>
          </Pressable>
        ) : null}
        {sale.canDownloadZpl ? (
          <Pressable onPress={() => void openSignedDocument("label-zpl")} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Baixar etiqueta ZPL</Text>
          </Pressable>
        ) : null}
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
  disabledButton: { opacity: 0.55 },
  actionsArea: { gap: 10, marginTop: 4 },
  formArea: { gap: 10, marginTop: 6 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  notesInput: { minHeight: 76, textAlignVertical: "top" },
  dangerButton: {
    alignItems: "center",
    borderColor: colors.danger,
    borderRadius: 8,
    borderWidth: 1,
    padding: 11,
  },
  dangerButtonText: { color: colors.danger, fontWeight: "700" },
  successText: { color: colors.success, fontSize: 12, textAlign: "center" },
  jobCard: {
    backgroundColor: "#101c2c",
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    gap: 7,
    padding: 12,
  },
  jobTitle: { color: colors.text, fontWeight: "800" },
  jobStep: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
